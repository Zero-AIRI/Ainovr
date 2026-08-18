import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterReaderContextManifest } from "@/application/chapter-reader-manifest-service";
import type { ChapterReaderFeedback } from "@/application/chapter-reader-service";
import { createChapterReviewerService, validateChapterReviewerOutput, type ChapterReviewerService } from "@/application/chapter-reviewer-service";
import { createChapterReviewService } from "@/application/chapter-review-service";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createLocalCreationService } from "@/application/local-creation-service";
import { createTaskRunner } from "@/application/task-runner";
import type { CommandEnvelope } from "@/application/command-types";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterReviewer 本机任务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-reviewer-task-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("把三个已验证 Reader 反馈冻结给 Reviewer，本机 JSON 校验后在同一任务内提交正式报告", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const drafts = { getDraft: async () => draft() };
    const manifests = { get: async ({ manifestId }: { projectId: string; manifestId: string }) => readerManifest(manifestId) };
    const reviews = createChapterReviewService({ driver, commands: application.commands, objects, drafts, readerManifests: manifests });
    const caller = { complete: vi.fn()
      .mockResolvedValueOnce({ text: "{not valid}", finishReason: "stop" })
      .mockResolvedValueOnce({ text: reviewJson(), finishReason: "stop" }) };
    const local = createLocalCreationService({
      driver,
      schemas,
      commands: application.commands,
      tasks: createTaskRunner(driver),
      objects,
      caller,
      hostId: "reviewer-host",
      validateOutput: validateChapterReviewerOutput,
      commitOutput: async ({ taskId, text }) => {
        const result = await reviews.submit({ command: { ...command(`commit_${taskId}`), actor: { kind: "internal_agent", id: "reviewer-host" } }, projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, reviewId: "review_001", readerManifestIds: manifestIds(), readerFeedbackDocumentIds: feedbackDocumentIds(), rawOutput: text });
        if (result.kind !== "ok") throw new Error("Reviewer 正式提交失败。");
      },
    });
    const reviewer = createChapterReviewerService({ local, drafts, readerManifests: manifests, readerFeedbacks: { getReport: async ({ documentId }) => feedback(documentId) }, reviews });

    await expect(reviewer.start({ command: command("start"), taskId: "reviewer_task_001", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, reviewId: "review_001", readerManifestIds: manifestIds(), readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low", "feedback_logic"], title: "第一章独立评审", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024 }))
      .resolves.toMatchObject({ kind: "accepted", taskId: "reviewer_task_001" });
    await expect(reviewer.run("reviewer_task_001")).resolves.toMatchObject({ status: "succeeded" });
    expect(caller.complete).toHaveBeenCalledTimes(2);
    expect(caller.complete).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: expect.stringContaining("<AINOVR_REVIEWER_TASK_MANIFEST>"),
      outputMode: "structured_json",
    }), expect.any(AbortSignal));
    await expect(reviewer.getReview({ projectId: "project_001", reviewId: "review_001" })).resolves.toMatchObject({ readerFeedbackDocumentIds: feedbackDocumentIds(), issues: [{ category: "continuity", quote: "潮水" }] });
    await expect(driver.query<{ status: string }>({ sql: "SELECT status FROM tasks WHERE task_id = ?", params: ["reviewer_task_001"] })).resolves.toEqual([{ status: "succeeded" }]);
  });

  it("Reader 反馈不全、身份不匹配或 Reviewer 输出无法定位时，任务在正式提交前失败", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute({ ...command("project_invalid"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const objects = await createNodeObjectStore({ workspacePath });
    const local = createLocalCreationService({ driver, schemas, commands: application.commands, tasks: createTaskRunner(driver), objects, caller: { complete: vi.fn() }, hostId: "reviewer-host", validateOutput: validateChapterReviewerOutput });
    const reviewer = createChapterReviewerService({ local, drafts: { getDraft: async () => draft() }, readerManifests: { get: async ({ manifestId }) => readerManifest(manifestId) }, readerFeedbacks: { getReport: async () => null }, reviews: { get: async () => null } });

    await expect(reviewer.start({ command: command("missing"), taskId: "reviewer_task_invalid", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, reviewId: "review_invalid", readerManifestIds: manifestIds(), readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low", "feedback_logic"], title: "评审", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024 })).rejects.toThrow(/Reader 反馈/);
  });

  it("MCP 仅在配置 Reviewer 本机任务服务后暴露启动、恢复与读取正式报告入口", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const reviewer: ChapterReviewerService = {
      start: vi.fn().mockResolvedValue({ kind: "accepted", taskId: "reviewer_task_001" }),
      run: vi.fn().mockResolvedValue({ taskId: "reviewer_task_001", status: "queued" }),
      cancel: vi.fn().mockResolvedValue(undefined),
      getTask: vi.fn().mockResolvedValue({ taskId: "reviewer_task_001", status: "queued" }),
      getReview: vi.fn().mockResolvedValue(null),
    };
    const handler = createApplicationMcpJsonRpcHandler({ application, reviewer });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["start_chapter_reviewer", "resume_chapter_reviewer", "get_chapter_reviewer_review"]));

    await expect(handler({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: {
        name: "start_chapter_reviewer",
        arguments: {
          commandId: "command_start_reviewer", idempotencyKey: "idem_start_reviewer", correlationId: "correlation_start_reviewer",
          taskId: "reviewer_task_001", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId,
          reviewId: "review_001", readerManifestIds: manifestIds(), readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low", "feedback_logic"],
          title: "第一章独立评审", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024,
        },
      },
    })).resolves.toMatchObject({ result: { structuredContent: { kind: "accepted", taskId: "reviewer_task_001" } } });
    expect(reviewer.start).toHaveBeenCalledWith(expect.objectContaining({ taskId: "reviewer_task_001", reviewId: "review_001" }));
  });
});

