import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createChapterProductionCommitService, type AcceptChapterDraftInput } from "@/application/chapter-production-commit-service";
import { executeWorkspaceCli } from "@/cli/workspace-cli";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterProductionCommit Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-production-commit-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });
  afterEach(async () => { await driver?.close(); await rm(workspacePath, { recursive: true, force: true }); });

  it("在一个命令事务中提交正文、ChapterDelta、Canon、人物知识、ReaderState、Promise 与 OutlineDrift", async () => {
    const { application, objects, drafts } = await setup(driver, workspacePath);
    const commits = createChapterProductionCommitService({ driver, commands: application.commands, objects, drafts });

    await expect(commits.acceptDraft(commitInput("commit_001"))).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(commits.getAcceptedChapter({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toMatchObject({
      revision: 1, text: "林霁推开钟楼的门，潮水在门外停住。", manifestId: "manifest_001", draftDocumentId: "production:chapter_draft:chapter_001:v1", chapterDelta: { schema_version: 1, changedState: ["林霁决定入塔"] },
    });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM production_commits", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM canon_entries", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM character_knowledge", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM reader_states", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM reader_promises", params: [] })).resolves.toEqual([{ count: 1 }]);
  });

  it("只能由人类选择已存在的 V1/V2/V3 草稿接受正文，不能把任意 acceptedText 写入正式章节", async () => {
    const { application, objects, drafts } = await setup(driver, workspacePath);
    const commits = createChapterProductionCommitService({ driver, commands: application.commands, objects, drafts });
    const input = commitInput("commit_selected_v2", "selected_v2");

    await expect(commits.acceptDraft({
      ...input,
      draftDocumentId: "production:chapter_draft:chapter_001:v2",
    })).resolves.toMatchObject({ kind: "ok", revision: 1 });

    await expect(commits.getAcceptedChapter({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toMatchObject({
      text: "林霁推开钟楼的门，翻涌的潮水在门外停住。",
      manifestId: "manifest_001",
      draftDocumentId: "production:chapter_draft:chapter_001:v2",
      draftRevision: "v2",
      draftModel: "qwen3.5:9b",
      reviewLineage: ["review_v1"],
    });
  });

  it("同一 ReaderState 与 ReaderPromise 在后续正式提交中推进 revision，而不是产生主键冲突", async () => {
    const { application, objects, drafts } = await setup(driver, workspacePath);
    const commits = createChapterProductionCommitService({ driver, commands: application.commands, objects, drafts });
    await commits.acceptDraft(commitInput("commit_reader_v1", "reader"));
    const next = commitInput("commit_reader_v2", "reader");
    next.command = { ...next.command, commandId: "command_production_reader_v2", idempotencyKey: "idem_production_reader_v2" };
    next.canonPatches = [{ canonEntryId: "canon_reader", expectedRevision: 1, payload: { schema_version: 1, fact: "钟楼每夜倒走七分钟" } }];
    next.characterKnowledgePatches = [{ knowledgeId: "knowledge_reader", characterId: "linji", expectedRevision: 1, payload: { schema_version: 1, knows: ["信来自未来"] } }];
    next.readerPromiseUpdates = [{ readerPromiseId: "promise_reader", status: "payoff", payload: { schema_version: 1, promise: "钟楼入口已经打开" } }];

    await expect(commits.acceptDraft(next)).resolves.toMatchObject({ kind: "ok", revision: 2 });
    await expect(driver.query<{ revision: number; status: string }>({ sql: "SELECT revision, status FROM reader_promises WHERE reader_promise_id = ?", params: ["promise_reader"] }))
      .resolves.toEqual([{ revision: 2, status: "payoff" }]);
    await expect(driver.query<{ revision: number }>({ sql: "SELECT revision FROM reader_states WHERE reader_state_id = ?", params: ["reader_state_reader"] }))
      .resolves.toEqual([{ revision: 2 }]);
  });

  it("事务末尾的 ProductionCommit 冲突会回滚正文和所有关联状态，不留下半提交", async () => {
    const { application, objects, drafts } = await setup(driver, workspacePath);
    const commits = createChapterProductionCommitService({ driver, commands: application.commands, objects, drafts });
    await commits.acceptDraft(commitInput("commit_001"));

    await expect(commits.acceptDraft(commitInput("commit_001", "second"))).resolves.toMatchObject({ kind: "error", code: "command_transaction_failed" });
    await expect(commits.getAcceptedChapter({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toMatchObject({ revision: 1, text: "林霁推开钟楼的门，潮水在门外停住。" });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM production_commits", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM canon_entries", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM reader_states", params: [] })).resolves.toEqual([{ count: 1 }]);
  });

  it("MCP 仅在配置 ProductionCommit 服务时暴露人工确认后的章节提交入口", async () => {
    const { application, objects, drafts } = await setup(driver, workspacePath);
    const production = createChapterProductionCommitService({ driver, commands: application.commands, objects, drafts });
    const handler = createApplicationMcpJsonRpcHandler({ application, production });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (listed?.result as { tools: Array<{ name: string; inputSchema: { required?: string[]; properties?: Record<string, unknown> } }> }).tools;
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["commit_chapter", "get_accepted_chapter"]));
    const commit = tools.find((tool) => tool.name === "commit_chapter")!;
    expect(commit.inputSchema.required).toContain("draftDocumentId");
    expect(commit.inputSchema.required).not.toContain("acceptedText");
    expect(commit.inputSchema.properties).not.toHaveProperty("acceptedText");
  });

  it("MCP 选择草稿时先创建持久确认，批准前不能接受章节", async () => {
    const { application, objects, drafts } = await setup(driver, workspacePath);
    const production = createChapterProductionCommitService({ driver, commands: application.commands, objects, drafts });
    const handler = createApplicationMcpJsonRpcHandler({ application, production });
    const input = commitInput("commit_mcp_selection", "mcp_selection");

    const response = await handler({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "commit_chapter", arguments: {
        commandId: input.command.commandId, idempotencyKey: input.command.idempotencyKey, correlationId: input.command.correlationId,
        projectId: input.projectId, chapterId: input.chapterId, chapterOrdinal: input.chapterOrdinal, productionCommitId: input.productionCommitId, draftDocumentId: input.draftDocumentId,
        chapterDelta: input.chapterDelta, canonPatches: input.canonPatches, characterKnowledgePatches: input.characterKnowledgePatches, readerState: input.readerState, readerPromiseUpdates: input.readerPromiseUpdates, outlineDrift: input.outlineDrift,
      } },
    });

    expect((response?.result as { structuredContent: { kind: string; risk: string } }).structuredContent).toMatchObject({ kind: "needs_confirmation", risk: "chapter_production_commit" });
    await expect(production.getAcceptedChapter({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toBeNull();
  });

  it("CLI 复用同一个 ProductionCommit Application Service，不直接写数据库", async () => {
    const { application, objects, drafts } = await setup(driver, workspacePath);
    const production = createChapterProductionCommitService({ driver, commands: application.commands, objects, drafts });
    const input = commitInput("commit_cli", "cli");

    await expect(executeWorkspaceCli(application, "commit-chapter", {
      commandId: input.command.commandId, idempotencyKey: input.command.idempotencyKey, correlationId: input.command.correlationId,
      projectId: input.projectId, chapterId: input.chapterId, chapterOrdinal: input.chapterOrdinal, draftDocumentId: input.draftDocumentId, productionCommitId: input.productionCommitId, chapterDelta: input.chapterDelta, canonPatches: input.canonPatches, characterKnowledgePatches: input.characterKnowledgePatches, readerState: input.readerState, readerPromiseUpdates: input.readerPromiseUpdates, outlineDrift: input.outlineDrift,
    }, { production })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(executeWorkspaceCli(application, "get-accepted-chapter", { projectId: "project_001", chapterId: "chapter_001" }, { production }))
      .resolves.toMatchObject({ text: "林霁推开钟楼的门，潮水在门外停住。" });
  });
});

async function setup(driver: SqlDriver, workspacePath: string) {
  const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
  const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
  const objects = await createNodeObjectStore({ workspacePath });
  await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
  await application.commands.execute({ ...command("chapter_contract"), projectId: "project_001", tool: "commit_project_planning_document", args: { projectId: "project_001", documentId: "planning:project_001:chapter_contract:chapter_001", documentType: "chapter_contract", status: "approved", expectedRevision: null, payload: { schema_version: 1, kind: "chapter_contract", chapterId: "chapter_001", ordinal: 1, entryState: ["入口"], exitState: ["出口"], desire: "目标", pressure: "压力", turningPoint: "转折", mustNotHappen: [], readerPromiseAction: "establish", emotionalCycle: "变化", nextChapterInterface: ["下一章"], mechanismCardIds: [] } } });
  const manifest = await objects.put({ content: new TextEncoder().encode(JSON.stringify({ schema_version: 1, kind: "chapter_context_manifest", manifestId: "manifest_001", projectId: "project_001", chapterId: "chapter_001", taskRole: "writer", conversationHistory: [], layers: [] })), mediaType: "application/vnd.ainovr.chapter-context-manifest+json" });
  await application.commands.execute({
    ...command("manifest"), projectId: "project_001", tool: "commit_project_planning_document",
    args: { projectId: "project_001", documentId: "production:context_manifest:manifest_001", documentType: "context_manifest", status: "frozen", expectedRevision: null, payload: { schema_version: 1, kind: "context_manifest", manifestId: "manifest_001", chapterId: "chapter_001", taskRole: "writer", contextObjectHash: manifest.sha256 }, rawOutput: manifest },
  });
  const drafts = {
    getDraft: async (documentId: string) => documentId === "production:chapter_draft:chapter_001:v2" ? v2() : documentId === "production:chapter_draft:chapter_001:v1" ? v1() : null,
  };
  return { application, objects, drafts };
}

function commitInput(productionCommitId: string, suffix = "first"): AcceptChapterDraftInput {
  return {
    command: { ...command(`production_${suffix}`), actor: { kind: "human", id: "user_001" } },
    projectId: "project_001", chapterId: "chapter_001", chapterOrdinal: 1, productionCommitId, draftDocumentId: "production:chapter_draft:chapter_001:v1",
    chapterDelta: { schema_version: 1, changedState: ["林霁决定入塔"] },
    canonPatches: [{ canonEntryId: `canon_${suffix}`, expectedRevision: null, payload: { schema_version: 1, fact: "钟楼每夜倒走七分钟" } }],
    characterKnowledgePatches: [{ knowledgeId: `knowledge_${suffix}`, characterId: "linji", expectedRevision: null, payload: { schema_version: 1, knows: ["信来自未来"] } }],
    readerState: { readerStateId: `reader_state_${suffix}`, payload: { schema_version: 1, expectations: ["门后的代价"] } },
    readerPromiseUpdates: [{ readerPromiseId: `promise_${suffix}`, status: "establish", payload: { schema_version: 1, promise: "钟楼入口会在下一章打开" } }],
    outlineDrift: { payload: { schema_version: 1, status: "none", notes: [] } },
  };
}

function v1() {
  return { documentId: "production:chapter_draft:chapter_001:v1", projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", title: "第一章 V1", text: "林霁推开钟楼的门，潮水在门外停住。", model: "qwen3.5:9b", taskId: "writer_task_001", revision: "v1" as const };
}

function v2() {
  return { ...v1(), documentId: "production:chapter_draft:chapter_001:v2", title: "第一章 V2", text: "林霁推开钟楼的门，翻涌的潮水在门外停住。", taskId: "", revision: "v2" as const, parentDocumentId: v1().documentId, parentRevision: "v1" as const, reviewId: "review_v1" };
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
