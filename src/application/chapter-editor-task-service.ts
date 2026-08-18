import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import { type ChapterEditorDraft, type ChapterEditorService, validateChapterEditorDraft } from "@/application/chapter-editor-service";
import type { ChapterReaderDraft } from "@/application/chapter-reader-manifest-service";
import type { ChapterReview, ChapterReviewIssue } from "@/application/chapter-review-service";
import type { LocalCreationOutputValidationInput, LocalCreationService } from "@/application/local-creation-service";
import type { TaskRecord } from "@/application/task-runner";

type RecordValue = Record<string, unknown>;

export interface ChapterEditorTaskReview {
  reviewId: string;
  draftDocumentId: string;
  draftRevision: "v1" | "v2";
  issues: ChapterReviewIssue[];
}

export interface ChapterEditorTaskManifest {
  schema_version: 1;
  kind: "chapter_editor_task_manifest";
  projectId: string;
  chapterId: string;
  title: string;
  targetDocumentId: string;
  source: ChapterReaderDraft;
  review: ChapterEditorTaskReview;
  selectedIssueIds: [string];
  rationale: string;
  conversationHistory: [];
}

export interface ChapterEditorPatchResult {
  projectId: string;
  chapterId: string;
  title: string;
  targetDocumentId: string;
  sourceDraftDocumentId: string;
  reviewId: string;
  selectedIssueIds: string[];
  rationale: string;
  editedText: string;
}

export interface ChapterEditorTaskService {
  start(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    taskId: string;
    projectId: string;
    chapterId: string;
    title: string;
    targetDocumentId: string;
    sourceDraftDocumentId: string;
    reviewId: string;
    selectedIssueIds: string[];
    rationale: string;
    baseURL: string;
    model: string;
    maxTokens?: number;
  }): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  cancel(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  getDraft(documentId: string): Promise<ChapterEditorDraft | null>;
}

/**
 * Editor 任务只接收当前草稿和一个选定的精确 Review 问题。模型生成替换片段，
 * 系统按已验证的 UTF-8 区间合成全文，禁止借“修订”进行整章重写。
 */
export function createChapterEditorTaskService(options: {
  local: LocalCreationService;
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | ChapterEditorDraft | null> }, "getDraft">;
  reviews: Pick<{ get(input: { projectId: string; reviewId: string }): Promise<ChapterReview | null> }, "get">;
  editor: Pick<ChapterEditorService, "getDraft">;
}): ChapterEditorTaskService {
  return {
    async start(input) {
      assertNonEmpty(input.taskId, "taskId");
      assertNonEmpty(input.projectId, "projectId");
      assertNonEmpty(input.chapterId, "chapterId");
      assertNonEmpty(input.title, "title");
      assertNonEmpty(input.targetDocumentId, "targetDocumentId");
      assertNonEmpty(input.sourceDraftDocumentId, "sourceDraftDocumentId");
      assertNonEmpty(input.reviewId, "reviewId");
      assertNonEmpty(input.rationale, "rationale");
      const source = await options.drafts.getDraft(input.sourceDraftDocumentId);
      assertSource(source, input.projectId, input.chapterId);
      const review = await options.reviews.get({ projectId: input.projectId, reviewId: input.reviewId });
      const { review: verifiedReview, issue } = assertReviewAndSelectIssue(review, input, source);
      const manifest: ChapterEditorTaskManifest = {
        schema_version: 1,
        kind: "chapter_editor_task_manifest",
        projectId: input.projectId,
        chapterId: input.chapterId,
        title: input.title,
        targetDocumentId: input.targetDocumentId,
        source: toReaderDraft(source),
        review: { reviewId: verifiedReview.reviewId, draftDocumentId: verifiedReview.draftDocumentId, draftRevision: verifiedReview.draftRevision as "v1" | "v2", issues: [issue] },
        selectedIssueIds: [issue.id],
        rationale: input.rationale,
        conversationHistory: [],
      };
      assertTargetDocumentId(manifest.targetDocumentId, manifest.chapterId, source.revision);
      return options.local.start({
        command: input.command,
        taskId: input.taskId,
        documentId: input.targetDocumentId,
        projectId: input.projectId,
        title: input.title,
        prompt: editorPrompt(manifest),
        baseURL: input.baseURL,
        model: input.model,
        ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        outputMode: "structured_json",
        metadata: {
          schema_version: 1,
          kind: "chapter_editor_patch",
          chapterId: input.chapterId,
          targetDocumentId: input.targetDocumentId,
          sourceDraftDocumentId: input.sourceDraftDocumentId,
          reviewId: input.reviewId,
          selectedIssueIds: [issue.id],
          rationale: input.rationale,
        },
      });
    },

    run(taskId) { return options.local.run(taskId); },
    cancel(taskId) { return options.local.cancel(taskId); },
    getTask(taskId) { return options.local.getTask(taskId); },
    getDraft(documentId) { return options.editor.getDraft(documentId); },
  };
}

