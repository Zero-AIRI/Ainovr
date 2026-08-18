import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createEvidenceWorkbenchService } from "@/application/evidence-workbench-service";
import { createIndependentFalsificationService } from "@/application/independent-falsification-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createResearchConclusionService } from "@/application/research-conclusion-service";
import { createThreadGraphService } from "@/application/thread-graph-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("EvidenceWorkbench 服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-evidence-workbench-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("按结论读取支持与反证的可核验索引，并展示 Coverage 处置而不复制原文", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const facts = createAnalysisFactService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const threads = createThreadGraphService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const brief = createAnalysisBriefService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const conclusions = createResearchConclusionService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const falsification = createIndependentFalsificationService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const workbench = createEvidenceWorkbenchService({ driver });

    await references.importText({ command: command("reference"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "第一章\n门后有脚步声。" });
    await corpus.prepare({ command: command("corpus"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete", budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 } });
    const unitId = (await corpus.getOverview("analysis_001"))!.computeUnits[0]!.analysisUnitId;
    await facts.submit({ command: command("facts"), analysisProjectId: "analysis_001", analysisUnitId: unitId, rawOutput: JSON.stringify({ facts: [{ id: "fact_001", kind: "event", rawLabel: null, statement: "脚步声出现", subject: null, object: null, evidenceSpanIds: ["sp00002"], epistemicStatus: "observed" }] }) });
    await threads.submit({ command: command("thread"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ threads: [{ id: "thread_001", kind: "event", title: "脚步声", episodes: [{ id: "episode_001", role: "setup", rawLabel: null, summary: "脚步声出现", evidenceSpanIds: ["sp00002"], ordinal: 1 }], epistemicStatus: "observed", lifecycle: "open" }] }) });
    await brief.submit({ command: command("brief"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ questions: [{ id: "question_001", question: "脚步声如何建立期待？", rationale: "验证期待线", productionUse: "指导章节入口", requiredEvidence: ["事件"], estimatedCostTokens: 256, abstentionReason: "证据不足时弃权" }] }) });
    await brief.approve({ command: command("brief_approve"), analysisProjectId: "analysis_001" });
    await conclusions.submit({ command: command("conclusion"), analysisProjectId: "analysis_001", researchQuestionId: "question_001", rawOutput: JSON.stringify({ conclusions: [{ id: "conclusion_001", researchQuestionId: "question_001", conclusion: "异常先出现会建立未解期待。", observations: [{ id: "observation_001", statement: "脚步声被单独呈现。", evidenceSpanIds: ["sp00002"] }], evidenceSpanIds: ["sp00002"], counterEvidenceSpanIds: [], alternativeExplanations: ["局部场景调度"], applicabilityBoundaries: ["信息尚未解释的入口"], productionImplications: ["先给异常再延后解释。"], coverageStatus: "complete", epistemicStatus: "inferred" }] }) });
    await falsification.submit({ command: command("falsification"), analysisProjectId: "analysis_001", conclusionId: "conclusion_001", rawOutput: JSON.stringify({ assessment: { conclusionId: "conclusion_001", status: "bounded", counterEvidenceSpanIds: ["sp00002"], alternativeExplanations: ["局部场景调度"], applicabilityLimits: ["样本只覆盖一个单元"], sampleBiasNotes: ["短文本"] } }) });

    await expect(workbench.getEvidence({ analysisProjectId: "analysis_001", conclusionId: "conclusion_001" })).resolves.toEqual([
      expect.objectContaining({ conclusionId: "conclusion_001", role: "supporting", spanId: "sp00002", exactTextHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ conclusionId: "conclusion_001", role: "counter", spanId: "sp00002", exactTextHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]);
    const coverage = await workbench.listCoverage({ analysisProjectId: "analysis_001", module: "research_question" });
    expect(coverage).toEqual([expect.objectContaining({ module: "research_question", status: "complete", reason: "research_conclusion_submitted" })]);
    expect(JSON.stringify(await workbench.getEvidence({ analysisProjectId: "analysis_001", conclusionId: "conclusion_001" }))).not.toContain("门后有脚步声");
  });

  it("拒绝跨项目结论筛选，避免把其他 SourceEdition 的证据混入工作台", async () => {
    const workbench = createEvidenceWorkbenchService({ driver });
    await expect(workbench.getEvidence({ analysisProjectId: "missing", conclusionId: "conclusion_001" })).rejects.toThrow(/AnalysisProject/);
  });
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
