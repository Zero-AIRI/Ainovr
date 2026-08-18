import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChapterEditorService } from "@/application/chapter-editor-service";
import { createChapterEditorTaskService, parseChapterEditorPatchOutput, validateChapterEditorPatchOutput, type ChapterEditorTaskService } from "@/application/chapter-editor-task-service";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import type { ChapterReaderDraft } from "@/application/chapter-reader-manifest-service";
import type { ChapterReview } from "@/application/chapter-review-service";
import { createLocalCreationService } from "@/application/local-creation-service";
import { createTaskRunner } from "@/application/task-runner";
import type { CommandEnvelope } from "@/application/command-types";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterEditor 本机定向修订任务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-editor-task-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("冻结源正文与选定 Review 问题，本机补丁经范围校验后提交 V2 而非直接接受章节", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const drafts = { getDraft: async (): Promise<ChapterReaderDraft | null> => v1() };
    const reviews = { get: async (): Promise<ChapterReview | null> => review() };
    const editor = createChapterEditorService({ driver, commands: application.commands, objects, baseDrafts: drafts, reviews });
    const caller = { complete: vi.fn().mockResolvedValue({ text: patchJson(), finishReason: "stop" }) };
    const local = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver), objects,
      caller, hostId: "editor-host",
      validateOutput: validateChapterEditorPatchOutput,
      commitOutput: async ({ taskId, projectId, prompt, text, metadata, output }) => {
        const patch = parseChapterEditorPatchOutput({ taskId, projectId, prompt, metadata }, text);
        const result = await editor.create({
          command: { ...command(`commit_${taskId}`), actor: { kind: "internal_agent", id: "editor-host" } }, executionRef: taskId, projectId,
          chapterId: patch.chapterId, documentId: patch.targetDocumentId, title: patch.title, sourceDraftDocumentId: patch.sourceDraftDocumentId,
          reviewId: patch.reviewId, selectedIssueIds: patch.selectedIssueIds, editedText: patch.editedText, rationale: patch.rationale, model: "qwen3.5:9b", rawOutput: output,
        });
        if (result.kind !== "ok") throw new Error("Editor 正式草稿提交失败。 ");
      },
    });
    const tasks = createChapterEditorTaskService({ local, drafts, reviews, editor });

    await expect(tasks.start({
      command: command("start"), taskId: "editor_task_001", projectId: "project_001", chapterId: "chapter_001", title: "第一章 V2",
      targetDocumentId: "production:chapter_draft:chapter_001:v2", sourceDraftDocumentId: v1().documentId, reviewId: "review_001", selectedIssueIds: ["issue_tide"],
      rationale: "只修正潮水逻辑链。", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024,
    })).resolves.toMatchObject({ kind: "accepted", taskId: "editor_task_001" });
    await expect(tasks.run("editor_task_001")).resolves.toMatchObject({ status: "succeeded" });
    expect(caller.complete).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("唯一可替换原文片段（字面量，不得添加前后字符）"),
    }), expect.any(AbortSignal));
    await expect(editor.getDraft("production:chapter_draft:chapter_001:v2")).resolves.toMatchObject({
      parentDocumentId: v1().documentId,
      revision: "v2",
      reviewId: "review_001",
      selectedIssueIds: ["issue_tide"],
      model: "qwen3.5:9b",
      text: "林霁推开钟楼的门，翻涌的潮水在门外停住。",
    });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM production_commits", params: [] })).resolves.toEqual([{ count: 0 }]);
  });

  it("补丁包含未选择的问题、改写正文外范围或与冻结输入不匹配时 fail closed", async () => {
    const manifest = editorTaskManifest();
    const input = { taskId: "editor_task_invalid", projectId: "project_001", prompt: `前言\n<AINOVR_EDITOR_TASK_MANIFEST>\n${JSON.stringify(manifest)}\n</AINOVR_EDITOR_TASK_MANIFEST>`, metadata: { schema_version: 1, kind: "chapter_editor_patch", chapterId: "chapter_001", targetDocumentId: manifest.targetDocumentId, sourceDraftDocumentId: manifest.source.documentId, reviewId: manifest.review.reviewId, selectedIssueIds: ["issue_tide"], rationale: manifest.rationale } };
    await expect(() => validateChapterEditorPatchOutput(input, JSON.stringify({ ...patch(), replacements: [{ issueId: "other_issue", replacement: "替换" }] }))).toThrow(/选择|冻结|问题/);
    await expect(() => validateChapterEditorPatchOutput(input, JSON.stringify({ ...patch(), selectedIssueIds: ["issue_tide"], replacements: [{ issueId: "issue_tide", replacement: "全新的另一章，人物和场景全部替换。" }] }))).toThrow(/范围|整章/);
  });

  it("MCP 仅在配置本机 Editor 任务服务后暴露启动与恢复入口", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const editorTasks: ChapterEditorTaskService = {
      start: vi.fn().mockResolvedValue({ kind: "accepted", taskId: "editor_task_001" }),
      run: vi.fn().mockResolvedValue({ taskId: "editor_task_001", status: "queued" }),
      cancel: vi.fn().mockResolvedValue(undefined),
      getTask: vi.fn().mockResolvedValue({ taskId: "editor_task_001", status: "queued" }),
      getDraft: vi.fn().mockResolvedValue(null),
    };
    const handler = createApplicationMcpJsonRpcHandler({ application, editorTasks });
    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["start_chapter_editor", "resume_chapter_editor"]));

    await expect(handler({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "start_chapter_editor", arguments: {
        commandId: "command_editor", idempotencyKey: "idem_editor", correlationId: "correlation_editor", taskId: "editor_task_001", projectId: "project_001", chapterId: "chapter_001", title: "第一章 V2",
        targetDocumentId: "production:chapter_draft:chapter_001:v2", sourceDraftDocumentId: v1().documentId, reviewId: "review_001", selectedIssueIds: ["issue_tide"], rationale: "只修正潮水逻辑链。", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024,
      } },
    })).resolves.toMatchObject({ result: { structuredContent: { kind: "accepted", taskId: "editor_task_001" } } });
  });
});