/** LocalCreation 的提交前闸门：无效或越界补丁不会成为任务产物。 */
export function validateChapterEditorPatchOutput(input: Pick<LocalCreationOutputValidationInput, "taskId" | "projectId" | "prompt" | "metadata">, text: string): void {
  parseChapterEditorPatchOutput(input, text);
}

/** 供 commitOutput 复用：解析模型原始 JSON，按冻结 issue 区间确定性合成完整正文。 */
export function parseChapterEditorPatchOutput(input: Pick<LocalCreationOutputValidationInput, "taskId" | "projectId" | "prompt" | "metadata">, text: string): ChapterEditorPatchResult {
  const manifest = manifestFromPrompt(input.prompt);
  assertMetadata(input.metadata, manifest, input.projectId);
  const patch = parsePatch(text);
  assertPatchMatchesManifest(patch, manifest);
  assertReplacementBudget(manifest.review.issues[0]!, patch.replacement);
  const editedText = applyReplacement(manifest.source.text, manifest.review.issues[0]!, patch.replacement);
  const review = asValidationReview(manifest);
  validateChapterEditorDraft({
    projectId: manifest.projectId,
    chapterId: manifest.chapterId,
    documentId: manifest.targetDocumentId,
    sourceDraftDocumentId: manifest.source.documentId,
    reviewId: manifest.review.reviewId,
    selectedIssueIds: [...manifest.selectedIssueIds],
    editedText,
    source: manifest.source,
    review,
  });
  return {
    projectId: manifest.projectId,
    chapterId: manifest.chapterId,
    title: manifest.title,
    targetDocumentId: manifest.targetDocumentId,
    sourceDraftDocumentId: manifest.source.documentId,
    reviewId: manifest.review.reviewId,
    selectedIssueIds: [...manifest.selectedIssueIds],
    rationale: manifest.rationale,
    editedText,
  };
}

function editorPrompt(manifest: ChapterEditorTaskManifest): string {
  const issue = manifest.review.issues[0]!;
  const skeleton = {
    schema_version: 1,
    kind: "chapter_editor_patch",
    projectId: manifest.projectId,
    chapterId: manifest.chapterId,
    targetDocumentId: manifest.targetDocumentId,
    sourceDraftDocumentId: manifest.source.documentId,
    sourceRevision: manifest.source.revision,
    reviewId: manifest.review.reviewId,
    selectedIssueIds: manifest.selectedIssueIds,
    replacements: [{ issueId: issue.id, replacement: "仅替换问题引文的修订文本" }],
  };
  return [
    "你是 Ainovr 的定向 Editor。只依据冻结输入修订一个 Reviewer 已定位的问题，禁止整章重写或改动问题引文之外的字符。",
    "只输出一个 JSON 对象，不能使用 Markdown、代码围栏、评分、解释或未定义字段。replacements 必须恰好包含一个对象，issueId 不可改名，replacement 是替换该问题引文的文本。",
    "输出不得复述任何参考作品、作者秘密、机制说明或冻结输入以外的信息。",
    "使用下列不可改名骨架：",
    JSON.stringify(skeleton),
    "<AINOVR_EDITOR_TASK_MANIFEST>",
    JSON.stringify(manifest),
    "</AINOVR_EDITOR_TASK_MANIFEST>",
  ].join("\n");
}

