import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { ChapterReaderContextManifest, ChapterReaderDraft, ChapterReaderKind } from "@/application/chapter-reader-manifest-service";
import type { ChapterReaderFeedback } from "@/application/chapter-reader-service";
import { validateChapterReviewOutput, type ChapterReview, type ChapterReviewService } from "@/application/chapter-review-service";
import type { LocalCreationOutputValidationInput, LocalCreationService } from "@/application/local-creation-service";
import type { TaskRecord } from "@/application/task-runner";

const READER_KINDS = ["immersive", "low_patience", "logic_sensitive"] as const;
type RecordValue = Record<string, unknown>;

export interface ChapterReviewerTaskManifest {
  schema_version: 1;
  kind: "chapter_reviewer_task_manifest";
  reviewId: string;
  projectId: string;
  chapterId: string;
  readerManifestIds: string[];
  readerFeedbackDocumentIds: string[];
  conversationHistory: [];
  draft: ChapterReaderDraft;
  readerFeedbacks: ChapterReaderFeedback[];
}

export interface ChapterReviewerService {
  start(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    taskId: string;
    projectId: string;
    chapterId: string;
    draftDocumentId: string;
    reviewId: string;
    readerManifestIds: string[];
    readerFeedbackDocumentIds: string[];
    title: string;
    baseURL: string;
    model: string;
    maxTokens?: number;
  }): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  cancel(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  getReview(input: { projectId: string; reviewId: string }): Promise<ChapterReview | null>;
}

/**
 * 独立 Reviewer 的本机任务入口。任务输入以不可变对象保存，只带正文及三个
 * Reader 的结构化反馈；它不读取 Writer 机制、规划秘密、参考或分析侧资料。
 */
export function createChapterReviewerService(options: {
  local: LocalCreationService;
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">;
  readerManifests: Pick<{ get(input: { projectId: string; manifestId: string }): Promise<ChapterReaderContextManifest | null> }, "get">;
  readerFeedbacks: Pick<{ getReport(input: { documentId: string }): Promise<ChapterReaderFeedback | null> }, "getReport">;
  reviews: Pick<ChapterReviewService, "get">;
}): ChapterReviewerService {
  return {
    async start(input) {
      assertNonEmpty(input.projectId, "projectId");
      assertNonEmpty(input.chapterId, "chapterId");
      assertNonEmpty(input.draftDocumentId, "draftDocumentId");
      assertNonEmpty(input.reviewId, "reviewId");
      const draft = await options.drafts.getDraft(input.draftDocumentId);
      assertDraft(draft, input.projectId, input.chapterId);
      const manifest = await buildManifest(options, input, draft);
      return options.local.start({
        command: input.command,
        taskId: input.taskId,
        documentId: `production:chapter_review:${input.reviewId}`,
        projectId: input.projectId,
        title: input.title,
        prompt: reviewerPrompt(manifest),
        baseURL: input.baseURL,
        model: input.model,
        ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        outputMode: "structured_json",
        metadata: {
          schema_version: 1,
          kind: "chapter_reviewer_report",
          reviewId: input.reviewId,
          chapterId: input.chapterId,
          draftDocumentId: input.draftDocumentId,
          readerManifestIds: [...input.readerManifestIds],
          readerFeedbackDocumentIds: [...input.readerFeedbackDocumentIds],
        },
      });
    },

    run(taskId) { return options.local.run(taskId); },
    cancel(taskId) { return options.local.cancel(taskId); },
    getTask(taskId) { return options.local.getTask(taskId); },
    getReview(input) { return options.reviews.get(input); },
  };
}

/** LocalCreation 的严格闸门：只在 Reviewer 输出可被正文区间契约验证时通过。 */
export function validateChapterReviewerOutput(input: LocalCreationOutputValidationInput, text: string): void {
  const metadata = recordValue(input.metadata);
  if (!metadata || metadata.kind !== "chapter_reviewer_report") throw new Error("Reviewer 任务缺少受控 metadata。 ");
  const manifest = manifestFromPrompt(input.prompt);
  if (manifest.projectId !== input.projectId || manifest.reviewId !== requiredString(metadata, "reviewId") || manifest.chapterId !== requiredString(metadata, "chapterId") || manifest.draft.documentId !== requiredString(metadata, "draftDocumentId")) throw new Error("Reviewer 任务输入与冻结 Manifest 不匹配。 ");
  validateChapterReviewOutput(text, {
    projectId: manifest.projectId,
    chapterId: manifest.chapterId,
    draftDocumentId: manifest.draft.documentId,
    reviewId: manifest.reviewId,
    readerManifestIds: manifest.readerManifestIds,
    readerFeedbackDocumentIds: manifest.readerFeedbackDocumentIds,
    draft: manifest.draft,
  });
}

