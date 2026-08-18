import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChapterReview } from "@/application/chapter-review-service";
import { createChapterEditorService } from "@/application/chapter-editor-service";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import type { CommandEnvelope } from "@/application/command-types";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterEditor Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-chapter-editor-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("只按选定 Review 问题范围生成 V2/V3，保留父版本、差异、理由和 Review 绑定", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const editor = createChapterEditorService({
      driver,
      commands: application.commands,
      objects,
      baseDrafts: { getDraft: async () => v1() },
      reviews: { get: async ({ reviewId }) => reviewId === "review_v1" ? review("review_v1", v1().documentId, "v1", "潮水") : reviewId === "review_v2" ? review("review_v2", "production:chapter_draft:chapter_001:v2", "v2", "门外") : null },
    });

    await expect(editor.create({
      command: command("v2"), executionRef: "editor_task_v2", projectId: "project_001", chapterId: "chapter_001", documentId: "production:chapter_draft:chapter_001:v2", title: "第一章 V2", sourceDraftDocumentId: v1().documentId, reviewId: "review_v1", selectedIssueIds: ["issue_review_v1"], editedText: "林霁推开钟楼的门，翻涌的潮水在门外停住。", rationale: "补足潮水异常的局部因果动作。",
    })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(editor.getDraft("production:chapter_draft:chapter_001:v2")).resolves.toMatchObject({ executionRef: "editor_task_v2", revision: "v2", parentDocumentId: v1().documentId, reviewId: "review_v1", selectedIssueIds: ["issue_review_v1"], text: "林霁推开钟楼的门，翻涌的潮水在门外停住。" });

    await expect(editor.create({
      command: command("v3"), executionRef: "editor_task_v3", projectId: "project_001", chapterId: "chapter_001", documentId: "production:chapter_draft:chapter_001:v3", title: "第一章 V3", sourceDraftDocumentId: "production:chapter_draft:chapter_001:v2", reviewId: "review_v2", selectedIssueIds: ["issue_review_v2"], editedText: "林霁推开钟楼的门，翻涌的潮水在塔门外停住。", rationale: "澄清停驻位置。",
    })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(editor.getDraft("production:chapter_draft:chapter_001:v3")).resolves.toMatchObject({ revision: "v3", parentDocumentId: "production:chapter_draft:chapter_001:v2", reviewId: "review_v2" });
    await expect(driver.query<{ document_id: string; status: string }>({ sql: "SELECT document_id, status FROM project_documents WHERE document_type = 'chapter_editor_draft' ORDER BY document_id", params: [] }))
      .resolves.toEqual([
        { document_id: "production:chapter_draft:chapter_001:v2", status: "draft" },
        { document_id: "production:chapter_draft:chapter_001:v3", status: "draft" },
      ]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM production_commits", params: [] })).resolves.toEqual([{ count: 0 }]);
  });

  it("拒绝整章重写、未选问题和跨 revision 编辑，第三版不能由 Editor 自动接受", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute({ ...command("project_invalid"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const editor = createChapterEditorService({
      driver,
      commands: application.commands,
      objects: await createNodeObjectStore({ workspacePath }),
      baseDrafts: { getDraft: async () => v1() },
      reviews: { get: async () => review("review_v1", v1().documentId, "v1", "潮水") },
    });
    const input = { executionRef: "editor_task_invalid", projectId: "project_001", chapterId: "chapter_001", documentId: "production:chapter_draft:chapter_001:v2", title: "第一章 V2", sourceDraftDocumentId: v1().documentId, reviewId: "review_v1", selectedIssueIds: ["issue_review_v1"], rationale: "修正局部问题。" };

    await expect(editor.create({ command: command("rewrite"), ...input, editedText: "全新的另一章，人物和场景全部替换。" })).rejects.toThrow(/整章|范围/);
    await expect(editor.create({ command: command("outside_range"), ...input, editedText: "林霁推开钟楼的窗，潮水在门外停住。" })).rejects.toThrow(/changed=\[/);
    await expect(editor.create({ command: command("wrong_scope"), ...input, selectedIssueIds: [], editedText: "林霁推开钟楼的门，潮水在塔门外停住。" })).rejects.toThrow(/选定|问题/);
    await expect(editor.create({ command: command("wrong_doc"), ...input, documentId: "production:chapter_draft:chapter_001:v3", editedText: "林霁推开钟楼的门，翻涌的潮水在门外停住。" })).rejects.toThrow(/V2|版本/);
  });

  it("MCP 仅在配置 Editor 服务后暴露受 Reviewer 约束的 V2/V3 草稿入口", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const editor = createChapterEditorService({
      driver,
      commands: application.commands,
      objects: await createNodeObjectStore({ workspacePath }),
      baseDrafts: { getDraft: async () => v1() },
      reviews: { get: async ({ reviewId }) => review(reviewId, v1().documentId, "v1", "潮水") },
    });
    const handler = createApplicationMcpJsonRpcHandler({ application, editor });
    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["create_chapter_editor_draft", "get_chapter_editor_draft"]));
  });
});

function v1() {
  return { documentId: "production:chapter_draft:chapter_001:v1", projectId: "project_001", chapterId: "chapter_001", manifestId: "writer_manifest_001", title: "第一章 V1", text: "林霁推开钟楼的门，潮水在门外停住。", model: "qwen3:8b", executionRef: "writer_task_001", revision: "v1" as const };
}

function review(reviewId: string, documentId: string, draftRevision: "v1" | "v2", quote: string): ChapterReview {
  const text = draftRevision === "v1" ? v1().text : "林霁推开钟楼的门，翻涌的潮水在门外停住。";
  const startByte = new TextEncoder().encode(text.slice(0, text.indexOf(quote))).length;
  const endByte = startByte + new TextEncoder().encode(quote).length;
  return { schema_version: 1, kind: "chapter_review", reviewId, projectId: "project_001", chapterId: "chapter_001", draftDocumentId: documentId, draftRevision, readerManifestIds: ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"], issues: [{ id: `issue_${reviewId}`, category: "continuity", severity: "major", message: "局部因果不足", startByte, endByte, quote }] };
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "internal_agent", id: "editor" }, createdAt: 1_700_000_000_000 };
}