function assertReviewAndSelectIssue(review: ChapterReview | null, input: { chapterId: string; sourceDraftDocumentId: string; reviewId: string; selectedIssueIds: string[] }, source: ChapterReaderDraft | ChapterEditorDraft): { review: ChapterReview; issue: ChapterReviewIssue } {
  if (!review || review.reviewId !== input.reviewId || review.chapterId !== input.chapterId || review.draftDocumentId !== input.sourceDraftDocumentId || review.draftRevision !== source.revision) throw new Error("Editor 必须使用对应源草稿的已验证 Reviewer 报告。 ");
  if (!Array.isArray(input.selectedIssueIds) || input.selectedIssueIds.length !== 1 || typeof input.selectedIssueIds[0] !== "string" || !input.selectedIssueIds[0].trim()) throw new Error("本机 Editor 每次只能定向处理一个 Reviewer 问题。 ");
  const issue = review.issues.find((item) => item.id === input.selectedIssueIds[0]);
  if (!issue) throw new Error("Editor 选择的问题不属于该 Reviewer 报告。 ");
  return { review, issue };
}

function assertSource(source: ChapterReaderDraft | ChapterEditorDraft | null, projectId: string, chapterId: string): asserts source is ChapterReaderDraft | ChapterEditorDraft {
  if (!source || source.projectId !== projectId || source.chapterId !== chapterId || !source.text.trim() || (source.revision !== "v1" && source.revision !== "v2")) throw new Error("Editor 源草稿不存在、不属于当前章节或不是可编辑版本。 ");
}

function assertTargetDocumentId(documentId: string, chapterId: string, sourceRevision: "v1" | "v2" | "v3"): void {
  const revision = sourceRevision === "v1" ? "v2" : sourceRevision === "v2" ? "v3" : null;
  if (!revision || documentId !== `production:chapter_draft:${chapterId}:${revision}`) throw new Error("Editor 目标文档不是源版本的受控下一 revision。 ");
}

function toReaderDraft(source: ChapterReaderDraft | ChapterEditorDraft): ChapterReaderDraft {
  return { documentId: source.documentId, projectId: source.projectId, chapterId: source.chapterId, manifestId: source.manifestId, title: source.title, text: source.text, model: source.model, taskId: source.taskId, revision: source.revision };
}

function manifestFromPrompt(prompt: string): ChapterEditorTaskManifest {
  const startTag = "<AINOVR_EDITOR_TASK_MANIFEST>\n";
  const endTag = "\n</AINOVR_EDITOR_TASK_MANIFEST>";
  const start = prompt.indexOf(startTag);
  const end = prompt.lastIndexOf(endTag);
  if (start < 0 || end <= start) throw new Error("Editor 任务 Prompt 缺少冻结 Manifest。 ");
  try {
    const value = JSON.parse(prompt.slice(start + startTag.length, end));
    const record = recordValue(value);
    if (!record || record.schema_version !== 1 || record.kind !== "chapter_editor_task_manifest" || !recordValue(record.source) || !recordValue(record.review) || !Array.isArray(record.selectedIssueIds) || record.selectedIssueIds.length !== 1 || !Array.isArray(record.conversationHistory) || record.conversationHistory.length !== 0) throw new Error();
    return value as ChapterEditorTaskManifest;
  } catch { throw new Error("Editor 任务冻结 Manifest 损坏。 "); }
}

function assertMetadata(metadata: Record<string, unknown> | undefined, manifest: ChapterEditorTaskManifest, projectId: string): void {
  const record = recordValue(metadata);
  if (!record || record.schema_version !== 1 || record.kind !== "chapter_editor_patch" || projectId !== manifest.projectId || requiredString(record, "chapterId") !== manifest.chapterId || requiredString(record, "targetDocumentId") !== manifest.targetDocumentId || requiredString(record, "sourceDraftDocumentId") !== manifest.source.documentId || requiredString(record, "reviewId") !== manifest.review.reviewId || requiredString(record, "rationale") !== manifest.rationale) throw new Error("Editor 任务 metadata 与冻结输入不匹配。 ");
  const selected = stringList(record.selectedIssueIds, "selectedIssueIds");
  if (selected.length !== 1 || selected[0] !== manifest.selectedIssueIds[0]) throw new Error("Editor 任务选定问题与冻结输入不匹配。 ");
}

interface ParsedPatch {
  projectId: string;
  chapterId: string;
  targetDocumentId: string;
  sourceDraftDocumentId: string;
  sourceRevision: "v1" | "v2";
  reviewId: string;
  selectedIssueIds: string[];
  issueId: string;
  replacement: string;
}

