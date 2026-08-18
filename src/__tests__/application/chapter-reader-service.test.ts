import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterReaderContextManifest } from "@/application/chapter-reader-manifest-service";
import { createChapterReaderService, validateChapterReaderOutput } from "@/application/chapter-reader-service";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createLocalCreationService } from "@/application/local-creation-service";
import { createTaskRunner } from "@/application/task-runner";
import type { CommandEnvelope } from "@/application/command-types";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterReader 本机任务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-chapter-reader-task-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("以独立冻结 Reader Manifest 调用本机模型，并将已验证的反馈保存为可查询任务产物", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const caller = { complete: vi.fn().mockResolvedValue({ text: feedbackJson(), finishReason: "stop" }) };
    const local = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }), objects: await createNodeObjectStore({ workspacePath }), caller, hostId: "reader-host", validateOutput: validateChapterReaderOutput, now: () => 1_700_000_000_000,
    });
    const readers = createChapterReaderService({ local, manifests: { get: async () => manifest() } });

    await expect(readers.start({ command: command("start"), taskId: "reader_task_001", documentId: "production:reader_feedback:reader_immersive_001", reportId: "reader_immersive_001", projectId: "project_001", chapterId: "chapter_001", manifestId: "reader_manifest_immersive", title: "沉浸型 Reader", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 1024 }))
      .resolves.toMatchObject({ kind: "accepted", taskId: "reader_task_001" });
    await readers.run("reader_task_001");
    await expect(readers.getReport({ documentId: "production:reader_feedback:reader_immersive_001" })).resolves.toMatchObject({ reportId: "reader_immersive_001", readerKind: "immersive", issues: [{ quote: "潮水", startByte: 27, endByte: 33 }] });
    expect(caller.complete).toHaveBeenCalledWith(expect.objectContaining({ model: "qwen3:8b", prompt: expect.stringContaining("<AINOVR_READER_MANIFEST>") }), expect.any(AbortSignal));
    expect(caller.complete.mock.calls[0]?.[0]?.prompt).not.toContain("未来计划");
  });

  it("Reader 模型输出若身份、JSON 或 UTF-8 区间无效，任务失败且不生成反馈草稿", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_invalid"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const local = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }), objects: await createNodeObjectStore({ workspacePath }), caller: { complete: vi.fn().mockResolvedValue({ text: feedbackJson().replace('"quote":"潮水"', '"quote":"不存在"'), finishReason: "stop" }) }, hostId: "reader-host", validateOutput: validateChapterReaderOutput, now: () => 1_700_000_000_000,
    });
    const readers = createChapterReaderService({ local, manifests: { get: async () => manifest() } });
    await readers.start({ command: command("invalid_start"), taskId: "reader_task_invalid", documentId: "production:reader_feedback:reader_invalid", reportId: "reader_immersive_001", projectId: "project_001", chapterId: "chapter_001", manifestId: "reader_manifest_immersive", title: "沉浸型 Reader", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 1024 });

    await expect(readers.run("reader_task_invalid")).rejects.toThrow(/UTF-8|区间/);
    await expect(readers.getTask("reader_task_invalid")).resolves.toMatchObject({ status: "failed" });
    await expect(readers.getReport({ documentId: "production:reader_feedback:reader_invalid" })).resolves.toBeNull();
  });

  it("只有在 quote 唯一时才会确定性修正模型给出的错误 UTF-8 字节范围", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_recover_range"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const local = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }), objects: await createNodeObjectStore({ workspacePath }), caller: { complete: vi.fn().mockResolvedValue({ text: feedbackJson().replace('"startByte":27', '"startByte":28'), finishReason: "stop" }) }, hostId: "reader-host", validateOutput: validateChapterReaderOutput, now: () => 1_700_000_000_000,
    });
    const readers = createChapterReaderService({ local, manifests: { get: async () => manifest() } });
    await readers.start({ command: command("recover_start"), taskId: "reader_task_recover", documentId: "production:reader_feedback:reader_recover", reportId: "reader_immersive_001", projectId: "project_001", chapterId: "chapter_001", manifestId: "reader_manifest_immersive", title: "沉浸型 Reader", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 1024 });

    await readers.run("reader_task_recover");
    await expect(readers.getReport({ documentId: "production:reader_feedback:reader_recover" })).resolves.toMatchObject({ issues: [{ startByte: 27, endByte: 33, quote: "潮水" }] });
  });

  it("MCP 仅在配置 Reader 任务服务后暴露启动、恢复与读取反馈入口", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const local = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver), objects: await createNodeObjectStore({ workspacePath }), caller: { complete: vi.fn() }, hostId: "reader-host", validateOutput: validateChapterReaderOutput,
    });
    const readers = createChapterReaderService({ local, manifests: { get: async () => manifest() } });
    const handler = createApplicationMcpJsonRpcHandler({ application, readers });
    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["start_chapter_reader", "resume_chapter_reader", "get_chapter_reader_feedback"]));
  });
});

function manifest(): ChapterReaderContextManifest {
  return {
    schema_version: 1, kind: "chapter_reader_context_manifest", manifestId: "reader_manifest_immersive", projectId: "project_001", chapterId: "chapter_001", readerKind: "immersive", conversationHistory: [], tokenBudget: 4096, tokenEstimate: 64,
    draft: { documentId: "production:chapter_draft:chapter_001:v1", title: "第一章 V1", text: "林霁推开钟楼的门，潮水在门外停住。", revision: "v1" },
    layers: [
      { name: "generated_chapter_text", required: true, documentIds: ["production:chapter_draft:chapter_001:v1"], value: { text: "林霁推开钟楼的门，潮水在门外停住。" } },
      { name: "reader_state_and_promises", required: false, documentIds: [], value: { readerStates: [], readerPromises: [] } },
      { name: "necessary_past_context", required: false, documentIds: [], value: { acceptedChapter: null } },
    ],
  };
}

function feedbackJson(): string {
  return JSON.stringify({ schema_version: 1, kind: "chapter_reader_feedback", reportId: "reader_immersive_001", projectId: "project_001", chapterId: "chapter_001", manifestId: "reader_manifest_immersive", draftDocumentId: "production:chapter_draft:chapter_001:v1", draftRevision: "v1", readerKind: "immersive", issues: [{ id: "reader_issue_001", severity: "minor", message: "潮水为何停住仍有疑问。", startByte: 27, endByte: 33, quote: "潮水" }] });
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "internal_agent", id: "reader" }, createdAt: 1_700_000_000_000 };
}