function v1(): ChapterReaderDraft {
  return { documentId: "production:chapter_draft:chapter_001:v1", projectId: "project_001", chapterId: "chapter_001", manifestId: "writer_manifest_001", title: "第一章 V1", text: "林霁推开钟楼的门，潮水在门外停住。", model: "qwen3:8b", executionRef: "writer_task_001", revision: "v1" };
}

function review(): ChapterReview {
  return { schema_version: 1, kind: "chapter_review", reviewId: "review_001", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: v1().documentId, draftRevision: "v1", readerManifestIds: ["reader_immersive", "reader_low", "reader_logic"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low", "feedback_logic"], issues: [{ id: "issue_tide", category: "continuity", severity: "major", message: "潮水缺少因果承接。", startByte: 27, endByte: 33, quote: "潮水" }] };
}

function editorTaskManifest() {
  return { schema_version: 1, kind: "chapter_editor_task_manifest", projectId: "project_001", chapterId: "chapter_001", title: "第一章 V2", targetDocumentId: "production:chapter_draft:chapter_001:v2", source: v1(), review: review(), selectedIssueIds: ["issue_tide"], rationale: "只修正潮水逻辑链。", conversationHistory: [] };
}

function patch() {
  return { schema_version: 1, kind: "chapter_editor_patch", projectId: "project_001", chapterId: "chapter_001", targetDocumentId: "production:chapter_draft:chapter_001:v2", sourceDraftDocumentId: v1().documentId, sourceRevision: "v1", reviewId: "review_001", selectedIssueIds: ["issue_tide"], replacements: [{ issueId: "issue_tide", replacement: "翻涌的潮水" }] };
}

function patchJson(): string { return JSON.stringify(patch()); }

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "external_agent", id: "mcp" }, createdAt: 1_700_000_000_000 };
}