function parsePatch(text: string): ParsedPatch {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Editor 输出必须是 JSON 对象。 "); }
  const record = recordValue(value);
  if (!record) throw new Error("Editor 输出必须是 JSON 对象。 ");
  const allowed = new Set(["schema_version", "kind", "projectId", "chapterId", "targetDocumentId", "sourceDraftDocumentId", "sourceRevision", "reviewId", "selectedIssueIds", "replacements"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("Editor 输出包含未定义字段。 ");
  if (record.schema_version !== 1 || record.kind !== "chapter_editor_patch") throw new Error("Editor 输出 schema 无效。 ");
  const sourceRevision = record.sourceRevision;
  if (sourceRevision !== "v1" && sourceRevision !== "v2") throw new Error("Editor 输出 sourceRevision 非法。 ");
  const selectedIssueIds = stringList(record.selectedIssueIds, "selectedIssueIds");
  const replacements = record.replacements;
  if (!Array.isArray(replacements) || replacements.length !== 1) throw new Error("Editor 输出必须只包含一个定向替换。 ");
  const replacement = recordValue(replacements[0]);
  if (!replacement || Object.keys(replacement).some((key) => key !== "issueId" && key !== "replacement")) throw new Error("Editor 替换字段非法。 ");
  const textValue = requiredString(replacement, "replacement");
  if (!textValue.trim()) throw new Error("Editor 替换文本不可为空。 ");
  return { projectId: requiredString(record, "projectId"), chapterId: requiredString(record, "chapterId"), targetDocumentId: requiredString(record, "targetDocumentId"), sourceDraftDocumentId: requiredString(record, "sourceDraftDocumentId"), sourceRevision, reviewId: requiredString(record, "reviewId"), selectedIssueIds, issueId: requiredString(replacement, "issueId"), replacement: textValue };
}

function assertPatchMatchesManifest(patch: ParsedPatch, manifest: ChapterEditorTaskManifest): void {
  if (patch.projectId !== manifest.projectId || patch.chapterId !== manifest.chapterId || patch.targetDocumentId !== manifest.targetDocumentId || patch.sourceDraftDocumentId !== manifest.source.documentId || patch.sourceRevision !== manifest.source.revision || patch.reviewId !== manifest.review.reviewId || patch.selectedIssueIds.length !== 1 || patch.selectedIssueIds[0] !== manifest.selectedIssueIds[0] || patch.issueId !== manifest.selectedIssueIds[0] || !patch.replacement.trim()) throw new Error("Editor 输出与冻结的版本、问题或替换范围不匹配。 ");
}

function applyReplacement(source: string, issue: ChapterReviewIssue, replacement: string): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(source);
  if (issue.startByte < 0 || issue.endByte <= issue.startByte || issue.endByte > bytes.length || decoder.decode(bytes.slice(issue.startByte, issue.endByte)) !== issue.quote) throw new Error("Editor 引用问题的 UTF-8 范围不再有效。 ");
  return `${decoder.decode(bytes.slice(0, issue.startByte))}${replacement}${decoder.decode(bytes.slice(issue.endByte))}`;
}

function assertReplacementBudget(issue: ChapterReviewIssue, replacement: string): void {
  const sourceBytes = new TextEncoder().encode(issue.quote).length;
  const replacementBytes = new TextEncoder().encode(replacement).length;
  if (replacementBytes > sourceBytes * 4) throw new Error("Editor 替换超出定向问题范围，疑似整章或大段重写。 ");
}

function asValidationReview(manifest: ChapterEditorTaskManifest): ChapterReview {
  return { schema_version: 1, kind: "chapter_review", reviewId: manifest.review.reviewId, projectId: manifest.projectId, chapterId: manifest.chapterId, draftDocumentId: manifest.review.draftDocumentId, draftRevision: manifest.review.draftRevision, readerManifestIds: [], readerFeedbackDocumentIds: [], issues: manifest.review.issues };
}

function requiredString(record: RecordValue, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 必须是非空字符串。`);
  return value;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || new Set(value).size !== value.length) throw new Error(`${label} 必须是无重复非空字符串数组。 `);
  return [...value] as string[];
}

function recordValue(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