async function buildManifest(
  options: Pick<Parameters<typeof createChapterReviewerService>[0], "readerManifests" | "readerFeedbacks">,
  input: { projectId: string; chapterId: string; reviewId: string; readerManifestIds: string[]; readerFeedbackDocumentIds: string[] },
  draft: ChapterReaderDraft,
): Promise<ChapterReviewerTaskManifest> {
  assertTriple(input.readerManifestIds, "Reader Manifest");
  assertTriple(input.readerFeedbackDocumentIds, "Reader 反馈");
  const [manifests, feedbacks] = await Promise.all([
    Promise.all(input.readerManifestIds.map((manifestId) => options.readerManifests.get({ projectId: input.projectId, manifestId }))),
    Promise.all(input.readerFeedbackDocumentIds.map((documentId) => options.readerFeedbacks.getReport({ documentId }))),
  ]);
  const manifestById = new Map<string, ChapterReaderContextManifest>();
  for (const manifest of manifests) {
    if (!manifest || manifest.projectId !== input.projectId || manifest.chapterId !== input.chapterId || manifest.draft.documentId !== draft.documentId || manifest.draft.revision !== draft.revision || manifest.draft.text !== draft.text || !Array.isArray(manifest.conversationHistory) || manifest.conversationHistory.length !== 0) throw new Error("Reviewer 任务引用的 Reader Manifest 不属于当前正文。 ");
    manifestById.set(manifest.manifestId, manifest);
  }
  if (manifestById.size !== 3 || READER_KINDS.some((kind) => ![...manifestById.values()].some((manifest) => manifest.readerKind === kind))) throw new Error("Reviewer 必须使用三个独立 Reader Manifest。 ");
  const feedbackByKind = new Map<ChapterReaderKind, ChapterReaderFeedback>();
  for (const feedback of feedbacks) {
    if (!feedback || feedback.projectId !== input.projectId || feedback.chapterId !== input.chapterId || feedback.draftDocumentId !== draft.documentId || feedback.draftRevision !== draft.revision) throw new Error("Reviewer 任务缺少已验证的 Reader 反馈。 ");
    const sourceManifest = manifestById.get(feedback.manifestId);
    if (!sourceManifest || sourceManifest.readerKind !== feedback.readerKind) throw new Error("Reader 反馈与冻结 Manifest 不匹配。 ");
    feedbackByKind.set(feedback.readerKind, feedback);
  }
  if (READER_KINDS.some((kind) => !feedbackByKind.has(kind))) throw new Error("Reviewer 任务缺少三个 Reader 的独立反馈。 ");
  return {
    schema_version: 1,
    kind: "chapter_reviewer_task_manifest",
    reviewId: input.reviewId,
    projectId: input.projectId,
    chapterId: input.chapterId,
    readerManifestIds: [...input.readerManifestIds],
    readerFeedbackDocumentIds: [...input.readerFeedbackDocumentIds],
    conversationHistory: [],
    draft,
    readerFeedbacks: READER_KINDS.map((kind) => feedbackByKind.get(kind)!),
  };
}

function reviewerPrompt(manifest: ChapterReviewerTaskManifest): string {
  return [
    "你是 Ainovr 的独立 Reviewer。只依据下方冻结任务输入，综合结构、连续性、表达与原创性/来源泄漏风险提出可执行问题。",
    "不得输出赞美、评分、总体通过结论、Markdown 或任何正文外猜测。issues 可以为空；每个问题都必须给出原样 quote 与 UTF-8 半开字节区间 [startByte,endByte)。",
    "只输出一个 JSON 对象，字段固定为 schema_version、kind、reviewId、projectId、chapterId、draftDocumentId、draftRevision、readerManifestIds、readerFeedbackDocumentIds、issues；每个 issue 固定为 id、category、severity、message、startByte、endByte、quote。category 只能为 structure、continuity、expression、originality；severity 只能为 blocker、major、minor。",
    "请使用以下不可改名的 JSON 骨架：",
    JSON.stringify({ schema_version: 1, kind: "chapter_review", reviewId: manifest.reviewId, projectId: manifest.projectId, chapterId: manifest.chapterId, draftDocumentId: manifest.draft.documentId, draftRevision: manifest.draft.revision, readerManifestIds: manifest.readerManifestIds, readerFeedbackDocumentIds: manifest.readerFeedbackDocumentIds, issues: [] }),
    "<AINOVR_REVIEWER_TASK_MANIFEST>",
    JSON.stringify(manifest),
    "</AINOVR_REVIEWER_TASK_MANIFEST>",
  ].join("\n");
}

function manifestFromPrompt(prompt: string): ChapterReviewerTaskManifest {
  const startTag = "<AINOVR_REVIEWER_TASK_MANIFEST>\n";
  const endTag = "\n</AINOVR_REVIEWER_TASK_MANIFEST>";
  const start = prompt.indexOf(startTag);
  const end = prompt.lastIndexOf(endTag);
  if (start < 0 || end <= start) throw new Error("Reviewer 任务 Prompt 缺少冻结输入。 ");
  try {
    const value = JSON.parse(prompt.slice(start + startTag.length, end));
    const record = recordValue(value);
    if (!record || record.schema_version !== 1 || record.kind !== "chapter_reviewer_task_manifest" || !Array.isArray(record.conversationHistory) || record.conversationHistory.length !== 0 || !recordValue(record.draft) || !Array.isArray(record.readerManifestIds) || !Array.isArray(record.readerFeedbackDocumentIds)) throw new Error();
    return value as ChapterReviewerTaskManifest;
  } catch { throw new Error("Reviewer 任务冻结输入损坏。 "); }
}

function assertDraft(draft: ChapterReaderDraft | null, projectId: string, chapterId: string): asserts draft is ChapterReaderDraft {
  if (!draft || draft.projectId !== projectId || draft.chapterId !== chapterId || !draft.documentId.trim() || !draft.text.trim()) throw new Error("Reviewer 待评草稿不存在或不属于当前章节。 ");
}

function assertTriple(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length !== 3 || new Set(value).size !== 3 || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${label} 必须恰好包含三个不重复条目。`);
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}

function requiredString(record: RecordValue, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 必须是非空字符串。`);
  return value;
}

function recordValue(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}
