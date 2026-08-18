import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createIndependentFalsificationService } from "@/application/independent-falsification-service";
import { createMechanismAssetService } from "@/application/mechanism-asset-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createResearchConclusionService } from "@/application/research-conclusion-service";
import { createThreadGraphService } from "@/application/thread-graph-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("MechanismAsset Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-mechanism-service-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("仅以已反证结论创建候选，并由人类采纳后投影为无来源信息的 Writer 卡", async () => {
    const { mechanisms } = await prepare();
    const rawOutput = candidateOutput();

    await expect(mechanisms.propose({ command: command("mechanism_candidate"), analysisProjectId: "analysis_001", rawOutput }))
      .resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(mechanisms.get("mechanism_001")).resolves.toMatchObject({ mechanismAssetId: "mechanism_001", revision: 1, status: "candidate" });
    await expect(mechanisms.review({ command: { ...command("mechanism_adopt"), expectedRevision: 1, projectId: "project_001", actor: { kind: "human", id: "user_001" } }, mechanismAssetId: "mechanism_001", status: "adopted" }))
      .resolves.toMatchObject({ kind: "ok", revision: 2 });

    const adopted = await mechanisms.listAdopted("project_001");
    expect(adopted).toEqual([expect.objectContaining({ id: "mechanism_001", targetEffect: "让读者先感到可验证的异常，再延后解释。", targetLayers: ["draft"] })]);
    expect(JSON.stringify(adopted)).not.toContain("示例参考");
    expect(JSON.stringify(adopted)).not.toContain("脚步声");
    await expect(driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE tool = 'commit_mechanism_candidate'", params: [] }))
      .resolves.toEqual([expect.objectContaining({ args_json: expect.not.stringContaining("巡查员先看见") })]);
  });

  it("拒绝外部 Agent 自动采纳，以及不足三个不同 AnalysisUnit 的 distributed 卡", async () => {
    const { mechanisms } = await prepare();
    await mechanisms.propose({ command: command("mechanism_candidate_2"), analysisProjectId: "analysis_001", rawOutput: candidateOutput() });
    await expect(mechanisms.review({ command: { ...command("mechanism_auto"), expectedRevision: 1, projectId: "project_001", actor: { kind: "external_agent", id: "mcp" } }, mechanismAssetId: "mechanism_001", status: "adopted" }))
      .rejects.toThrow(/human/);

    const distributed = JSON.parse(candidateOutput()) as Record<string, unknown>;
    const card = distributed.card as Record<string, unknown>;
    card.id = "mechanism_distributed";
    card.scope = "distributed";
    card.evidenceInstances = [
      { id: "instance_1", originCandidateId: "conclusion_001", spanIds: ["sp00002"], chapterIndexes: [1], threadIds: [] },
      { id: "instance_2", originCandidateId: "conclusion_001", spanIds: ["sp00002"], chapterIndexes: [1], threadIds: [] },
      { id: "instance_3", originCandidateId: "conclusion_001", spanIds: ["sp00002"], chapterIndexes: [1], threadIds: [] },
    ];
    await expect(mechanisms.propose({ command: command("mechanism_distributed"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify(distributed) }))
      .rejects.toThrow(/三个不同/);
  });

  it("MCP 暴露候选与去来源化读取，并把 human_via_agent 采纳转为持久化确认", async () => {
    const { application, mechanisms } = await prepare();
    const handler = createApplicationMcpJsonRpcHandler({ application, mechanisms });
    const names = (((await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" }))?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["propose_mechanism_candidate", "list_mechanism_candidates", "get_mechanism_asset", "review_mechanism_asset", "list_adopted_mechanisms"]));

    const proposed = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "propose_mechanism_candidate", arguments: { commandId: "mcp_candidate", idempotencyKey: "mcp_candidate", correlationId: "mcp_mechanism", analysisProjectId: "analysis_001", rawOutput: candidateOutput() } } });
    expect((proposed?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const review = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "review_mechanism_asset", arguments: { commandId: "mcp_adopt", idempotencyKey: "mcp_adopt", correlationId: "mcp_mechanism", projectId: "project_001", mechanismAssetId: "mechanism_001", expectedRevision: 1, status: "adopted" } } });
    const confirmation = (review?.result as { structuredContent: { kind: string; confirmationId: string } }).structuredContent;
    expect(confirmation).toMatchObject({ kind: "needs_confirmation" });
    const approved = await handler({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "approve_confirmation", arguments: { confirmationId: confirmation.confirmationId, reason: "用户明确采纳机制" } } });
    expect((approved?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const adopted = await handler({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_adopted_mechanisms", arguments: { projectId: "project_001" } } });
    expect((adopted?.result as { structuredContent: Array<Record<string, unknown>> }).structuredContent).toEqual([expect.objectContaining({ id: "mechanism_001" })]);
    expect(JSON.stringify((adopted?.result as { structuredContent: unknown }).structuredContent)).not.toContain("脚步声");
  });

  async function prepare() {
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
    const mechanisms = createMechanismAssetService({ driver, commands: application.commands, objects });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "原创项目", status: "planning", payload: { schema_version: 1 } } });
    await references.importText({ command: command("reference"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "第一章\n门后有脚步声。" });
    await corpus.prepare({ command: command("corpus"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete", budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 } });
    const unitId = (await corpus.getOverview("analysis_001"))!.computeUnits[0]!.analysisUnitId;
    await facts.submit({ command: command("facts"), analysisProjectId: "analysis_001", analysisUnitId: unitId, rawOutput: JSON.stringify({ facts: [{ id: "fact_001", kind: "event", rawLabel: null, statement: "脚步声出现", subject: null, object: null, evidenceSpanIds: ["sp00002"], epistemicStatus: "observed" }] }) });
    await threads.submit({ command: command("thread"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ threads: [{ id: "thread_001", kind: "event", title: "脚步声", episodes: [{ id: "episode_001", role: "setup", rawLabel: null, summary: "脚步声出现", evidenceSpanIds: ["sp00002"], ordinal: 1 }], epistemicStatus: "observed", lifecycle: "open" }] }) });
    await brief.submit({ command: command("brief"), analysisProjectId: "analysis_001", rawOutput: JSON.stringify({ questions: [{ id: "question_001", question: "脚步声如何建立期待？", rationale: "验证期待线", productionUse: "指导章节入口", requiredEvidence: ["事件"], estimatedCostTokens: 256, abstentionReason: "证据不足时弃权" }] }) });
    await brief.approve({ command: command("brief_approve"), analysisProjectId: "analysis_001" });
    await conclusions.submit({ command: command("conclusion"), analysisProjectId: "analysis_001", researchQuestionId: "question_001", rawOutput: JSON.stringify({ conclusions: [{ id: "conclusion_001", researchQuestionId: "question_001", conclusion: "异常先出现会建立未解期待。", observations: [{ id: "observation_001", statement: "脚步声被单独呈现。", evidenceSpanIds: ["sp00002"] }], evidenceSpanIds: ["sp00002"], counterEvidenceSpanIds: [], alternativeExplanations: ["局部场景调度"], applicabilityBoundaries: ["信息尚未解释的入口"], productionImplications: ["先给异常再延后解释。"], coverageStatus: "complete", epistemicStatus: "inferred" }] }) });
    await falsification.submit({ command: command("falsification"), analysisProjectId: "analysis_001", conclusionId: "conclusion_001", rawOutput: JSON.stringify({ assessment: { conclusionId: "conclusion_001", status: "bounded", counterEvidenceSpanIds: ["sp00002"], alternativeExplanations: ["局部场景调度"], applicabilityLimits: ["样本只覆盖一个单元"], sampleBiasNotes: ["短文本"] } }) });
    return { application, mechanisms };
  }
});

function candidateOutput(): string {
  return JSON.stringify({
    card: { id: "mechanism_001", title: "先异常后解释", observation: "异常先出现", effectHypothesis: "让读者先感到可验证的异常，再延后解释。", when: ["场景需要建立未解期待"], do: ["先给出可核验异常", "延后提供解释"], avoid: ["不要立即说明原因"], evidenceSpanIds: ["sp00002"], counterexampleSpanIds: [], epistemicStatus: "inferred", lifecycle: "candidate", falsification: { status: "bounded", alternativeExplanations: ["局部场景调度"], applicabilityLimits: ["短样本"] }, scope: "local", applicability: ["信息尚未解释的章节入口"], targetLayers: ["draft"], adoption: "pending", originCandidateIds: ["conclusion_001"], evidenceInstances: [] },
    neutralExample: "巡查员先看见灯塔玻璃里掠过一束不该存在的光，直到下一段才得知那束光来自哪里。",
    forbiddenTerms: ["示例参考", "脚步声"],
  });
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
