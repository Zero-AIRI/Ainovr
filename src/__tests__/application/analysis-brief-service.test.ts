import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("AnalysisBrief 服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-analysis-brief-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("保存最多五个研究问题为待确认 Brief；批准前不能将其伪装为解释型分析就绪", async () => {
    const brief = await prepare();
    const rawOutput = JSON.stringify({ questions: [
      { id: "question_001", question: "关键物件如何改变读者期待？", rationale: "用于检查物件线是否形成承诺", productionUse: "指导章节中物件信息的释放节奏", requiredEvidence: ["物件出现与状态变化"], estimatedCostTokens: 1200, abstentionReason: "物件样本不足时不形成结论" },
      { id: "question_002", question: "场景转场是否伴随信息释放？", rationale: "用于检查章节接口", productionUse: "指导场景切换时的信息交接", requiredEvidence: ["转场前后事件与地点"], estimatedCostTokens: 800, abstentionReason: "转场证据不足时保留未知" },
    ] });
    await expect(brief.submit({ command: command("brief_001"), analysisProjectId: "analysis_001", rawOutput })).resolves.toMatchObject({ kind: "ok" });
    await expect(brief.get("analysis_001")).resolves.toEqual(expect.objectContaining({ status: "pending_review", questions: [
      expect.objectContaining({ id: "question_001", ordinal: 1, status: "pending_review" }),
      expect.objectContaining({ id: "question_002", ordinal: 2, status: "pending_review" }),
    ] }));
    await expect(brief.approve({ command: command("brief_approve_001"), analysisProjectId: "analysis_001" })).resolves.toMatchObject({ kind: "ok" });
    await expect(brief.get("analysis_001")).resolves.toEqual(expect.objectContaining({ status: "approved", questions: [
      expect.objectContaining({ status: "approved" }),
      expect.objectContaining({ status: "approved" }),
    ] }));
    await expect(driver.query<{ status: string; reason: string }>({ sql: "SELECT status, reason FROM coverage_entries WHERE analysis_project_id = ? AND module = 'analysis_brief' ORDER BY created_at ASC", params: ["analysis_001"] }))
      .resolves.toEqual([{ status: "needs_review", reason: "awaiting_human_approval" }, { status: "complete", reason: "analysis_brief_approved" }]);
  });

  it("超过五项或字段不完整的 Brief 在任何写入前失败关闭", async () => {
    const brief = await prepare();
    const questions = Array.from({ length: 6 }, (_, index) => ({ id: `q_${index}`, question: "问题", rationale: "理由", productionUse: "用途", requiredEvidence: ["证据"], estimatedCostTokens: 1, abstentionReason: "弃权" }));
    await expect(brief.submit({ command: command("brief_002"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ questions }) })).rejects.toThrow(/五/);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM research_questions", params: [] })).resolves.toEqual([{ count: 0 }]);
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
    return createAnalysisBriefService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
  }
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
