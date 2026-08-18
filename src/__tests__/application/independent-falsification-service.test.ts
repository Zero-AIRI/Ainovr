import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createIndependentFalsificationService } from "@/application/independent-falsification-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createResearchConclusionService } from "@/application/research-conclusion-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("独立反证服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-independent-falsification-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("向反证 Agent 只提供待检验命题与检索范围，并保存有边界的反证结论", async () => {
    const { falsification, spanId } = await prepareConclusion();
    await expect(falsification.getWorkItem("analysis_001", "conclusion_001")).resolves.toEqual({
      conclusionId: "conclusion_001",
      proposition: "异常信息的延迟解释会建立期待。",
      retrievalScope: { analysisProjectId: "analysis_001", allowedSpanIds: [spanId] },
    });
    const workItem = await falsification.getWorkItem("analysis_001", "conclusion_001");
    expect(JSON.stringify(workItem)).not.toContain("生产用途");
    const rawOutput = JSON.stringify({ assessment: {
      conclusionId: "conclusion_001",
      status: "bounded",
      counterEvidenceSpanIds: [spanId],
      alternativeExplanations: ["单个异常事件也可能只是局部场景调度。"],
      applicabilityLimits: ["尚未覆盖不同叙述视角。"],
      sampleBiasNotes: ["当前样本只含一个计算单元。"],
    } });
    await expect(falsification.submit({ command: command("falsification_001"), analysisProjectId: "analysis_001", conclusionId: "conclusion_001", rawOutput }))
      .resolves.toMatchObject({ kind: "ok" });
    await expect(falsification.getByConclusion("analysis_001", "conclusion_001")).resolves.toEqual(expect.objectContaining({ status: "bounded", counterEvidenceSpanIds: [spanId] }));
    await expect(driver.query<{ status: string; reason: string }>({ sql: "SELECT status, reason FROM coverage_entries WHERE module = 'independent_falsification'", params: [] }))
      .resolves.toEqual([{ status: "complete", reason: "independent_falsification_submitted" }]);
    await expect(driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE tool = 'commit_independent_falsification'", params: [] }))
      .resolves.toEqual([expect.objectContaining({ args_json: expect.not.stringContaining(rawOutput) })]);
  });

  it("缺少反例边界的 bounded 输出与未知结论都不能伪装为已反证", async () => {
    const { falsification, spanId } = await prepareConclusion();
    const invalid = JSON.stringify({ assessment: { conclusionId: "conclusion_001", status: "bounded", counterEvidenceSpanIds: [], alternativeExplanations: [], applicabilityLimits: [], sampleBiasNotes: [] } });
    await expect(falsification.submit({ command: command("falsification_invalid"), analysisProjectId: "analysis_001", conclusionId: "conclusion_001", rawOutput: invalid }))
      .rejects.toThrow(/bounded/);
    const unknown = JSON.stringify({ assessment: { conclusionId: "conclusion_001", status: "unknown", counterEvidenceSpanIds: [], alternativeExplanations: [], applicabilityLimits: [], sampleBiasNotes: ["检索范围不足。"] } });
    await expect(falsification.submit({ command: command("falsification_unknown"), analysisProjectId: "analysis_001", conclusionId: "conclusion_001", rawOutput: unknown }))
      .resolves.toMatchObject({ kind: "ok" });
    await expect(driver.query<{ status: string }>({ sql: "SELECT status FROM coverage_entries WHERE module = 'independent_falsification'", params: [] }))
      .resolves.toEqual([{ status: "not_observed" }]);
    await expect(falsification.getWorkItem("analysis_001", "missing")).rejects.toThrow(/不存在/);
    expect(spanId).toMatch(/^sp/);
  });

  async function prepareConclusion() {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: command("reference"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "时刻表多出一趟列车。广播在三分钟后响起。" });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await corpus.prepare({ command: command("corpus"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete", budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 } });
    const spanId = (await driver.query<{ span_id: string }>({ sql: "SELECT span_id FROM source_spans ORDER BY start_byte ASC LIMIT 1", params: [] }))[0]!.span_id;
    const brief = createAnalysisBriefService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await brief.submit({ command: command("brief"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ questions: [{ id: "question_001", question: "异常信息如何建立期待？", rationale: "检查信息释放", productionUse: "指导悬念开场", requiredEvidence: ["段落"], estimatedCostTokens: 256, abstentionReason: "样本不足时弃权" }] }) });
    await brief.approve({ command: command("brief_approve"), analysisProjectId: "analysis_001" });
    const conclusions = createResearchConclusionService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await conclusions.submit({ command: command("conclusion"), analysisProjectId: "analysis_001", researchQuestionId: "question_001", rawOutput: JSON.stringify({ conclusions: [{ id: "conclusion_001", researchQuestionId: "question_001", conclusion: "异常信息的延迟解释会建立期待。", observations: [{ id: "observation_001", statement: "异常先于解释出现。", evidenceSpanIds: [spanId] }], evidenceSpanIds: [spanId], counterEvidenceSpanIds: [], alternativeExplanations: ["局部场景调度"], applicabilityBoundaries: ["悬疑信息释放"], productionImplications: ["先给异常再给解释。"], coverageStatus: "complete", epistemicStatus: "inferred" }] }) });
    return { falsification: createIndependentFalsificationService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }), spanId };
  }
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
