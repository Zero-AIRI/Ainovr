import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ChapterReaderDraft } from "@/application/chapter-reader-manifest-service";
import type { ChapterReview, ChapterReviewIssue } from "@/application/chapter-review-service";
import type { ObjectReference, ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
type RecordValue = Record<string, unknown>;

export interface ChapterEditorChangedRange {
  sourceStartByte: number;
  sourceEndByte: number;
  replacementByteLength: number;
}

export interface ChapterEditorDraft extends ChapterReaderDraft {
  revision: "v2" | "v3";
  parentDocumentId: string;
  parentRevision: "v1" | "v2";
  reviewId: string;
  selectedIssueIds: string[];
  rationale: string;
  changedRange: ChapterEditorChangedRange;
}

export interface ChapterEditorService {
  create(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    /** 任务执行使用 taskId；人工或外部 Agent 直写使用 commandId。 */
    executionRef: string;
    projectId: string;
    chapterId: string;
    documentId: string;
    title: string;
    sourceDraftDocumentId: string;
    reviewId: string;
    selectedIssueIds: string[];
    editedText: string;
    rationale: string;
    /** 实际执行本次修订的模型；人工手改可省略并回退父草稿模型。 */
    model?: string;
    /** 本机 Editor 的原始结构化补丁；正文仍作为 canonical content 单独保存。 */
    rawOutput?: ObjectReference;
  }): Promise<CommandResult>;
  getDraft(documentId: string): Promise<ChapterEditorDraft | null>;
}

export interface ValidateChapterEditorDraftInput {
  projectId: string;
  chapterId: string;
  documentId: string;
  sourceDraftDocumentId: string;
  reviewId: string;
  selectedIssueIds: string[];
  editedText: string;
  source: ChapterReaderDraft | ChapterEditorDraft | null;
  review: ChapterReview | null;
}

/** 供本机 Editor task 与正式领域提交共用的定向修订规则。 */
export function validateChapterEditorDraft(input: ValidateChapterEditorDraftInput): { revision: "v2" | "v3"; changedRange: ChapterEditorChangedRange } {
  assertSource(input.source, input.projectId, input.chapterId);
  const revision = nextRevision(input.source.revision);
  if (input.documentId !== expectedDocumentId(input.chapterId, revision)) throw new Error(`Editor ${revision.toUpperCase()} 文档 id 必须为 ${expectedDocumentId(input.chapterId, revision)}。`);
  assertReview(input.review, input, input.source);
  const selectedIssues = selectIssues(input.review.issues, input.selectedIssueIds);
  const changedRange = calculateChangedRange(input.source.text, input.editedText);
  assertTargetedRange(changedRange, selectedIssues, input.source.text);
  return { revision, changedRange };
}

/**
 * Editor 只生成可比较的 V2/V3 草稿。它把改动限制在用户明确选择的 Reviewer
 * 问题范围内，且永不直接写 accepted chapter、Canon 或用户的版本选择。
 */
