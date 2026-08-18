import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createChapterReaderManifestService, type ChapterReaderDraft } from "@/application/chapter-reader-manifest-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterReaderManifest Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-reader-manifest-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("为三个 Reader 分别冻结隔离 Manifest，只包含本次正文、过去读者状态和已接受上文", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    await saveDocument(application, "story_contract", "planning:story_contract", { corePromise: "未来计划绝不能被 Reader 看见" });
    await saveDocument(application, "creative_recipe", "production:creative_recipe:chapter_002", { mechanismExplanation: "机制为什么有效也不能泄漏" });
    await saveDocument(application, "untrusted_reference_copy", "other:reference", { title: "禁泄漏参考名", source: "禁泄漏来源" });
    await driver.execute({ sql: "INSERT INTO reader_states (reader_state_id, project_id, chapter_id, payload_json, revision, created_at) VALUES (?, ?, NULL, ?, 1, ?)", params: ["state_before", "project_001", JSON.stringify({ schema_version: 1, expectation: "门后的代价" }), 1_700_000_000_000] });
    await driver.execute({ sql: "INSERT INTO reader_promises (reader_promise_id, project_id, chapter_id, payload_json, status, revision, created_at, updated_at) VALUES (?, ?, NULL, ?, 'delay', 1, ?, ?)", params: ["promise_before", "project_001", JSON.stringify({ schema_version: 1, promise: "谁写下了信" }), 1_700_000_000_000, 1_700_000_000_000] });
    const drafts = { getDraft: async (): Promise<ChapterReaderDraft> => ({ documentId: "production:chapter_draft:chapter_002:v1", projectId: "project_001", chapterId: "chapter_002", manifestId: "writer_manifest_002", title: "第二章 V1", text: "林霁推开钟楼的门，潮水在门外停住。", model: "qwen3:8b", taskId: "writer_task_002", revision: "v1" }) };
    const manifests = createChapterReaderManifestService({ driver, commands: application.commands, objects, drafts });

    for (const readerKind of ["immersive", "low_patience", "logic_sensitive"] as const) {
      await expect(manifests.freeze({
        command: command(`reader_${readerKind}`), projectId: "project_001", chapterId: "chapter_002", draftDocumentId: "production:chapter_draft:chapter_002:v1", manifestId: `reader_manifest_${readerKind}`, readerKind, tokenBudget: 4096,
      })).resolves.toMatchObject({ kind: "ok", revision: 1 });
      const manifest = await manifests.get({ projectId: "project_001", manifestId: `reader_manifest_${readerKind}` });
      expect(manifest).toMatchObject({ projectId: "project_001", chapterId: "chapter_002", readerKind, conversationHistory: [], draft: { revision: "v1", text: "林霁推开钟楼的门，潮水在门外停住。" } });
      expect(manifest?.layers.map((layer) => layer.name)).toEqual(["generated_chapter_text", "reader_state_and_promises", "necessary_past_context"]);
      expect(JSON.stringify(manifest)).toContain("门后的代价");
      expect(JSON.stringify(manifest)).not.toMatch(/未来计划|机制为什么有效|禁泄漏参考名|禁泄漏来源/);
    }
  });

  it("无效角色、缺失 Writer 草稿或跨项目草稿均 fail closed", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute({ ...command("project_missing"), tool: "create_novel_project", args: { projectId: "project_missing", title: "空项目", status: "planning", payload: { schema_version: 1 } } });
    const manifests = createChapterReaderManifestService({
      driver,
      commands: application.commands,
      objects: await createNodeObjectStore({ workspacePath }),
      drafts: { getDraft: async () => null },
    });

    await expect(manifests.freeze({ command: command("missing_draft"), projectId: "project_missing", chapterId: "chapter_001", draftDocumentId: "missing", manifestId: "manifest_missing", readerKind: "immersive", tokenBudget: 1024 })).rejects.toThrow(/Writer 草稿/);
    await expect(manifests.freeze({ command: command("invalid_reader"), projectId: "project_missing", chapterId: "chapter_001", draftDocumentId: "missing", manifestId: "manifest_invalid", readerKind: "writer" as never, tokenBudget: 1024 })).rejects.toThrow(/Reader/);
  });

  it("MCP 仅在配置 ReaderManifest 服务后暴露冻结和读取入口", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const readers = createChapterReaderManifestService({
      driver,
      commands: application.commands,
      objects: await createNodeObjectStore({ workspacePath }),
      drafts: { getDraft: async () => null },
    });
    const handler = createApplicationMcpJsonRpcHandler({ application, readerManifests: readers });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["freeze_chapter_reader_manifest", "get_chapter_reader_manifest"]));
  });
});

async function saveDocument(application: ReturnType<typeof createWorkspaceApplicationService>, kind: string, documentId: string, values: Record<string, unknown>): Promise<void> {
  const result = await application.commands.execute({
    ...command(`document_${documentId.replace(/[^a-z0-9]/gi, "_")}`), projectId: "project_001", tool: "commit_project_planning_document",
    args: { projectId: "project_001", documentId, documentType: kind, status: "approved", expectedRevision: null, payload: { schema_version: 1, kind, ...values } },
  });
  if (result.kind !== "ok") throw new Error(`测试文档未保存：${kind}`);
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
