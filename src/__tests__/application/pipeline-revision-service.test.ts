import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPipelineRevisionService } from "@/application/pipeline-revision-service";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import type { LocalFactExtractionBatchService } from "@/application/local-fact-extraction-batch-service";
import type { ChapterWriterService } from "@/application/chapter-writer-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("PipelineRevisionService", () => {
  let workspacePath: string;
  let driver: SqlDriver;
  beforeEach(async () => { workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-pipeline-")); driver = await createNodeSqlDriver({ workspacePath }); });
  afterEach(async () => { await driver.close(); await rm(workspacePath, { recursive: true, force: true }); });

  it("版本化保存线性领域步骤并以 CAS 拒绝过期编辑", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const pipelines = createPipelineRevisionService({ driver, commands: application.commands });
    await expect(pipelines.save({ command: command("create"), pipelineId: "analysis-to-mechanism", name: "分析到机制", steps: [{ id: "facts", tool: "commit_analysis_facts", enabled: true }] })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(pipelines.save({ command: command("stale"), pipelineId: "analysis-to-mechanism", name: "过期", expectedRevision: 0, steps: [{ id: "facts", tool: "commit_analysis_facts", enabled: true }] })).resolves.toMatchObject({ kind: "blocked" });
    await expect(pipelines.save({ command: command("update"), pipelineId: "analysis-to-mechanism", name: "分析到机制", expectedRevision: 1, steps: [{ id: "facts", tool: "commit_analysis_facts", enabled: true }, { id: "mechanism", tool: "commit_mechanism_candidate", enabled: true }] })).resolves.toMatchObject({ kind: "ok", revision: 2 });
    await expect(pipelines.list()).resolves.toEqual([expect.objectContaining({ pipelineId: "analysis-to-mechanism", revision: 2, steps: expect.arrayContaining([expect.objectContaining({ id: "mechanism" })]) })]);
  });

  it("拒绝 SQL 或原始批处理步骤", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const pipelines = createPipelineRevisionService({ driver, commands: application.commands });
    await expect(pipelines.save({ command: command("unsafe"), pipelineId: "unsafe", name: "不安全", steps: [{ id: "sql", tool: "sql_query", enabled: true }] })).rejects.toThrow(/非法/);
    await expect(pipelines.save({ command: command("unknown"), pipelineId: "unknown", name: "未知", steps: [{ id: "unknown", tool: "arbitrary_domain_name", enabled: true }] })).rejects.toThrow(/未登记/);
    await expect(pipelines.save({ command: command("secret"), pipelineId: "secret", name: "秘密", steps: [{ id: "facts", tool: "commit_analysis_facts", enabled: true, config: { apiKey: "never-store-this" } }] })).rejects.toThrow(/Secret/);
  });

  it("冻结版本为可审计的人工复核运行，并允许以新 runId 安全重跑", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.pipelines.save({ command: command("run_pipeline"), pipelineId: "analysis-to-mechanism", name: "分析到机制", steps: [
      { id: "facts", tool: "commit_analysis_facts", enabled: true }, { id: "brief", tool: "commit_analysis_brief", enabled: true },
    ] });
    await expect(application.pipelineRuns.start({ command: command("run_start"), runId: "run_001", pipelineId: "analysis-to-mechanism" })).resolves.toMatchObject({ kind: "ok" });
    await expect(application.pipelineRuns.get("run_001")).resolves.toMatchObject({
      status: "waiting_human", pipelineRevision: 1, nodes: [expect.objectContaining({ stepId: "facts", status: "pending" }), expect.objectContaining({ stepId: "brief", status: "pending" })],
    });
    await application.pipelineRuns.completeStep({ command: command("run_step_1"), runId: "run_001", stepId: "facts", note: "已由领域 FactLedger 服务提交并复核。" });
    await application.pipelineRuns.completeStep({ command: command("run_step_2"), runId: "run_001", stepId: "brief", note: "已由领域 AnalysisBrief 服务提交并复核。" });
    await expect(application.pipelineRuns.get("run_001")).resolves.toMatchObject({ status: "completed", nodes: [expect.objectContaining({ stepId: "facts", status: "completed" }), expect.objectContaining({ stepId: "brief", status: "completed" })] });
    await expect(application.pipelineRuns.start({ command: command("run_rerun"), runId: "run_002", pipelineId: "analysis-to-mechanism" })).resolves.toMatchObject({ kind: "ok" });
    await expect(application.pipelineRuns.list()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ runId: "run_001", status: "completed" }), expect.objectContaining({ runId: "run_002", status: "waiting_human" })]));
    await expect(application.commands.execute({ ...command("run_external_complete"), actor: { kind: "external_agent", id: "untrusted" }, tool: "complete_pipeline_run_step", args: { runId: "run_002", stepId: "facts", note: "不得代替人类复核" } })).resolves.toMatchObject({ kind: "blocked" });
    await expect(application.pipelineRuns.get("run_002")).resolves.toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ stepId: "facts", status: "pending" })]) });
  });

  it("MCP 只将已冻结且登记的 FactExtractor 步骤映射到批任务宿主", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.pipelines.save({ command: command("mcp_pipeline"), pipelineId: "facts-pipeline", name: "事实", steps: [{ id: "facts", tool: "start_local_fact_extraction_batch", enabled: true, config: { analysisProjectId: "analysis_001", maxTokens: 1024 } }] });
    await application.pipelineRuns.start({ command: command("mcp_run"), runId: "run_mcp", pipelineId: "facts-pipeline" });
    const batch = { start: vi.fn(async ({ taskId }: { taskId: string }) => ({ kind: "accepted" as const, taskId })), run: vi.fn(async () => null), cancel: vi.fn(async () => undefined), getTask: vi.fn(async () => null) } satisfies LocalFactExtractionBatchService;
    const handler = createApplicationMcpJsonRpcHandler({ application, pipelines: application.pipelines, batchFactExtraction: batch });
    const response = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute_pipeline_run_step", arguments: { runId: "run_mcp", stepId: "facts" } } });
    expect((response?.result as { structuredContent: { taskId: string; command: { kind: string } } }).structuredContent).toMatchObject({ taskId: "pipeline:run_mcp:facts", command: { kind: "accepted" } });
    expect(batch.start).toHaveBeenCalledWith(expect.objectContaining({ analysisProjectId: "analysis_001", maxTokens: 1024, baseURL: "http://configured-route.invalid/v1" }));
    expect(batch.run).toHaveBeenCalledWith("pipeline:run_mcp:facts");
  });

  it("MCP 仅以冻结的白名单配置启动 Writer V1，且不会跳过人工复核", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.pipelines.save({ command: command("writer_pipeline"), pipelineId: "writer-pipeline", name: "创作", steps: [{
      id: "writer", tool: "start_chapter_writer_v1", enabled: true,
      config: { projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", documentId: "production:chapter_draft:chapter_001:v1", title: "第一章", maxTokens: 2048 },
    }] });
    await application.pipelineRuns.start({ command: command("writer_run"), runId: "run_writer", pipelineId: "writer-pipeline" });
    const writer = { start: vi.fn(async ({ taskId }: { taskId: string }) => ({ kind: "accepted" as const, taskId })), run: vi.fn(async () => null), cancel: vi.fn(async () => undefined), getTask: vi.fn(async () => null), getDraft: vi.fn(async () => null) } satisfies ChapterWriterService;
    const handler = createApplicationMcpJsonRpcHandler({ application, pipelines: application.pipelines, writer });
    const response = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute_pipeline_run_step", arguments: { runId: "run_writer", stepId: "writer" } } });
    expect((response?.result as { structuredContent: { taskId: string } }).structuredContent).toMatchObject({ taskId: "pipeline:run_writer:writer" });
    expect(writer.start).toHaveBeenCalledWith(expect.objectContaining({ taskId: "pipeline:run_writer:writer", projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", documentId: "production:chapter_draft:chapter_001:v1", title: "第一章", maxTokens: 2048, baseURL: "http://configured-route.invalid/v1" }));
    expect(writer.run).toHaveBeenCalledWith("pipeline:run_writer:writer");
    await expect(application.pipelineRuns.get("run_writer")).resolves.toMatchObject({ nodes: [expect.objectContaining({ stepId: "writer", status: "pending" })] });

    await expect(application.pipelines.save({ command: command("unsafe_writer_pipeline"), pipelineId: "unsafe-writer-pipeline", name: "不安全创作", steps: [{
      id: "writer", tool: "start_chapter_writer_v1", enabled: true,
      config: { projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", documentId: "production:chapter_draft:chapter_001:v1", title: "第一章", prompt: "不得写入 Pipeline" },
    }] })).rejects.toThrow(/Prompt|配置/);
    expect(writer.start).toHaveBeenCalledTimes(1);
  });
});

function command(id: string) { return { schemaVersion: 1 as const, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human" as const, id: "user" }, createdAt: 1_700_000_000_000 }; }
