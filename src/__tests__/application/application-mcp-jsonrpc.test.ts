import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createCommandService, type CommandPlanner } from "@/application/command-service";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createStructuralReadingMapService } from "@/application/structural-reading-map-service";
import { createLocalFactExtractionService } from "@/application/local-fact-extraction-service";
import type { LocalFactExtractionBatchService } from "@/application/local-fact-extraction-batch-service";
import { createThreadGraphService } from "@/application/thread-graph-service";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createResearchConclusionService } from "@/application/research-conclusion-service";
import { createIndependentFalsificationService } from "@/application/independent-falsification-service";
import { createResearchDossierService } from "@/application/research-dossier-service";
import { createEvidenceWorkbenchService } from "@/application/evidence-workbench-service";
import { createLocalCreationService } from "@/application/local-creation-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createTaskRunner } from "@/application/task-runner";
import type { TaskRecord } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("Application MCP JSON-RPC", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-application-mcp-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("只经 Application Service 暴露工作区与项目领域工具", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const objects = await createNodeObjectStore({ workspacePath });
    const application = createWorkspaceApplicationService({ driver, schemas, objects, now: () => 1_700_000_000_000 });
    const handler = createApplicationMcpJsonRpcHandler(application);

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["get_workspace_status", "get_capabilities", "list_changes", "create_novel_project", "get_novel_project", "list_novel_projects", "get_project_workbench", "list_project_documents", "get_document", "get_reference_workbench", "list_pending_mechanism_assets", "list_coverage_gaps", "list_provider_profiles", "save_provider_profile", "get_workspace_settings", "save_workspace_settings", "list_pending_confirmations", "get_confirmation", "approve_confirmation", "reject_confirmation"]));
    expect(names).not.toContain("apply_batch");
    expect(names).not.toContain("read_data_file");
    expect(names).not.toContain("write_data_file");
    const writerTool = ((listed?.result as { tools: Array<{ name: string; inputSchema: { required: string[] } }> }).tools).find((tool) => tool.name === "start_chapter_writer_v1");
    expect(writerTool?.inputSchema.required ?? []).not.toContain("baseURL");
    expect(writerTool?.inputSchema.required ?? []).not.toContain("model");

    const created = await handler({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_novel_project",
        arguments: {
          commandId: "command_001",
          idempotencyKey: "idem_001",
          correlationId: "correlation_001",
          projectId: "project_001",
          title: "雾港记录",
          status: "planning",
          payload: { schema_version: 1, intent: "近未来悬疑" },
        },
      },
    });
    expect((created?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "novel_project", id: "project_001" }] });

    const read = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_novel_project", arguments: { projectId: "project_001" } } });
    expect((read?.result as { structuredContent: { projectId: string; revision: number } }).structuredContent).toMatchObject({ projectId: "project_001", revision: 1 });

    const workbench = await handler({ jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "get_project_workbench", arguments: { projectId: "project_001" } } });
    expect((workbench?.result as { structuredContent: { projectId: string; productionCursor: unknown } }).structuredContent).toMatchObject({ projectId: "project_001", productionCursor: null });
    const pendingMechanisms = await handler({ jsonrpc: "2.0", id: 301, method: "tools/call", params: { name: "list_pending_mechanism_assets", arguments: {} } });
    expect((pendingMechanisms?.result as { structuredContent: unknown }).structuredContent).toEqual([]);
    const coverageGaps = await handler({ jsonrpc: "2.0", id: 302, method: "tools/call", params: { name: "list_coverage_gaps", arguments: {} } });
    expect((coverageGaps?.result as { structuredContent: unknown }).structuredContent).toEqual([]);

    const content = await objects.put({ content: new TextEncoder().encode("只由领域工具读取的正文"), mediaType: "text/plain; charset=utf-8" });
    await application.commands.execute({
      schemaVersion: 1, commandId: "command_document_001", idempotencyKey: "idem_document_001", correlationId: "correlation_document_001", actor: { kind: "internal_agent", id: "test" }, projectId: "project_001", tool: "commit_project_planning_document",
      args: { projectId: "project_001", documentId: "production:chapter_draft:chapter_001:v1", documentType: "local_creation_draft", status: "draft", expectedRevision: null, payload: { schema_version: 1, kind: "local_creation_draft", title: "第一章 V1" }, contentObject: content }, createdAt: 1_700_000_000_000,
    });
    const documents = await handler({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "list_project_documents", arguments: { projectId: "project_001" } } });
    expect((documents?.result as { structuredContent: Array<{ documentId: string }> }).structuredContent).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: "production:chapter_draft:chapter_001:v1" })]));
    const document = await handler({ jsonrpc: "2.0", id: 32, method: "tools/call", params: { name: "get_document", arguments: { projectId: "project_001", documentId: "production:chapter_draft:chapter_001:v1" } } });
    expect((document?.result as { structuredContent: { content: string } }).structuredContent).toMatchObject({ content: "只由领域工具读取的正文" });

    const provider = await handler({ jsonrpc: "2.0", id: 33, method: "tools/call", params: { name: "save_provider_profile", arguments: { commandId: "command_provider_001", idempotencyKey: "idem_provider_001", correlationId: "correlation_provider_001", providerProfileId: "provider_local", name: "本机 Ollama", baseURL: "http://localhost:11434/v1", defaultModel: "qwen3.5:9b", routes: [{ role: "writer", model: "qwen3.5:9b" }] } } });
    expect((provider?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "provider_profile", id: "provider_local" }] });

    const settings = await handler({ jsonrpc: "2.0", id: 34, method: "tools/call", params: { name: "get_workspace_settings", arguments: {} } });
    expect((settings?.result as { structuredContent: unknown }).structuredContent).toMatchObject({ revision: 0, automationMode: "supervised" });
    const savedSettings = await handler({ jsonrpc: "2.0", id: 35, method: "tools/call", params: { name: "save_workspace_settings", arguments: { commandId: "command_workspace_settings_001", idempotencyKey: "idem_workspace_settings_001", correlationId: "correlation_workspace_settings_001", automationMode: "manual", contextWindowTokens: 16_384, maxOutputTokens: 2_048, safetyMarginRatio: 0.2, cloudEscalation: "never" } } });
    expect((savedSettings?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "data_policy", id: "workspace:default" }] });

    const changes = await handler({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_changes", arguments: { after: 0 } } });
    expect((changes?.result as { structuredContent: Array<{ changeSeq: number; resourceId: string }> }).structuredContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: "project_001" }),
      expect.objectContaining({ resourceId: "production:chapter_draft:chapter_001:v1" }),
    ]));
    const capabilities = await handler({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_capabilities", arguments: {} } });
    expect((capabilities?.result as { structuredContent: unknown }).structuredContent).toMatchObject({ protocolVersion: 1, controlPlane: "stdio" });
  });

  it("MCP 将父级本地事实批任务转交给同一应用服务，而不暴露数据库或路径", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const batch = {
      start: vi.fn(async ({ taskId }: { taskId: string }) => ({ kind: "accepted" as const, taskId })),
      run: vi.fn(async (taskId: string) => taskRecord(taskId, "running")),
      cancel: vi.fn(async () => undefined),
      getTask: vi.fn(async (taskId: string) => taskRecord(taskId, "queued")),
    } satisfies LocalFactExtractionBatchService;
    const handler = createApplicationMcpJsonRpcHandler({ application, batchFactExtraction: batch });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["start_local_fact_extraction_batch", "resume_local_fact_extraction_batch"]));
    expect(names).not.toContain("read_data_file");

    const started = await handler({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "start_local_fact_extraction_batch", arguments: {
        commandId: "command_batch_001", idempotencyKey: "idem_batch_001", correlationId: "correlation_batch_001",
        taskId: "batch_task_001", analysisProjectId: "analysis_001", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 2048,
      } },
    });
    expect((started?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "accepted", taskId: "batch_task_001" });
    expect(batch.start).toHaveBeenCalledWith(expect.objectContaining({ taskId: "batch_task_001", analysisProjectId: "analysis_001", model: "qwen3.5:9b" }));
    expect(batch.run).toHaveBeenCalledWith("batch_task_001");

    const resumed = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "resume_local_fact_extraction_batch", arguments: { taskId: "batch_task_001" } } });
    expect((resumed?.result as { structuredContent: unknown }).structuredContent).toMatchObject({ taskId: "batch_task_001", status: "queued" });
    expect(batch.run).toHaveBeenCalledTimes(2);
  });

  it("任务工具通过 TaskRunner 查询、取消、等待和重试", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const tasks = createTaskRunner(driver, { now: () => 1_700_000_000_000 });
    const application = createWorkspaceApplicationService({ driver, schemas, tasks, now: () => 1_700_000_000_000 });
    await tasks.enqueue({ taskId: "task_001", resourceKey: "analysis:1", taskType: "reference_analysis", inputObjectHash: null });
    await tasks.claim("task_001", "host_a");
    const handler = createApplicationMcpJsonRpcHandler({ application, tasks });

    const names = (((await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" }))?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toContain("get_task");
    expect(names).toContain("cancel_task");
    expect(names).toContain("wait_task");
    expect(names).toContain("retry_task");

    const cancelled = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cancel_task", arguments: { taskId: "task_001" } } });
    expect((cancelled?.result as { structuredContent: { status: string } }).structuredContent).toMatchObject({ status: "cancel_requested" });
    await tasks.cancel("task_001", "host_a");
    const retried = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "retry_task", arguments: { taskId: "task_001" } } });
    expect((retried?.result as { structuredContent: { status: string; retryCount: number } }).structuredContent).toMatchObject({ status: "queued", retryCount: 1 });
  });

  it("确认工具列出并以 human_via_agent 批准持久化命令", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const base = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const commands = createCommandService(driver, confirmationPlanner(), () => 1_700_000_000_000);
    await commands.execute({
      schemaVersion: 1, commandId: "command_confirm_001", idempotencyKey: "idem_confirm_001", correlationId: "correlation_confirm_001",
      actor: { kind: "human", id: "user_001" }, tool: "confirmed_write", args: {}, createdAt: 1_700_000_000_000,
    });
    const handler = createApplicationMcpJsonRpcHandler({ application: { ...base, commands } });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_pending_confirmations", arguments: {} } });
    expect((listed?.result as { structuredContent: Array<{ confirmationId: string }> }).structuredContent).toEqual([{ confirmationId: "confirmation:command_confirm_001", risk: "overwrite", expiresAt: 1_700_000_060_000 }]);
    const approved = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approve_confirmation", arguments: { confirmationId: "confirmation:command_confirm_001", reason: "用户批准" } } });
    expect((approved?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    await expect(driver.query<{ value_json: string }>({ sql: "SELECT value_json FROM workspace_meta WHERE key = 'confirmed'", params: [] })).resolves.toEqual([{ value_json: '{"schema_version":1,"value":"approved"}' }]);
  });

  it("MCP 可以读取并拒绝待确认命令，且不返回原始命令参数", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const base = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const commands = createCommandService(driver, confirmationPlanner(), () => 1_700_000_000_000);
    await commands.execute({
      schemaVersion: 1, commandId: "command_confirm_002", idempotencyKey: "idem_confirm_002", correlationId: "correlation_confirm_002",
      actor: { kind: "human", id: "user_001" }, tool: "confirmed_write", args: { sensitivePrompt: "不应暴露" }, createdAt: 1_700_000_000_000,
    });
    const handler = createApplicationMcpJsonRpcHandler({ application: { ...base, commands } });

    const detail = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_confirmation", arguments: { confirmationId: "confirmation:command_confirm_002" } } });
    expect((detail?.result as { structuredContent: Record<string, unknown> }).structuredContent).toMatchObject({ confirmationId: "confirmation:command_confirm_002", status: "pending", tool: "confirmed_write" });
    expect(JSON.stringify((detail?.result as { structuredContent: unknown }).structuredContent)).not.toContain("不应暴露");

    const rejected = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "reject_confirmation", arguments: { confirmationId: "confirmation:command_confirm_002", reason: "用户拒绝" } } });
    expect((rejected?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "blocked" });
  });

  it("MCP 可以启动本地创作任务并读取已提交的草稿，不开放通用文件读取", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({
      schemaVersion: 1, commandId: "command_project_001", idempotencyKey: "idem_project_001", correlationId: "correlation_project_001",
      actor: { kind: "human", id: "user_001" }, tool: "create_novel_project",
      args: { projectId: "project_001", title: "雾港记录", status: "planning", payload: { schema_version: 1 } }, createdAt: 1_700_000_000_000,
    });
    const tasks = createTaskRunner(driver, { now: () => 1_700_000_000_000 });
    const creation = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks, objects: await createNodeObjectStore({ workspacePath }), hostId: "mcp-test",
      caller: { complete: async () => ({ text: "雨声落在玻璃上。", finishReason: "stop" }) }, now: () => 1_700_000_000_000,
    });
    const handler = createApplicationMcpJsonRpcHandler({ application, tasks, creation });

    const tools = ((await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" }))?.result as { tools: Array<{ name: string; inputSchema: { required: string[] } }> }).tools;
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["start_local_creation", "get_local_creation_draft", "resume_local_creation"]));
    expect(names).not.toContain("read_data_file");
    expect(tools.find((tool) => tool.name === "start_local_creation")?.inputSchema.required).not.toContain("baseURL");
    expect(tools.find((tool) => tool.name === "start_local_creation")?.inputSchema.required).not.toContain("model");

    const started = await handler({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "start_local_creation", arguments: {
          commandId: "command_draft_001", idempotencyKey: "idem_draft_001", correlationId: "correlation_draft_001",
          taskId: "task_draft_001", documentId: "draft_001", projectId: "project_001", title: "第一章", prompt: "写原创开场。",
          maxTokens: 2048,
        },
      },
    });
    expect((started?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "accepted", taskId: "task_draft_001" });
    await tasks.wait("task_draft_001", 1_000);
    const draft = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_local_creation_draft", arguments: { documentId: "draft_001" } } });
    expect((draft?.result as { structuredContent: { text: string; model: string } }).structuredContent).toMatchObject({ text: "雨声落在玻璃上。", model: "configured-route" });
  });

  it("MCP 仅通过明确文本导入参考作品，并按字节范围读取原文摘录", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const references = createReferenceImportService({
      driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000,
    });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    const facts = createAnalysisFactService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    const maps = createStructuralReadingMapService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    const tasks = createTaskRunner(driver, { now: () => 1_700_000_000_000 });
    const factExtraction = createLocalFactExtractionService({
      driver, commands: application.commands, tasks, objects: await createNodeObjectStore({ workspacePath }), facts,
      caller: { complete: async () => ({ text: JSON.stringify({ facts: [{ id: "fact_001", kind: "event", rawLabel: null, statement: "出现中文原文", subject: null, object: null, evidenceSpanIds: ["sp00001"], epistemicStatus: "observed" }] }), finishReason: "stop" }) },
      hostId: "mcp-fact-test", now: () => 1_700_000_000_000,
    });
    const threads = createThreadGraphService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    const brief = createAnalysisBriefService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    const conclusions = createResearchConclusionService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    const falsification = createIndependentFalsificationService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    const dossier = createResearchDossierService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    const workbench = createEvidenceWorkbenchService({ driver });
    const handler = createApplicationMcpJsonRpcHandler({ application, tasks, references, corpus, facts, maps, factExtraction, threads, brief, conclusions, falsification, dossier, workbench });
    const names = (((await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" }))?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["import_reference_text", "list_reference_works", "get_reference_work", "get_source_excerpt", "update_analysis_segmentation", "get_analysis_overview", "create_structural_reading_map", "get_structural_reading_map", "start_local_fact_extraction", "resume_local_fact_extraction", "reconfigure_local_fact_extraction", "submit_analysis_facts", "get_fact_ledger", "submit_thread_graph", "get_thread_graph", "submit_analysis_brief", "get_analysis_brief", "approve_analysis_brief", "submit_research_conclusions", "get_research_conclusions", "get_falsification_work_item", "submit_independent_falsification", "get_independent_falsification", "create_research_dossier", "get_research_dossier", "get_analysis_evidence", "list_analysis_coverage"]));
    expect(names).not.toContain("read_data_file");

    const imported = await handler({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "import_reference_text", arguments: {
        commandId: "command_reference_001", idempotencyKey: "idem_reference_001", correlationId: "correlation_reference_001",
        referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "中文原文",
      } },
    });
    expect((imported?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const listed = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_reference_works", arguments: {} } });
    expect((listed?.result as { structuredContent: Array<{ referenceWorkId: string }> }).structuredContent).toEqual([expect.objectContaining({ referenceWorkId: "reference_001" })]);
    const excerpt = await handler({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_source_excerpt", arguments: { sourceEditionId: "edition_001", startByte: 0, endByte: 6 } } });
    expect((excerpt?.result as { structuredContent: { text: string } }).structuredContent).toMatchObject({ text: "中文" });
    const prepared = await handler({
      jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "update_analysis_segmentation", arguments: {
        commandId: "command_corpus_001", idempotencyKey: "idem_corpus_001", correlationId: "correlation_corpus_001",
        analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete",
        budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 },
      } },
    });
    expect((prepared?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const overview = await handler({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_analysis_overview", arguments: { analysisProjectId: "analysis_001" } } });
    expect((overview?.result as { structuredContent: { spanCount: number } }).structuredContent).toMatchObject({ spanCount: 1 });
    const unitId = ((overview?.result as { structuredContent: { computeUnits: Array<{ analysisUnitId: string }> } }).structuredContent).computeUnits[0]!.analysisUnitId;
    const mapCreated = await handler({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "create_structural_reading_map", arguments: { commandId: "command_map_001", idempotencyKey: "idem_map_001", correlationId: "correlation_map_001", analysisProjectId: "analysis_001" } } });
    expect((mapCreated?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const map = await handler({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_structural_reading_map", arguments: { analysisProjectId: "analysis_001" } } });
    expect((map?.result as { structuredContent: { kind: string; totalSpans: number } }).structuredContent).toMatchObject({ kind: "structural_reading_map", totalSpans: 1 });
    const started = await handler({
      jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "start_local_fact_extraction", arguments: {
        commandId: "command_facts_001", idempotencyKey: "idem_facts_001", correlationId: "correlation_facts_001", taskId: "fact_task_001", analysisProjectId: "analysis_001", analysisUnitId: unitId,
        baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048,
      } },
    });
    expect((started?.result as { structuredContent: { kind: string; taskId: string } }).structuredContent).toEqual({ kind: "accepted", taskId: "fact_task_001" });
    await tasks.wait("fact_task_001", 1_000);
    const ledger = await handler({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "get_fact_ledger", arguments: { analysisProjectId: "analysis_001", analysisUnitId: unitId } } });
    expect((ledger?.result as { structuredContent: Array<{ id: string; evidenceSpanIds: string[] }> }).structuredContent).toEqual([
      expect.objectContaining({ id: "fact_001", evidenceSpanIds: ["sp00001"] }),
    ]);
    const threadSubmitted = await handler({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "submit_thread_graph", arguments: {
      commandId: "command_thread_001", idempotencyKey: "idem_thread_001", correlationId: "correlation_thread_001", analysisProjectId: "analysis_001",
      rawOutput: JSON.stringify({ threads: [{ id: "thread_001", kind: "event", title: "原文事件", episodes: [{ id: "episode_001", role: "setup", rawLabel: null, summary: "原文事件出现", evidenceSpanIds: ["sp00001"], ordinal: 1 }], epistemicStatus: "observed", lifecycle: "open" }] }),
    } } });
    expect((threadSubmitted?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const threadGraph = await handler({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "get_thread_graph", arguments: { analysisProjectId: "analysis_001" } } });
    expect((threadGraph?.result as { structuredContent: Array<{ id: string }> }).structuredContent).toEqual([expect.objectContaining({ id: "thread_001" })]);
    const briefOutput = JSON.stringify({ questions: [{ id: "question_001", question: "事件如何改变期待？", rationale: "检查事件线", productionUse: "指导信息释放", requiredEvidence: ["事件证据"], estimatedCostTokens: 256, abstentionReason: "证据不足时弃权" }] });
    const briefSubmitted = await handler({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "submit_analysis_brief", arguments: { commandId: "command_brief_001", idempotencyKey: "idem_brief_001", correlationId: "correlation_brief_001", analysisProjectId: "analysis_001", rawOutput: briefOutput } } });
    expect((briefSubmitted?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const pendingBrief = await handler({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "get_analysis_brief", arguments: { analysisProjectId: "analysis_001" } } });
    expect((pendingBrief?.result as { structuredContent: { status: string } }).structuredContent).toMatchObject({ status: "pending_review" });
    const briefApproved = await handler({ jsonrpc: "2.0", id: 15, method: "tools/call", params: { name: "approve_analysis_brief", arguments: { commandId: "command_brief_approve_001", idempotencyKey: "idem_brief_approve_001", correlationId: "correlation_brief_001", analysisProjectId: "analysis_001" } } });
    expect((briefApproved?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const conclusionOutput = JSON.stringify({ conclusions: [{ id: "conclusion_001", researchQuestionId: "question_001", conclusion: "异常先出现能建立期待。", observations: [{ id: "observation_001", statement: "异常班次先于解释出现。", evidenceSpanIds: ["sp00001"] }], evidenceSpanIds: ["sp00001"], counterEvidenceSpanIds: [], alternativeExplanations: ["局部场景调度"], applicabilityBoundaries: ["信息控制释放"], productionImplications: ["先给异常再延后解释。"], coverageStatus: "complete", epistemicStatus: "inferred" }] });
    const conclusionSubmitted = await handler({ jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "submit_research_conclusions", arguments: { commandId: "command_conclusion_001", idempotencyKey: "idem_conclusion_001", correlationId: "correlation_conclusion_001", analysisProjectId: "analysis_001", researchQuestionId: "question_001", rawOutput: conclusionOutput } } });
    expect((conclusionSubmitted?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const conclusionRead = await handler({ jsonrpc: "2.0", id: 17, method: "tools/call", params: { name: "get_research_conclusions", arguments: { analysisProjectId: "analysis_001", researchQuestionId: "question_001" } } });
    expect((conclusionRead?.result as { structuredContent: Array<{ id: string }> }).structuredContent).toEqual([expect.objectContaining({ id: "conclusion_001" })]);
    const workItem = await handler({ jsonrpc: "2.0", id: 18, method: "tools/call", params: { name: "get_falsification_work_item", arguments: { analysisProjectId: "analysis_001", conclusionId: "conclusion_001" } } });
    expect((workItem?.result as { structuredContent: { proposition: string } }).structuredContent).toMatchObject({ proposition: "异常先出现能建立期待。" });
    const falsificationOutput = JSON.stringify({ assessment: { conclusionId: "conclusion_001", status: "bounded", counterEvidenceSpanIds: ["sp00001"], alternativeExplanations: ["局部场景调度"], applicabilityLimits: ["单一计算单元"], sampleBiasNotes: ["样本有限"] } });
    const falsificationSubmitted = await handler({ jsonrpc: "2.0", id: 19, method: "tools/call", params: { name: "submit_independent_falsification", arguments: { commandId: "command_falsification_001", idempotencyKey: "idem_falsification_001", correlationId: "correlation_falsification_001", analysisProjectId: "analysis_001", conclusionId: "conclusion_001", rawOutput: falsificationOutput } } });
    expect((falsificationSubmitted?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
    const falsificationRead = await handler({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "get_independent_falsification", arguments: { analysisProjectId: "analysis_001", conclusionId: "conclusion_001" } } });
    expect((falsificationRead?.result as { structuredContent: { status: string } }).structuredContent).toMatchObject({ status: "bounded" });
    const dossierCreated = await handler({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "create_research_dossier", arguments: { commandId: "command_dossier_001", idempotencyKey: "idem_dossier_001", correlationId: "correlation_dossier_001", analysisProjectId: "analysis_001" } } });
    expect((dossierCreated?.result as { structuredContent: { kind: string; revision: number } }).structuredContent).toMatchObject({ kind: "ok", revision: 1 });
    const dossierRead = await handler({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "get_research_dossier", arguments: { analysisProjectId: "analysis_001" } } });
    expect((dossierRead?.result as { structuredContent: { factCount: number; threadCount: number } }).structuredContent).toMatchObject({ factCount: 1, threadCount: 1 });
    const evidence = await handler({ jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "get_analysis_evidence", arguments: { analysisProjectId: "analysis_001", conclusionId: "conclusion_001" } } });
    expect((evidence?.result as { structuredContent: Array<{ role: string; conclusionId: string }> }).structuredContent).toEqual(expect.arrayContaining([expect.objectContaining({ role: "supporting", conclusionId: "conclusion_001" }), expect.objectContaining({ role: "counter", conclusionId: "conclusion_001" })]));
    const coverage = await handler({ jsonrpc: "2.0", id: 24, method: "tools/call", params: { name: "list_analysis_coverage", arguments: { analysisProjectId: "analysis_001", module: "research_question" } } });
    expect((coverage?.result as { structuredContent: Array<{ status: string }> }).structuredContent).toEqual([expect.objectContaining({ status: "complete" })]);
  });
});

function taskRecord(taskId: string, status: TaskRecord["status"]): TaskRecord {
  return {
    taskId,
    resourceKey: `local_fact_extraction_batch:${taskId}`,
    taskType: "local_fact_extraction_batch",
    status,
    leaseOwner: null,
    leaseExpiresAt: null,
    retryCount: 0,
    checkpoints: [],
    eventCursor: 0,
  };
}

function confirmationPlanner(): CommandPlanner {
  return {
    plan(command, context) {
      if (!context.confirmed) return { kind: "needs_confirmation", risk: "overwrite", expiresAt: command.createdAt + 60_000 };
      return { kind: "plan", steps: [{ sql: "INSERT INTO workspace_meta (key, value_json, updated_at) VALUES (?, ?, ?)", params: ["confirmed", '{"schema_version":1,"value":"approved"}', command.createdAt] }], result: { kind: "ok", resourceRefs: [] }, changes: [] };
    },
  };
}