export function createChapterEditorService(options: {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  baseDrafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">;
  reviews: Pick<{ get(input: { projectId: string; reviewId: string }): Promise<ChapterReview | null> }, "get">;
}): ChapterEditorService {
  const getSource = async (documentId: string): Promise<ChapterReaderDraft | ChapterEditorDraft | null> => {
    const editorDraft = await readEditorDraft(options.driver, options.objects, documentId);
    return editorDraft ?? options.baseDrafts.getDraft(documentId);
  };

  return {
    async create(input) {
      assertId(input.projectId, "projectId");
      assertId(input.executionRef, "executionRef");
      assertId(input.chapterId, "chapterId");
      assertId(input.documentId, "documentId");
      assertId(input.title, "title");
      assertId(input.sourceDraftDocumentId, "sourceDraftDocumentId");
      assertId(input.reviewId, "reviewId");
      assertId(input.editedText, "editedText");
      assertId(input.rationale, "rationale");
      if (input.model !== undefined) assertId(input.model, "model");
      await assertProject(options.driver, input.projectId);
      const source = await getSource(input.sourceDraftDocumentId);
      const review = await options.reviews.get({ projectId: input.projectId, reviewId: input.reviewId });
      const { revision, changedRange } = validateChapterEditorDraft({ ...input, source, review });
      assertSource(source, input.projectId, input.chapterId);
      const output = await options.objects.put({ content: encoder.encode(input.editedText), mediaType: "text/plain; charset=utf-8" });
      const rawOutput = input.rawOutput ?? output;
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId: input.documentId,
          documentType: "chapter_editor_draft",
          status: "draft",
          expectedRevision: null,
          payload: {
            schema_version: 1,
            kind: "chapter_editor_draft",
            chapterId: input.chapterId,
            title: input.title,
            revision,
            parentDocumentId: source.documentId,
            parentRevision: source.revision,
            writerManifestId: source.manifestId,
            sourceModel: source.model,
            editorModel: input.model ?? source.model,
            reviewId: input.reviewId,
            selectedIssueIds: [...input.selectedIssueIds],
            rationale: input.rationale,
            changedRange,
            rawOutputObjectHash: rawOutput.sha256,
            executionRef: input.executionRef,
          },
          rawOutput,
          contentObject: output,
        },
      });
    },

    async getDraft(documentId) {
      assertId(documentId, "documentId");
      return readEditorDraft(options.driver, options.objects, documentId);
    },
  };
}

function expectedDocumentId(chapterId: string, revision: "v2" | "v3"): string {
  return `production:chapter_draft:${chapterId}:${revision}`;
}

function nextRevision(revision: "v1" | "v2" | "v3"): "v2" | "v3" {
  if (revision === "v1") return "v2";
  if (revision === "v2") return "v3";
  throw new Error("V3 已是最大编辑版本，不能自动生成 V4。 ");
}

function assertSource(source: ChapterReaderDraft | ChapterEditorDraft | null, projectId: string, chapterId: string): asserts source is ChapterReaderDraft | ChapterEditorDraft {
  if (!source || source.projectId !== projectId || source.chapterId !== chapterId || !source.documentId.trim() || !source.manifestId.trim() || !source.title.trim() || !source.text.trim() || !["v1", "v2"].includes(source.revision)) throw new Error("Editor 源草稿不存在、不属于当前章节或不是可编辑版本。 ");
}

function assertReview(review: ChapterReview | null, input: { chapterId: string; sourceDraftDocumentId: string; reviewId: string }, source: ChapterReaderDraft | ChapterEditorDraft): asserts review is ChapterReview {
  if (!review || review.reviewId !== input.reviewId || review.chapterId !== input.chapterId || review.draftDocumentId !== input.sourceDraftDocumentId || review.draftRevision !== source.revision) throw new Error("Editor 必须使用对应源草稿的已验证 Reviewer 报告。 ");
}

function selectIssues(issues: readonly ChapterReviewIssue[], ids: readonly string[]): ChapterReviewIssue[] {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id.trim())) throw new Error("Editor 必须明确选择至少一个 Reviewer 问题。 ");
  const selected = ids.map((id) => issues.find((issue) => issue.id === id));
  if (selected.some((issue) => !issue)) throw new Error("Editor 选择的问题不属于该 Reviewer 报告。 ");
  return selected as ChapterReviewIssue[];
}