function draft() {
  return { documentId: "production:chapter_draft:chapter_001:v1", projectId: "project_001", chapterId: "chapter_001", manifestId: "writer_manifest_001", title: "第一章 V1", text: "林霁推开钟楼的门，潮水在门外停住。", model: "qwen3:8b", executionRef: "writer_task_001", revision: "v1" as const };
}

function manifestIds(): string[] { return ["reader_immersive", "reader_low", "reader_logic"]; }
function feedbackDocumentIds(): string[] { return ["feedback_immersive", "feedback_low", "feedback_logic"]; }

function readerManifest(manifestId: string): ChapterReaderContextManifest | null {
  const readerKind = manifestId === "reader_immersive" ? "immersive" : manifestId === "reader_low" ? "low_patience" : manifestId === "reader_logic" ? "logic_sensitive" : null;
  return readerKind ? {
    schema_version: 1, kind: "chapter_reader_context_manifest", manifestId, projectId: "project_001", chapterId: "chapter_001", readerKind, conversationHistory: [], tokenBudget: 4096, tokenEstimate: 128,
    draft: { documentId: draft().documentId, title: draft().title, text: draft().text, revision: "v1" },
    layers: [
      { name: "generated_chapter_text", required: true, documentIds: [draft().documentId], value: { text: draft().text } },
      { name: "reader_state_and_promises", required: false, documentIds: [], value: { readerStates: [], readerPromises: [] } },
      { name: "necessary_past_context", required: false, documentIds: [], value: { acceptedChapter: null } },
    ],
  } : null;
}

function feedback(documentId: string): ChapterReaderFeedback | null {
  const manifestId = documentId === "feedback_immersive" ? "reader_immersive" : documentId === "feedback_low" ? "reader_low" : documentId === "feedback_logic" ? "reader_logic" : null;
  const readerKind = manifestId === "reader_immersive" ? "immersive" : manifestId === "reader_low" ? "low_patience" : manifestId === "reader_logic" ? "logic_sensitive" : null;
  return manifestId && readerKind ? { schema_version: 1, kind: "chapter_reader_feedback", reportId: `report_${readerKind}`, projectId: "project_001", chapterId: "chapter_001", manifestId, draftDocumentId: draft().documentId, draftRevision: "v1", readerKind, issues: [] } : null;
}

function reviewJson(): string {
  return JSON.stringify({ schema_version: 1, kind: "chapter_review", reviewId: "review_001", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, draftRevision: "v1", readerManifestIds: manifestIds(), readerFeedbackDocumentIds: feedbackDocumentIds(), issues: [{ id: "review_issue_001", category: "continuity", severity: "major", message: "潮水停住缺少明确承接。", startByte: 27, endByte: 33, quote: "潮水" }] });
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() };
}
