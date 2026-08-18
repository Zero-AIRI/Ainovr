import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createResearchConclusionService } from "@/application/research-conclusion-service";
import { createIndependentFalsificationService } from "@/application/independent-falsification-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createResearchDossierService } from "@/application/research-dossier-service";
import { createThreadGraphService } from "@/application/thread-graph-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ResearchDossier 服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-dossier-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("只在 Brief 已批准且每个单元有 FactLedger 处置时冻结证据索引 Dossier", async () => {
    const { dossier, facts, threads, brief, conclusions, falsification, unitId } = await prepare();
    await facts.submit({ command: command("facts_001"), analysisProjectId: "analysis_001", analysisUnitId: unitId, rawOutput: JSON.stringify({ facts: [{ id: "fact_001", kind: "event", rawLabel: null, statement: "门后有脚步声", subject: null, object: null, evidenceSpanIds: ["sp00002"], epistemicStatus: "observed" }] }) });
    await threads.submit({ command: command("thread_001"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ threads: [{ id: "thread_001", kind: "event", title: "脚步声", episodes: [{ id: "episode_001", role: "setup", rawLabel: null, summary: "脚步声出现", evidenceSpanIds: ["sp00002"], ordinal: 1 }], epistemicStatus: "observed", lifecycle: "open" }] }) });
    await brief.submit({ command: command("brief_001"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ questions: [{ id: "question_001", question: "脚步声如何建立期待？", rationale: "验证期待线", productionUse: "指导章节悬念入口", requiredEvidence: ["事件与线程"], estimatedCostTokens: 256, abstentionReason: "证据不足时弃权" }] }) });
    await brief.approve({ command: command("brief_approve_001"), analysisProjectId: "analysis_001" });
    await conclusions.submit({ command: command("conclusion_001"), analysisProjectId: "analysis_001", researchQuestionId: "question_001", rawOutput: JSON.stringify({ conclusions: [{ id: "conclusion_001", researchQuestionId: "question_001", conclusion: "脚步声先出现会建立未解期待。", observations: [{ id: "observation_001", statement: "脚步声被单独呈现。", evidenceSpanIds: ["sp00002"] }], evidenceSpanIds: ["sp00002"], counterEvidenceSpanIds: [], alternativeExplanations: ["单一场景调度"], applicabilityBoundaries: ["信息尚未解释的入口"], productionImplications: ["先给出可核验异常再延后解释。"], coverageStatus: "complete", epistemicStatus: "inferred" }] }) });
    await falsification.submit({ command: command("falsification_001"), analysisProjectId: "analysis_001", conclusionId: "conclusion_001", rawOutput: JSON.stringify({ assessment: { conclusionId: "conclusion_001", status: "bounded", counterEvidenceSpanIds: ["sp00002"], alternativeExplanations: ["单一场景调度"], applicabilityLimits: ["样本只覆盖一个单元"], sampleBiasNotes: ["短文本" ] } }) });

    await expect(dossier.create({ command: command("dossier_001"), analysisProjectId: "analysis_001" })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(dossier.getLatest("analysis_001")).resolves.toEqual(expect.objectContaining({
      revision: 1,
      analysisProjectId: "analysis_001",
      factCount: 1,
      threadCount: 1,
      conclusionCount: 1,
      falsificationCount: 1,
      conclusions: [expect.objectContaining({ id: "conclusion_001", falsificationStatus: "bounded" })],
      evidence: [expect.objectContaining({ spanId: "sp00002", exactTextHash: expect.stringMatching(/^[a-f0-9]{64}$/) })],
    }));
    await expect(driver.query<{ payload_object_hash: string }>({ sql: "SELECT payload_object_hash FROM research_dossiers WHERE analysis_project_id = ?", params: ["analysis_001"] }))
      .resolves.toEqual([expect.objectContaining({ payload_object_hash: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  });

  it("Brief 未批准时拒绝生成 Dossier，防止未经人类确认的解释任务进入研究档案", async () => {
    const { dossier, brief } = await prepare();
    await brief.submit({ command: command("brief_002"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ questions: [{ id: "question_001", question: "问题？", rationale: "理由", productionUse: "用途", requiredEvidence: ["证据"], estimatedCostTokens: 1, abstentionReason: "弃权" }] }) });
    await expect(dossier.create({ command: command("dossier_002"), analysisProjectId: "analysis_001" })).rejects.toThrow(/批准/);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM research_dossiers", params: [] })).resolves.toEqual([{ count: 0 }]);
  });

  it("已批准问题没有独立反证时拒绝冻结 Dossier，避免把未检验解释提升为机制输入", async () => {
    const { dossier, brief, conclusions, unitId, facts, threads } = await prepare();
    await facts.submit({ command: command("facts_003"), analysisProjectId: "analysis_001", analysisUnitId: unitId, rawOutput: JSON.stringify({ facts: [{ id: "fact_003", kind: "event", rawLabel: null, statement: "门后有脚步声", subject: null, object: null, evidenceSpanIds: ["sp00002"], epistemicStatus: "observed" }] }) });
    await threads.submit({ command: command("thread_003"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ threads: [{ id: "thread_003", kind: "event", title: "脚步声", episodes: [{ id: "episode_003", role: "setup", rawLabel: null, summary: "脚步声出现", evidenceSpanIds: ["sp00002"], ordinal: 1 }], epistemicStatus: "observed", lifecycle: "open" }] }) });
    await brief.submit({ command: command("brief_003"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ questions: [{ id: "question_003", question: "脚步声如何建立期待？", rationale: "验证期待线", productionUse: "指导章节悬念入口", requiredEvidence: ["事件"], estimatedCostTokens: 256, abstentionReason: "证据不足时弃权" }] }) });
    await brief.approve({ command: command("brief_approve_003"), analysisProjectId: "analysis_001" });
    await conclusions.submit({ command: command("conclusion_003"), analysisProjectId: "analysis_001", researchQuestionId: "question_003", rawOutput: JSON.stringify({ conclusions: [{ id: "conclusion_003", researchQuestionId: "question_003", conclusion: "脚步声先出现会建立未解期待。", observations: [{ id: "observation_003", statement: "脚步声被单独呈现。", evidenceSpanIds: ["sp00002"] }], evidenceSpanIds: ["sp00002"], counterEvidenceSpanIds: [], alternativeExplanations: ["单一场景调度"], applicabilityBoundaries: ["信息尚未解释的入口"], productionImplications: ["先给出异常再延后解释。"], coverageStatus: "complete", epistemicStatus: "inferred" }] }) });
    await expect(dossier.create({ command: command("dossier_003"), analysisProjectId: "analysis_001" })).rejects.toThrow(/反证/);
  });

  async function prepare() {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: command("reference_001"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "第一章\n门后有脚步声。" });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await corpus.prepare({ command: command("corpus_001"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete", budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 } });
    return {
      unitId: (await corpus.getOverview("analysis_001"))!.computeUnits[0]!.analysisUnitId,
      facts: createAnalysisFactService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }),
      threads: createThreadGraphService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }),
      brief: createAnalysisBriefService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }),
      conclusions: createResearchConclusionService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }),
      falsification: createIndependentFalsificationService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }),
      dossier: createResearchDossierService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }),
    };
  }
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
