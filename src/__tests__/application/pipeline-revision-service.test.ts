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
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000, modelResolver: fakeRoute("fact_extractor") });
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
    await expect(pipelines.save({ command: command("execution"), pipelineId: "execution", name: "非法执行分类", steps: [{ id: "facts", tool: "commit_analysis_facts", enabled: true, execution: "arbitrary" as never }] })).rejects.toThrow(/execution.*非法/);
    await expect(pipelines.save({ command: command("cycle"), pipelineId: "cycle", name: "循环依赖", steps: [
      { id: "facts", tool: "commit_analysis_facts", enabled: true, dependsOn: ["brief"] },
      { id: "brief", tool: "commit_analysis_brief", enabled: true, dependsOn: ["facts"] },
    ] })).rejects.toThrow(/依赖.*循环|循环.*依赖/);
  });

  it("冻结版本为可审计的人工复核运行，并允许以新 runId 安全重跑", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000, modelResolver: fakeRoute("fact_extractor") });
    await application.pipelines.save({ command: command("run_pipeline"), pipelineId: "analysis-to-mechanism", name: "分析到机制", steps: [
      { id: "facts", tool: "commit_analysis_facts", enabled: true }, { id: "brief", tool: "commit_analysis_brief", enabled: true, dependsOn: ["facts"] },
    ] });
    await expect(application.pipelineRuns.start({ command: command("run_start"), runId: "run_001", pipelineId: "analysis-to-mechanism" })).resolves.toMatchObject({ kind: "ok" });
    await expect(application.pipelineRuns.get("run_001")).resolves.toMatchObject({
      status: "waiting_human", pipelineRevision: 1, nodes: [expect.objectContaining({ stepId: "facts", status: "pending" }), expect.objectContaining({ stepId: "brief", dependsOn: ["facts"], status: "pending" })],
    });
    await expect(application.commands.execute({
      ...command("run_step_transactional_out_of_order"), tool: "complete_pipeline_run_step",
      args: { runId: "run_001", stepId: "brief", note: "命令层也不得绕过前置节点。" },
    })).resolves.toMatchObject({ kind: "error" });
    await expect(application.pipelineRuns.completeStep({ command: command("run_step_out_of_order"), runId: "run_001", stepId: "brief", note: "不得跳过事实步骤。" })).resolves.toMatchObject({ kind: "blocked" });
    await application.pipelineRuns.completeStep({ command: command("run_step_1"), runId: "run_001", stepId: "facts", note: "已由领域 FactLedger 服务提交并复核。" });
    await application.pipelineRuns.completeStep({ command: command("run_step_2"), runId: "run_001", stepId: "brief", note: "已由领域 AnalysisBrief 服务提交并复核。" });
    await expect(application.pipelineRuns.get("run_001")).resolves.toMatchObject({ status: "completed", nodes: [expect.objectContaining({ stepId: "facts", status: "completed" }), expect.objectContaining({ stepId: "brief", status: "completed" })] });
    await expect(application.pipelineRuns.start({ command: command("run_rerun"), runId: "run_002", pipelineId: "analysis-to-mechanism" })).resolves.toMatchObject({ kind: "ok" });
    await expect(application.pipelineRuns.list()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ runId: "run_001", status: "completed" }), expect.objectContaining({ runId: "run_002", status: "waiting_human" })]));
    await expect(application.commands.execute({ ...command("run_external_complete"), actor: { kind: "external_agent", id: "untrusted" }, tool: "complete_pipeline_run_step", args: { runId: "run_002", stepId: "facts", note: "不得代替人类复核" } })).resolves.toMatchObject({ kind: "blocked" });
    await expect(application.pipelineRuns.get("run_002")).resolves.toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ stepId: "facts", status: "pending" })]) });
  });

  it("读取损坏的冻结快照时 fail closed，不把非法 execution 当成可运行步骤", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.pipelines.save({ command: command("corrupt_pipeline"), pipelineId: "corrupt-pipeline", name: "损坏快照基线", steps: [{ id: "facts", tool: "commit_analysis_facts", enabled: true }] });
    await driver.execute({ sql: "INSERT INTO run_snapshots(snapshot_id, pipeline_id, pipeline_revision, payload_json, created_at) VALUES (?, ?, ?, ?, ?)", params: ["snapshot_corrupt", "corrupt-pipeline", 1, JSON.stringify({ schema_version: 1, steps: [{ id: "facts", tool: "commit_analysis_facts", enabled: true, execution: "arbitrary" }] }), 1_700_000_000_000] });
    await driver.execute({ sql: "INSERT INTO runs(run_id, snapshot_id, project_id, status, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", params: ["run_corrupt", "snapshot_corrupt", null, "waiting_human", null, 1_700_000_000_000, 1_700_000_000_000] });
    await expect(application.pipelineRuns.get("run_corrupt")).rejects.toThrow(/步骤损坏/);
  });

  it("MCP 只将已冻结且登记的 FactExtractor 步骤映射到批任务宿主", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000, modelResolver: fakeRoute("fact_extractor") });
    await application.pipelines.save({ command: command("mcp_pipeline"), pipelineId: "facts-pipeline", name: "事实", steps: [{ id: "facts", tool: "start_local_fact_extraction_batch", enabled: true, config: { analysisProjectId: "analysis_001", maxTokens: 1024 } }] });
    await application.pipelineRuns.start({ command: command("mcp_run"), runId: "run_mcp", pipelineId: "facts-pipeline" });
    await driver.execute({ sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, ?, 'queued', NULL, NULL, NULL, NULL, 0, ?, ?)", params: ["pipeline:run_mcp:facts", "pipeline-task:run_mcp:facts", "local_fact_extraction_batch", 1_700_000_000_000, 1_700_000_000_000] });
    const batch = { start: vi.fn(async ({ taskId }: { taskId: string }) => ({ kind: "accepted" as const, taskId })), run: vi.fn(async () => null), cancel: vi.fn(async () => undefined), getTask: vi.fn(async () => null) } satisfies LocalFactExtractionBatchService;
    const handler = createApplicationMcpJsonRpcHandler({ application, pipelines: application.pipelines, batchFactExtraction: batch });
    const response = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute_pipeline_run_step", arguments: { runId: "run_mcp", stepId: "facts" } } });
    expect((response?.result as { structuredContent: { taskId: string; command: { kind: string } } }).structuredContent).toMatchObject({ taskId: "pipeline:run_mcp:facts", command: { kind: "accepted" } });
    expect(batch.start).toHaveBeenCalledWith(expect.objectContaining({ analysisProjectId: "analysis_001", maxTokens: 1024, baseURL: "http://127.0.0.1:11434/v1", model: "qwen3:8b" }));
    expect(batch.run).toHaveBeenCalledWith("pipeline:run_mcp:facts");
    await expect(application.pipelineRuns.get("run_mcp")).resolves.toMatchObject({
      routeSnapshots: { fact_extractor: expect.objectContaining({ providerProfileId: "provider_local", model: "qwen3:8b", protocol: "chat_completions" }) },
      nodes: [expect.objectContaining({ stepId: "facts", taskId: "pipeline:run_mcp:facts", status: "pending" })],
    });
  });

  it("没有 ModelResolver 时拒绝执行 Pipeline 模型步骤，不使用占位路由", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.pipelines.save({ command: command("no_route_pipeline"), pipelineId: "no-route-pipeline", name: "无路由", steps: [{ id: "facts", tool: "start_local_fact_extraction_batch", enabled: true, config: { analysisProjectId: "analysis_001" } }] });
    await application.pipelineRuns.start({ command: command("no_route_run"), runId: "run_no_route", pipelineId: "no-route-pipeline" });
    const batch = { start: vi.fn(), run: vi.fn(), cancel: vi.fn(), getTask: vi.fn() } as unknown as LocalFactExtractionBatchService;
    const handler = createApplicationMcpJsonRpcHandler({ application, pipelines: application.pipelines, batchFactExtraction: batch });
    const response = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute_pipeline_run_step", arguments: { runId: "run_no_route", stepId: "facts" } } });
    expect((response?.result as { isError?: boolean; content?: Array<{ text?: string }> }).isError).toBe(true);
    expect((response?.result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toMatch(/ModelResolver|Provider 路由/);
    expect(batch.start).not.toHaveBeenCalled();
  });

  it("只有已绑定且成功的可执行任务才能完成 Pipeline 节点", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000, modelResolver: fakeRoute("writer") });
    await application.pipelines.save({ command: command("lineage_pipeline"), pipelineId: "lineage-pipeline", name: "lineage", steps: [{ id: "writer", tool: "start_chapter_writer_v1", enabled: true, config: { projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", documentId: "production:chapter_draft:chapter_001:v1", title: "第一章" } }] });
    await application.pipelineRuns.start({ command: command("lineage_run"), runId: "run_lineage", pipelineId: "lineage-pipeline" });
    await expect(application.pipelineRuns.completeStep({ command: command("lineage_without_task"), runId: "run_lineage", stepId: "writer", note: "伪造完成" })).resolves.toMatchObject({ kind: "blocked" });
    await driver.execute({ sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?)", params: ["task_lineage", "resource:task_lineage", "local_creation", "failed", 1_700_000_000_000, 1_700_000_000_000] });
    await expect(application.commands.execute({ ...command("bind_failed_task"), actor: { kind: "internal_agent", id: "test-pipeline" }, tool: "bind_pipeline_run_task", args: { runId: "run_lineage", stepId: "writer", taskId: "task_lineage" } })).resolves.toMatchObject({ kind: "ok" });
    await expect(application.pipelineRuns.completeStep({ command: command("lineage_failed_task"), runId: "run_lineage", stepId: "writer", note: "失败任务" })).resolves.toMatchObject({ kind: "blocked" });
    await driver.execute({ sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?)", params: ["a".repeat(64), 1, "text/plain", 1_700_000_000_000, 1_700_000_000_000] });
    await driver.execute({ sql: "UPDATE tasks SET status = 'succeeded', output_object_hash = ? WHERE task_id = ?", params: ["a".repeat(64), "task_lineage"] });
    await expect(application.pipelineRuns.completeStep({ command: command("lineage_success_task"), runId: "run_lineage", stepId: "writer", note: "真实任务已成功并复核" })).resolves.toMatchObject({ kind: "ok" });
    await expect(application.pipelineRuns.get("run_lineage")).resolves.toMatchObject({ nodes: [expect.objectContaining({ taskId: "task_lineage", outputObjectHash: "a".repeat(64), status: "completed" })] });
  });

  it("MCP 仅以冻结的白名单配置启动 Writer V1，且不会跳过人工复核", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000, modelResolver: fakeRoute("writer") });
    await application.pipelines.save({ command: command("writer_pipeline"), pipelineId: "writer-pipeline", name: "创作", steps: [{
      id: "writer", tool: "start_chapter_writer_v1", enabled: true,
      config: { projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", documentId: "production:chapter_draft:chapter_001:v1", title: "第一章", maxTokens: 2048 },
    }] });
    await application.pipelineRuns.start({ command: command("writer_run"), runId: "run_writer", pipelineId: "writer-pipeline" });
    await driver.execute({ sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, ?, 'queued', NULL, NULL, NULL, NULL, 0, ?, ?)", params: ["pipeline:run_writer:writer", "pipeline-task:run_writer:writer", "local_creation_draft", 1_700_000_000_000, 1_700_000_000_000] });
    const writer = { start: vi.fn(async ({ taskId }: { taskId: string }) => ({ kind: "accepted" as const, taskId })), run: vi.fn(async () => null), cancel: vi.fn(async () => undefined), getTask: vi.fn(async () => null), getDraft: vi.fn(async () => null) } satisfies ChapterWriterService;
    const handler = createApplicationMcpJsonRpcHandler({ application, pipelines: application.pipelines, writer });
    const response = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute_pipeline_run_step", arguments: { runId: "run_writer", stepId: "writer" } } });
    expect((response?.result as { structuredContent: { taskId: string } }).structuredContent).toMatchObject({ taskId: "pipeline:run_writer:writer" });
    expect(writer.start).toHaveBeenCalledWith(expect.objectContaining({ taskId: "pipeline:run_writer:writer", projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", documentId: "production:chapter_draft:chapter_001:v1", title: "第一章", maxTokens: 2048, baseURL: "http://127.0.0.1:11434/v1", model: "qwen3:8b", frozenRoute: expect.objectContaining({ role: "writer", model: "qwen3:8b" }) }));
    expect(writer.run).toHaveBeenCalledWith("pipeline:run_writer:writer");
    await expect(application.pipelineRuns.get("run_writer")).resolves.toMatchObject({ nodes: [expect.objectContaining({ stepId: "writer", status: "pending" })] });

    await expect(application.pipelines.save({ command: command("unsafe_writer_pipeline"), pipelineId: "unsafe-writer-pipeline", name: "不安全创作", steps: [{
      id: "writer", tool: "start_chapter_writer_v1", enabled: true,
      config: { projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", documentId: "production:chapter_draft:chapter_001:v1", title: "第一章", prompt: "不得写入 Pipeline" },
    }] })).rejects.toThrow(/Prompt|配置/);
    expect(writer.start).toHaveBeenCalledTimes(1);
  });

  it("MCP 不会把 human_review 节点当成可自动执行的模型步骤", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.pipelines.save({ command: command("human_gate"), pipelineId: "human-gate", name: "人工门", steps: [{
      id: "writer", tool: "start_chapter_writer_v1", enabled: true, execution: "human_review",
      config: { projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", documentId: "production:chapter_draft:chapter_001:v1", title: "第一章" },
    }] });
    await application.pipelineRuns.start({ command: command("human_gate_run"), runId: "run_human_gate", pipelineId: "human-gate" });
    const writer = { start: vi.fn(), run: vi.fn(), cancel: vi.fn(), getTask: vi.fn(), getDraft: vi.fn() } as unknown as ChapterWriterService;
    const handler = createApplicationMcpJsonRpcHandler({ application, pipelines: application.pipelines, writer });
    const response = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute_pipeline_run_step", arguments: { runId: "run_human_gate", stepId: "writer" } } });
    expect((response?.result as { isError?: boolean; content?: Array<{ text?: string }> }).isError).toBe(true);
    expect((response?.result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toMatch(/executable|自动执行|人工/);
    expect(writer.start).not.toHaveBeenCalled();
  });

  it("MCP Pipeline schema 允许外部 Agent 声明执行分类与前置依赖", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const handler = createApplicationMcpJsonRpcHandler({ application, pipelines: application.pipelines });
    const response = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const tools = (response?.result as { tools: Array<{ name: string; inputSchema: { properties: { steps: { items: { properties: Record<string, unknown> } } } } }> }).tools;
    const pipeline = tools.find((tool) => tool.name === "save_pipeline_revision");
    expect(pipeline?.inputSchema.properties.steps.items.properties).toEqual(expect.objectContaining({ execution: expect.any(Object), dependsOn: expect.any(Object) }));
  });
});

function command(id: string) { return { schemaVersion: 1 as const, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human" as const, id: "user" }, createdAt: 1_700_000_000_000 }; }
function fakeRoute(role: "writer" | "reader" | "reviewer" | "editor" | "fact_extractor") {
  return { resolve: vi.fn(async () => ({ role, providerProfileId: "provider_local", baseURL: "http://127.0.0.1:11434/v1", model: "qwen3:8b", protocol: "chat_completions" as const, contextWindowTokens: 4096, maxOutputTokens: 1024, safetyMarginRatio: 0.2, isCloud: false, cloudEscalation: "never" as const })) };
}
