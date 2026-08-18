import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChapterReaderContextManifest } from "@/application/chapter-reader-manifest-service";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createChapterReviewService, validateChapterReviewOutput } from "@/application/chapter-review-service";
import type { CommandEnvelope } from "@/application/command-types";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterReview Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-chapter-review-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("保存独立 Reviewer 结果时，每个问题必须绑定本次正文的精确 UTF-8 区间与引文", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const reviews = createChapterReviewService({ driver, commands: application.commands, objects, drafts: { getDraft: async () => draft() }, readerManifests: { get: async ({ manifestId }) => readerManifest(manifestId) } });
    const rawOutput = JSON.stringify({
      schema_version: 1,
      kind: "chapter_review",
      reviewId: "review_001",
      projectId: "project_001",
      chapterId: "chapter_001",
      draftDocumentId: draft().documentId,
      draftRevision: "v1",
      readerManifestIds: ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"],
      readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"],
      issues: [{ id: "issue_001", category: "continuity", severity: "major", message: "潮水停住缺少前文可见的因果承接。", startByte: 0, endByte: 6, quote: "林霁" }],
    });

    await expect(reviews.submit({ command: command("review"), projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, reviewId: "review_001", readerManifestIds: ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"], rawOutput }))
      .resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(reviews.get({ projectId: "project_001", reviewId: "review_001" })).resolves.toMatchObject({
      draftDocumentId: draft().documentId,
      readerManifestIds: ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"],
      readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"],
      issues: [{ id: "issue_001", category: "continuity", startByte: 0, endByte: 6, quote: "林霁" }],
    });
    const commands = await driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE tool = 'commit_project_planning_document'", params: [] });
    expect(commands[0]?.args_json).not.toContain("潮水停住缺少前文");
  });

  it("模型给出的 Reviewer 字节区间失准时，仅在引文唯一命中正文时确定性重算区间", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project_normalise"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const reviews = createChapterReviewService({ driver, commands: application.commands, objects, drafts: { getDraft: async () => draft() }, readerManifests: { get: async ({ manifestId }) => readerManifest(manifestId) } });
    const readerManifestIds = ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"];
    const readerFeedbackDocumentIds = ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"];
    const rawOutput = JSON.stringify({
      schema_version: 1, kind: "chapter_review", reviewId: "review_normalise", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, draftRevision: "v1", readerManifestIds, readerFeedbackDocumentIds,
      issues: [{ id: "issue_001", category: "continuity", severity: "major", message: "需补足因果承接。", startByte: 1, endByte: 2, quote: "潮水" }],
    });

    await expect(reviews.submit({ command: command("normalise"), projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, reviewId: "review_normalise", readerManifestIds, readerFeedbackDocumentIds, rawOutput })).resolves.toMatchObject({ kind: "ok" });
    await expect(reviews.get({ projectId: "project_001", reviewId: "review_normalise" })).resolves.toMatchObject({ issues: [{ quote: "潮水", startByte: 27, endByte: 33 }] });
  });

  it("拒绝范围越界、引文不匹配、未凑齐三个独立 Reader，且不把赞美字段视为通过依据", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project_invalid"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const reviews = createChapterReviewService({ driver, commands: application.commands, objects, drafts: { getDraft: async () => draft() }, readerManifests: { get: async ({ manifestId }) => readerManifest(manifestId) } });
    const base = { schema_version: 1, kind: "chapter_review", reviewId: "review_invalid", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, draftRevision: "v1", readerManifestIds: ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"] };

    await expect(reviews.submit({ command: command("bad_range"), projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, reviewId: "review_invalid", readerManifestIds: base.readerManifestIds, readerFeedbackDocumentIds: base.readerFeedbackDocumentIds, rawOutput: JSON.stringify({ ...base, issues: [{ id: "bad", category: "structure", severity: "minor", message: "问题", startByte: 1, endByte: 6, quote: "不存在的引文" }] }) })).rejects.toThrow(/UTF-8|区间|引文/);
    await expect(reviews.submit({ command: command("missing_reader"), projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, reviewId: "review_invalid", readerManifestIds: ["reader_immersive", "reader_low_patience"], readerFeedbackDocumentIds: base.readerFeedbackDocumentIds, rawOutput: JSON.stringify({ ...base, readerManifestIds: ["reader_immersive", "reader_low_patience"], issues: [] }) })).rejects.toThrow(/三个/);
    await expect(reviews.submit({ command: command("praise"), projectId: "project_001", chapterId: "chapter_001", draftDocumentId: draft().documentId, reviewId: "review_invalid", readerManifestIds: base.readerManifestIds, readerFeedbackDocumentIds: base.readerFeedbackDocumentIds, rawOutput: JSON.stringify({ ...base, praise: ["写得很好"], issues: [] }) })).rejects.toThrow(/赞美|字段/);
  });

  it("有本章采用记录时逐项冻结 Writer Manifest 与检查信号，并以 UTF-8 锚点复核目标效果", () => {
    const chapterDraft = { ...draft(), text: "林霁🙂\r\n潮水停住。" };
    const application = {
      schema_version: 1 as const, kind: "chapter_mechanism_application" as const, applicationId: "production:chapter_mechanism_application:chapter_001", chapterId: "chapter_001", chapterContractRevision: 3,
      mechanismAssetId: "mechanism_001", mechanismRevision: 2, revision: 4,
      fields: { reason: { status: "specified" as const, value: "本章需要延迟揭示" }, plannedUse: { status: "specified" as const, value: "钟楼门前" }, observableReaderEffect: { status: "specified" as const, value: "制造疑问" }, misuseToAvoid: { status: "specified" as const, value: "不解释谜底" }, reviewSignals: [{ status: "specified" as const, value: "读者会停顿猜测" }] },
    };
    const output = JSON.stringify({
      schema_version: 1, kind: "chapter_review", reviewId: "review_effect", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: chapterDraft.documentId, draftRevision: "v1",
      readerManifestIds: ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"],
      applicationId: application.applicationId, applicationRevision: 4, writerManifestId: chapterDraft.manifestId, writerManifestRevision: 7, issues: [],
      effectAssessments: [{ signal: { status: "specified", value: "读者会停顿猜测" }, status: "partial", explanation: "异象已建立，但谜面仍较直白。", anchors: [{ startByte: 11, endByte: 17, quote: "潮水" }], sideEffect: "节奏略停顿", suggestedAction: "request_revision" }],
    });
    expect(validateChapterReviewOutput(output, { projectId: "project_001", chapterId: "chapter_001", draftDocumentId: chapterDraft.documentId, reviewId: "review_effect", readerManifestIds: ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"], draft: chapterDraft, application, writerManifestRevision: 7 }))
      .toMatchObject({ effectAssessments: [{ status: "partial", anchors: [{ quote: "潮水", startByte: 12, endByte: 18 }] }] });
    const missingSignal = JSON.stringify({ ...JSON.parse(output), effectAssessments: [] });
    expect(() => validateChapterReviewOutput(missingSignal, { projectId: "project_001", chapterId: "chapter_001", draftDocumentId: chapterDraft.documentId, reviewId: "review_effect", readerManifestIds: ["reader_immersive", "reader_low_patience", "reader_logic_sensitive"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low_patience", "feedback_logic_sensitive"], draft: chapterDraft, application, writerManifestRevision: 7 })).toThrow(/逐项|信号/);
  });

  it("MCP 仅在配置 Reviewer 服务后暴露结构化提交和读取入口", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const reviews = createChapterReviewService({
      driver,
      commands: application.commands,
      objects: await createNodeObjectStore({ workspacePath }),
      drafts: { getDraft: async () => draft() },
      readerManifests: { get: async ({ manifestId }) => readerManifest(manifestId) },
    });
    const handler = createApplicationMcpJsonRpcHandler({ application, reviews });
    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["submit_chapter_review", "get_chapter_review"]));
  });
});

function draft() {
  return { documentId: "production:chapter_draft:chapter_001:v1", projectId: "project_001", chapterId: "chapter_001", manifestId: "writer_manifest_001", title: "第一章 V1", text: "林霁推开钟楼的门，潮水在门外停住。", model: "qwen3:8b", executionRef: "writer_task_001", revision: "v1" as const };
}

function readerManifest(manifestId: string): ChapterReaderContextManifest | null {
  const readerKind = manifestId === "reader_immersive" ? "immersive" : manifestId === "reader_low_patience" ? "low_patience" : manifestId === "reader_logic_sensitive" ? "logic_sensitive" : null;
  return readerKind ? {
    schema_version: 1,
    kind: "chapter_reader_context_manifest",
    manifestId,
    projectId: "project_001",
    chapterId: "chapter_001",
    readerKind,
    conversationHistory: [],
    tokenBudget: 4096,
    tokenEstimate: 64,
    draft: { documentId: draft().documentId, title: draft().title, text: draft().text, revision: "v1" },
    layers: [
      { name: "generated_chapter_text", required: true, documentIds: [draft().documentId], value: { text: draft().text } },
      { name: "reader_state_and_promises", required: false, documentIds: [], value: { readerStates: [], readerPromises: [] } },
      { name: "necessary_past_context", required: false, documentIds: [], value: { acceptedChapter: null } },
    ],
  } : null;
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "external_agent", id: "mcp" }, createdAt: 1_700_000_000_000 };
}
