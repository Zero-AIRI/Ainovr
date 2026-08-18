import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createResearchConclusionService } from "@/application/research-conclusion-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ResearchConclusion 服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-research-conclusion-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("仅为已批准的研究问题提交严格结论，并把原始模型 JSON 留在对象库", async () => {
    const { conclusions, questionId, spanId } = await prepareApprovedQuestion();
    const rawOutput = JSON.stringify({
      conclusions: [{
        id: "conclusion_001",
        researchQuestionId: questionId,
        conclusion: "延迟揭示会把未知转化为下一步期待。",
        observations: [{ id: "observation_001", statement: "时刻表先出现异常班次，随后才给出广播提示。", evidenceSpanIds: [spanId] }],
        evidenceSpanIds: [spanId],
        counterEvidenceSpanIds: [],
        alternativeExplanations: ["短文本样本不足以证明全书规律。"],
        applicabilityBoundaries: ["仅适用于信息被控制释放的悬疑场景。"],
        productionImplications: ["在章节开场先展示可核验异常，再延后解释来源。"],
        coverageStatus: "complete",
        epistemicStatus: "inferred",
      }],
    });

    await expect(conclusions.submit({ command: command("conclusion_001"), analysisProjectId: "analysis_001", researchQuestionId: questionId, rawOutput }))
      .resolves.toMatchObject({ kind: "ok" });
    await expect(conclusions.getByQuestion("analysis_001", questionId)).resolves.toEqual([
      expect.objectContaining({
        id: "conclusion_001",
        evidenceSpanIds: [spanId],
        productionImplications: ["在章节开场先展示可核验异常，再延后解释来源。"],
      }),
    ]);
    await expect(driver.query<{ payload_json: string }>({ sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ?", params: ["analysis_001"] }))
      .resolves.toEqual([expect.objectContaining({ payload_json: expect.stringContaining('"kind":"research_conclusion"') })]);
    await expect(driver.query<{ status: string; reason: string }>({ sql: "SELECT status, reason FROM coverage_entries WHERE analysis_project_id = ? AND module = 'research_question'", params: ["analysis_001"] }))
      .resolves.toEqual([{ status: "complete", reason: "research_conclusion_submitted" }]);
    await expect(driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE tool = 'commit_research_conclusions'", params: [] }))
      .resolves.toEqual([expect.objectContaining({ args_json: expect.not.stringContaining(rawOutput) })]);
  });

  it("未批准的问题与无效 span 均 fail closed，不留下结论或覆盖记录", async () => {
    const { brief, conclusions, questionId } = await prepareQuestion(false);
    const validShape = JSON.stringify({
      conclusions: [{
        id: "conclusion_002", researchQuestionId: questionId, conclusion: "未知结论", observations: [], evidenceSpanIds: [], counterEvidenceSpanIds: [],
        alternativeExplanations: [], applicabilityBoundaries: [], productionImplications: [], coverageStatus: "not_observed", epistemicStatus: "not_observed",
      }],
    });
    await expect(conclusions.submit({ command: command("conclusion_unapproved"), analysisProjectId: "analysis_001", researchQuestionId: questionId, rawOutput: validShape }))
      .rejects.toThrow(/批准/);
    await brief.approve({ command: command("brief_approve") , analysisProjectId: "analysis_001" });
    const invalidSpan = validShape.replace('"evidenceSpanIds":[]', '"evidenceSpanIds":["not-a-span"]');
    await expect(conclusions.submit({ command: command("conclusion_invalid_span"), analysisProjectId: "analysis_001", researchQuestionId: questionId, rawOutput: invalidSpan }))
      .rejects.toThrow(/spanId|SourceSpan/);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM analysis_items", params: [] })).resolves.toEqual([{ count: 0 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM coverage_entries WHERE module = 'research_question'", params: [] })).resolves.toEqual([{ count: 0 }]);
  });

  async function prepareApprovedQuestion() {
    const prepared = await prepareQuestion(true);
    return prepared;
  }

  async function prepareQuestion(approved: boolean) {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: command("reference"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "雨夜的站台上，时刻表多出一趟列车。\n广播在三分钟后响起。" });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await corpus.prepare({ command: command("corpus"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete", budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 } });
    const brief = createAnalysisBriefService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const questionId = "question_001";
    await brief.submit({ command: command("brief"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ questions: [{ id: questionId, question: "异常信息如何建立期待？", rationale: "检查信息释放", productionUse: "指导悬念开场", requiredEvidence: ["段落证据"], estimatedCostTokens: 256, abstentionReason: "样本不足时弃权" }] }) });
    if (approved) await brief.approve({ command: command("brief_approve_initial"), analysisProjectId: "analysis_001" });
    const overview = await corpus.getOverview("analysis_001");
    const spanRows = await driver.query<{ span_id: string }>({ sql: "SELECT span_id FROM source_spans WHERE analysis_unit_id = ? ORDER BY start_byte ASC", params: [overview!.computeUnits[0]!.analysisUnitId] });
    return { brief, conclusions: createResearchConclusionService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }), questionId, spanId: spanRows[0]!.span_id };
  }
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