function calculateChangedRange(source: string, edited: string): ChapterEditorChangedRange {
  const sourceChars = Array.from(source);
  const editedChars = Array.from(edited);
  let prefix = 0;
  while (prefix < sourceChars.length && prefix < editedChars.length && sourceChars[prefix] === editedChars[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < sourceChars.length - prefix && suffix < editedChars.length - prefix && sourceChars[sourceChars.length - suffix - 1] === editedChars[editedChars.length - suffix - 1]) suffix += 1;
  if (prefix === sourceChars.length && prefix === editedChars.length) throw new Error("Editor 输出未产生任何定向修改。 ");
  const sourceStartByte = encoder.encode(sourceChars.slice(0, prefix).join("")).length;
  const sourceEndByte = encoder.encode(sourceChars.slice(0, sourceChars.length - suffix).join("")).length;
  const replacementByteLength = encoder.encode(editedChars.slice(prefix, editedChars.length - suffix).join("")).length;
  return { sourceStartByte, sourceEndByte, replacementByteLength };
}

function assertTargetedRange(changed: ChapterEditorChangedRange, issues: readonly ChapterReviewIssue[], sourceText: string): void {
  const totalBytes = encoder.encode(sourceText).length;
  if (changed.sourceStartByte === 0 && changed.sourceEndByte === totalBytes) throw new Error("Editor 默认禁止整章重写。 ");
  const covered = issues.some((issue) => changed.sourceStartByte >= issue.startByte && changed.sourceEndByte <= issue.endByte);
  if (!covered) {
    const allowed = issues.map((issue) => `[${issue.startByte},${issue.endByte})`).join(", ");
    throw new Error(`Editor 改动必须完全落在选定 Reviewer 问题的精确范围内（changed=[${changed.sourceStartByte},${changed.sourceEndByte}), allowed=${allowed}）。`);
  }
}

async function readEditorDraft(driver: SqlDriver, objects: ObjectStore, documentId: string): Promise<ChapterEditorDraft | null> {
  const rows = await driver.query<{
    document_id: string; project_id: string; chapter_id: string | null; document_type: string; status: string; payload_json: string; content_object_hash: string | null;
  }>({
    sql: `
      SELECT doc.document_id, doc.project_id, doc.chapter_id, doc.document_type, doc.status, revision.payload_json, revision.content_object_hash
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      WHERE doc.document_id = ?
    `,
    params: [documentId],
  });
  const row = rows[0];
  if (!row || row.document_type !== "chapter_editor_draft" || row.status !== "draft" || !row.content_object_hash) return null;
  const payload = parseRecord(row.payload_json, "Editor 草稿 payload");
  const revision = payload.revision;
  const parentRevision = payload.parentRevision;
  const chapterId = requiredString(payload, "chapterId");
  if (payload.schema_version !== 1 || payload.kind !== "chapter_editor_draft" || (revision !== "v2" && revision !== "v3") || (parentRevision !== "v1" && parentRevision !== "v2")) throw new Error("Editor 草稿 payload 损坏。 ");
  const changedRange = recordValue(payload.changedRange);
  if (!changedRange || !Number.isInteger(changedRange.sourceStartByte) || !Number.isInteger(changedRange.sourceEndByte) || !Number.isInteger(changedRange.replacementByteLength)) throw new Error("Editor 草稿差异范围损坏。 ");
  return {
    documentId: row.document_id,
    projectId: row.project_id,
    chapterId,
    manifestId: requiredString(payload, "writerManifestId"),
    title: requiredString(payload, "title"),
    text: decoder.decode(await objects.read(row.content_object_hash)),
    model: typeof payload.editorModel === "string" && payload.editorModel.trim() ? payload.editorModel : requiredString(payload, "sourceModel"),
    executionRef: requiredString(payload, "executionRef"),
    revision,
    parentDocumentId: requiredString(payload, "parentDocumentId"),
    parentRevision,
    reviewId: requiredString(payload, "reviewId"),
    selectedIssueIds: stringList(payload.selectedIssueIds, "selectedIssueIds"),
    rationale: requiredString(payload, "rationale"),
    changedRange: { sourceStartByte: changedRange.sourceStartByte as number, sourceEndByte: changedRange.sourceEndByte as number, replacementByteLength: changedRange.replacementByteLength as number },
  };
}

async function assertProject(driver: SqlDriver, projectId: string): Promise<void> {
  const rows = await driver.query<{ project_id: string }>({ sql: "SELECT project_id FROM novel_projects WHERE project_id = ?", params: [projectId] });
  if (rows.length !== 1) throw new Error("原创 Project 不存在。 ");
}

function parseRecord(value: string, label: string): RecordValue {
  try {
    const parsed = recordValue(JSON.parse(value));
    if (!parsed) throw new Error();
    return parsed;
  } catch { throw new Error(`${label} 不是 JSON 对象。`); }
}

function recordValue(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function requiredString(record: RecordValue, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 必须是非空字符串。`);
  return value;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || new Set(value).size !== value.length) throw new Error(`${label} 必须是无重复的非空字符串数组。`);
  return value as string[];
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
