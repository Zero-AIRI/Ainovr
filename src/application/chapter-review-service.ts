import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ChapterReaderContextManifest, ChapterReaderDraft } from "@/application/chapter-reader-manifest-service";
import type { ChapterMechanismApplicationSnapshot, DecisionText } from "@/application/chapter-mechanism-application-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const READER_KINDS = ["immersive", "low_patience", "logic_sensitive"] as const;
const CATEGORIES = ["structure", "continuity", "expression", "originality"] as const;
const SEVERITIES = ["blocker", "major", "minor"] as const;
const EFFECT_STATUSES = ["observed", "partial", "not_observed", "counteracted", "unknown", "not_applicable"] as const;
const EFFECT_ACTIONS = ["accept_current", "request_revision", "return_mechanism"] as const;
type RecordValue = Record<string, unknown>;

export type ChapterReviewCategory = typeof CATEGORIES[number];
export type ChapterReviewSeverity = typeof SEVERITIES[number];
export type ChapterReviewEffectStatus = typeof EFFECT_STATUSES[number];
export type ChapterReviewEffectAction = typeof EFFECT_ACTIONS[number];

export interface ChapterReviewIssue {
  id: string;
  category: ChapterReviewCategory;
  severity: ChapterReviewSeverity;
  message: string;
  /** 规范化 UTF-8 正文对象的半开字节区间 [startByte, endByte)。 */
  startByte: number;
  endByte: number;
  quote: string;
}

/** Reviewer 对一个作者指定检查信号的可复核判断。所有正文锚点仍使用 UTF-8 半开区间。 */
export interface ChapterReviewEffectAssessment {
  signal: DecisionText;
  status: ChapterReviewEffectStatus;
  explanation: string;
  anchors: Array<{ startByte: number; endByte: number; quote: string }>;
  sideEffect?: string;
  suggestedAction: ChapterReviewEffectAction;
}

export interface ChapterReview {
  schema_version: 1;
  kind: "chapter_review";
  reviewId: string;
  projectId: string;
  chapterId: string;
  draftDocumentId: string;
  draftRevision: "v1" | "v2" | "v3";
  readerManifestIds: string[];
  /** 实际喂给 Reviewer 的三份已验证 Reader 反馈对象标识，供审计重放。 */
  readerFeedbackDocumentIds: string[];
  /** 零方法卡章节为 null；有采用记录时四项均精确冻结。 */
  applicationId?: string | null;
  applicationRevision?: number | null;
  writerManifestId?: string | null;
  writerManifestRevision?: number | null;
  issues: ChapterReviewIssue[];
  effectAssessments?: ChapterReviewEffectAssessment[];
  revision?: number;
}

export interface ChapterReviewService {
  submit(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    projectId: string;
    chapterId: string;
    draftDocumentId: string;
    reviewId: string;
    readerManifestIds: string[];
    readerFeedbackDocumentIds: string[];
    rawOutput: string;
  }): Promise<CommandResult>;
  get(input: { projectId: string; reviewId: string }): Promise<ChapterReview | null>;
}

/** 可由本机 Reviewer task 在提交前复用的纯输出契约。 */
export function validateChapterReviewOutput(rawOutput: string, expected: {
  projectId: string;
  chapterId: string;
  draftDocumentId: string;
  reviewId: string;
  readerManifestIds: string[];
  readerFeedbackDocumentIds: string[];
  draft: ChapterReaderDraft;
  application?: ChapterMechanismApplicationSnapshot | null;
  writerManifestRevision?: number | null;
}): ChapterReview {
  const review = parseReview(rawOutput);
  assertMatchesRequest(review, expected, expected.draft);
  return normaliseReviewRanges(review, expected.draft.text);
}

/**
 * 独立 Reviewer 的正式提交入口。它不接受“总体很好”之类不可执行判断：每个
 * 诊断必须精确落到此次生成正文的 UTF-8 字节区间，并逐字复核 quote。
 */
export function createChapterReviewService(options: {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">;
  readerManifests: Pick<{ get(input: { projectId: string; manifestId: string }): Promise<ChapterReaderContextManifest | null> }, "get">;
  applications?: Pick<{ get(input: { projectId: string; chapterId: string }): Promise<ChapterMechanismApplicationSnapshot | null> }, "get">;
}): ChapterReviewService {
  return {
    async submit(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertId(input.draftDocumentId, "draftDocumentId");
      assertId(input.reviewId, "reviewId");
      await assertProject(options.driver, input.projectId);
      const draft = await options.drafts.getDraft(input.draftDocumentId);
      assertDraft(draft, input.projectId, input.chapterId);
      await assertIndependentReaders(options.readerManifests, input.projectId, input.chapterId, draft, input.readerManifestIds);
      assertFeedbackDocuments(input.readerFeedbackDocumentIds);
      const application = await options.applications?.get({ projectId: input.projectId, chapterId: input.chapterId }) ?? null;
      const writerManifestRevision = application ? await currentManifestRevision(options.driver, input.projectId, input.chapterId, draft.manifestId) : null;
      const review = validateChapterReviewOutput(input.rawOutput, { ...input, draft, application, writerManifestRevision });

      const rawObject = await options.objects.put({ content: encoder.encode(input.rawOutput), mediaType: "application/vnd.ainovr.chapter-review+json" });
      // 正式 Review 使用规范化后的精确区间；模型原始输出作为独立对象保留供审计。
      const canonicalObject = await options.objects.put({ content: encoder.encode(JSON.stringify(review)), mediaType: "application/vnd.ainovr.chapter-review+json" });
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId: reviewDocumentId(input.reviewId),
          documentType: "chapter_review",
          status: "reviewed",
          expectedRevision: null,
          payload: {
            schema_version: 1,
            kind: "chapter_review",
            reviewId: review.reviewId,
            chapterId: review.chapterId,
            draftDocumentId: review.draftDocumentId,
            draftRevision: review.draftRevision,
            readerManifestIds: review.readerManifestIds,
            readerFeedbackDocumentIds: review.readerFeedbackDocumentIds,
            applicationId: review.applicationId ?? null,
            applicationRevision: review.applicationRevision ?? null,
            writerManifestId: review.writerManifestId ?? null,
            writerManifestRevision: review.writerManifestRevision ?? null,
            issueCount: review.issues.length,
            effectAssessmentCount: review.effectAssessments?.length ?? 0,
            rawOutputObjectHash: rawObject.sha256,
            canonicalReviewObjectHash: canonicalObject.sha256,
          },
          rawOutput: rawObject,
          contentObject: canonicalObject,
        },
      });
    },

    async get(input) {
      assertId(input.projectId, "projectId");
      assertId(input.reviewId, "reviewId");
      const document = await optionalDocument(options.driver, input.projectId, reviewDocumentId(input.reviewId));
      if (!document) return null;
      if (document.stale) return null;
      if (document.documentType !== "chapter_review" || document.status !== "reviewed" || !document.contentObjectHash) throw new Error("章节 Reviewer 文档损坏。 ");
      const review = parseReview(decoder.decode(await options.objects.read(document.contentObjectHash)));
      if (review.projectId !== input.projectId || review.reviewId !== input.reviewId) throw new Error("章节 Reviewer 文档与请求不匹配。 ");
      return { ...review, revision: document.revision };
    },
  };
}

function reviewDocumentId(reviewId: string): string {
  return `production:chapter_review:${reviewId}`;
}

async function assertProject(driver: SqlDriver, projectId: string): Promise<void> {
  const rows = await driver.query<{ project_id: string }>({ sql: "SELECT project_id FROM novel_projects WHERE project_id = ?", params: [projectId] });
  if (rows.length !== 1) throw new Error("原创 Project 不存在。 ");
}

async function assertIndependentReaders(
  manifests: Pick<{ get(input: { projectId: string; manifestId: string }): Promise<ChapterReaderContextManifest | null> }, "get">,
  projectId: string,
  chapterId: string,
  draft: ChapterReaderDraft,
  manifestIds: readonly string[],
): Promise<void> {
  if (!Array.isArray(manifestIds) || manifestIds.length !== READER_KINDS.length || new Set(manifestIds).size !== READER_KINDS.length || manifestIds.some((id) => typeof id !== "string" || !id.trim())) throw new Error("Reviewer 必须引用三个独立 Reader Manifest。 ");
  const resolved = await Promise.all(manifestIds.map((manifestId) => manifests.get({ projectId, manifestId })));
  const kinds = new Set<string>();
  for (const manifest of resolved) {
    if (!manifest || manifest.projectId !== projectId || manifest.chapterId !== chapterId || manifest.draft.documentId !== draft.documentId || manifest.draft.revision !== draft.revision || manifest.draft.text !== draft.text || !Array.isArray(manifest.conversationHistory) || manifest.conversationHistory.length !== 0) throw new Error("Reviewer 引用的 Reader Manifest 不属于当前正文。 ");
    kinds.add(manifest.readerKind);
  }
  if (READER_KINDS.some((kind) => !kinds.has(kind))) throw new Error("Reviewer 必须引用沉浸型、低耐心与逻辑敏感三个独立 Reader。 ");
}

function parseReview(rawOutput: string): ChapterReview {
  let parsed: unknown;
  try { parsed = JSON.parse(rawOutput); } catch { throw new Error("Reviewer 输出必须是 JSON 对象。 "); }
  const value = recordValue(parsed);
  if (!value) throw new Error("Reviewer 输出必须是 JSON 对象。 ");
  const allowed = new Set(["schema_version", "kind", "reviewId", "projectId", "chapterId", "draftDocumentId", "draftRevision", "readerManifestIds", "readerFeedbackDocumentIds", "applicationId", "applicationRevision", "writerManifestId", "writerManifestRevision", "issues", "effectAssessments"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Reviewer 输出不得包含赞美、评分或未定义字段。 ");
  if (value.schema_version !== 1 || value.kind !== "chapter_review") throw new Error("Reviewer 输出 schema 无效。 ");
  const reviewId = requiredString(value, "reviewId");
  const projectId = requiredString(value, "projectId");
  const chapterId = requiredString(value, "chapterId");
  const draftDocumentId = requiredString(value, "draftDocumentId");
  const draftRevision = value.draftRevision;
  if (draftRevision !== "v1" && draftRevision !== "v2" && draftRevision !== "v3") throw new Error("Reviewer draftRevision 非法。 ");
  const readerManifestIds = stringList(value.readerManifestIds, "readerManifestIds");
  const readerFeedbackDocumentIds = stringList(value.readerFeedbackDocumentIds, "readerFeedbackDocumentIds");
  const issues = issueList(value.issues);
  const applicationId = nullableString(value.applicationId, "applicationId");
  const applicationRevision = nullableRevision(value.applicationRevision, "applicationRevision");
  const writerManifestId = nullableString(value.writerManifestId, "writerManifestId");
  const writerManifestRevision = nullableRevision(value.writerManifestRevision, "writerManifestRevision");
  const hasMethodLineage = applicationId !== null || applicationRevision !== null || writerManifestId !== null || writerManifestRevision !== null;
  if (hasMethodLineage && (!applicationId || !applicationRevision || !writerManifestId || !writerManifestRevision)) throw new Error("Reviewer 方法应用 lineage 必须完整。 ");
  return { schema_version: 1, kind: "chapter_review", reviewId, projectId, chapterId, draftDocumentId, draftRevision, readerManifestIds, readerFeedbackDocumentIds, applicationId, applicationRevision, writerManifestId, writerManifestRevision, issues, effectAssessments: effectAssessments(value.effectAssessments) };
}

function assertMatchesRequest(review: ChapterReview, input: { projectId: string; chapterId: string; draftDocumentId: string; reviewId: string; readerManifestIds: string[]; readerFeedbackDocumentIds: string[]; application?: ChapterMechanismApplicationSnapshot | null; writerManifestRevision?: number | null }, draft: ChapterReaderDraft): void {
  if (review.projectId !== input.projectId || review.chapterId !== input.chapterId || review.draftDocumentId !== input.draftDocumentId || review.reviewId !== input.reviewId || review.draftRevision !== draft.revision || !sameSet(review.readerManifestIds, input.readerManifestIds) || !sameSet(review.readerFeedbackDocumentIds, input.readerFeedbackDocumentIds)) throw new Error("Reviewer 输出与冻结的章节、草稿、Reader Manifest 或 Reader 反馈不匹配。 ");
  const application = input.application ?? null;
  if (!application) {
    if (review.applicationId !== null || review.applicationRevision !== null || review.writerManifestId !== null || review.writerManifestRevision !== null || (review.effectAssessments?.length ?? 0) !== 0) throw new Error("零方法卡章节 Reviewer 不得伪造方法应用判断。 ");
    return;
  }
  if (review.applicationId !== application.applicationId || review.applicationRevision !== application.revision || review.writerManifestId !== draft.manifestId || review.writerManifestRevision !== input.writerManifestRevision) throw new Error("Reviewer 输出未绑定当前本章采用记录或 Writer Manifest。 ");
  assertEffectSignals(review.effectAssessments ?? [], application.fields.reviewSignals);
}

function issueList(value: unknown): ChapterReviewIssue[] {
  if (!Array.isArray(value)) throw new Error("issues 必须是数组。 ");
  const issues = value.map((item, index) => {
    const issue = recordValue(item);
    if (!issue) throw new Error(`issues[${index}] 必须是对象。`);
    const allowed = new Set(["id", "category", "severity", "message", "startByte", "endByte", "quote"]);
    if (Object.keys(issue).some((key) => !allowed.has(key))) throw new Error("Reviewer 问题包含未定义字段。 ");
    const category = issue.category;
    const severity = issue.severity;
    if (!(CATEGORIES as readonly string[]).includes(category as string) || !(SEVERITIES as readonly string[]).includes(severity as string)) throw new Error("Reviewer 问题类别或严重度非法。 ");
    const startByte = issue.startByte;
    const endByte = issue.endByte;
    if (!Number.isInteger(startByte) || !Number.isInteger(endByte)) throw new Error("Reviewer 问题必须提供整数 UTF-8 区间。 ");
    return { id: requiredString(issue, "id"), category: category as ChapterReviewCategory, severity: severity as ChapterReviewSeverity, message: requiredString(issue, "message"), startByte: startByte as number, endByte: endByte as number, quote: requiredString(issue, "quote") };
  });
  if (new Set(issues.map((issue) => issue.id)).size !== issues.length) throw new Error("Reviewer 问题 id 不可重复。 ");
  return issues;
}

function effectAssessments(value: unknown): ChapterReviewEffectAssessment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("effectAssessments 必须是数组。 ");
  return value.map((item, index) => {
    const assessment = recordValue(item);
    if (!assessment) throw new Error(`effectAssessments[${index}] 必须是对象。`);
    const allowed = new Set(["signal", "status", "explanation", "anchors", "sideEffect", "suggestedAction"]);
    if (Object.keys(assessment).some((key) => !allowed.has(key))) throw new Error("Reviewer 目标效果判断包含未定义字段。 ");
    const status = assessment.status;
    const suggestedAction = assessment.suggestedAction;
    if (!(EFFECT_STATUSES as readonly string[]).includes(status as string) || !(EFFECT_ACTIONS as readonly string[]).includes(suggestedAction as string)) throw new Error("Reviewer 目标效果状态或建议动作非法。 ");
    const anchorsValue = assessment.anchors;
    if (!Array.isArray(anchorsValue)) throw new Error("Reviewer 目标效果判断必须提供 anchors 数组。 ");
    const anchors = anchorsValue.map((anchor, anchorIndex) => {
      const item = recordValue(anchor);
      if (!item || Object.keys(item).some((key) => !["startByte", "endByte", "quote"].includes(key)) || !Number.isInteger(item.startByte) || !Number.isInteger(item.endByte)) throw new Error(`effectAssessments[${index}].anchors[${anchorIndex}] 非法。`);
      return { startByte: item.startByte as number, endByte: item.endByte as number, quote: requiredString(item, "quote") };
    });
    const sideEffect = assessment.sideEffect === undefined ? undefined : requiredString(assessment, "sideEffect");
    return { signal: decisionText(assessment.signal, `effectAssessments[${index}].signal`), status: status as ChapterReviewEffectStatus, explanation: requiredString(assessment, "explanation"), anchors, ...(sideEffect ? { sideEffect } : {}), suggestedAction: suggestedAction as ChapterReviewEffectAction };
  });
}

function assertEffectSignals(assessments: readonly ChapterReviewEffectAssessment[], signals: readonly DecisionText[]): void {
  if (assessments.length !== signals.length) throw new Error("Reviewer 必须逐项判断本章采用记录的全部检查信号。 ");
  const expected = signals.map(decisionKey);
  const actual = assessments.map((assessment) => decisionKey(assessment.signal));
  if (new Set(actual).size !== actual.length || actual.some((signal) => !expected.includes(signal))) throw new Error("Reviewer 目标效果判断的信号集合与本章采用记录不匹配。 ");
}

function decisionText(value: unknown, label: string): DecisionText {
  const decision = recordValue(value);
  if (!decision || (decision.status !== "specified" && decision.status !== "unknown" && decision.status !== "not_applicable")) throw new Error(`${label} 非法。`);
  if (decision.status === "specified") {
    if (Object.keys(decision).length !== 2) throw new Error(`${label} 不得包含额外字段。`);
    return { status: "specified", value: requiredString(decision, "value") };
  }
  if (Object.keys(decision).length !== 1) throw new Error(`${label} 不得包含额外字段。`);
  return { status: decision.status };
}

function decisionKey(value: DecisionText): string {
  return value.status === "specified" ? `specified:${value.value}` : value.status;
}

function normaliseReviewRanges(review: ChapterReview, text: string): ChapterReview {
  return { ...review, issues: review.issues.map((issue) => normaliseReviewIssueRange(issue, text)), effectAssessments: (review.effectAssessments ?? []).map((assessment) => ({ ...assessment, anchors: assessment.anchors.map((anchor) => normaliseAnchor(anchor, text)) })) };
}

function normaliseAnchor(anchor: { startByte: number; endByte: number; quote: string }, text: string): { startByte: number; endByte: number; quote: string } {
  const result = normaliseReviewIssueRange({ id: "effect_anchor", category: "structure", severity: "minor", message: "effect anchor", ...anchor }, text);
  return { startByte: result.startByte, endByte: result.endByte, quote: result.quote };
}

/**
 * 小模型常把字符位置或 UTF-16 位置误当作 UTF-8 字节位置。仅当 quote 在本次
 * 正文唯一出现时，才允许确定性重算；重复或不存在的 quote 一律 fail closed。
 */
function normaliseReviewIssueRange(issue: ChapterReviewIssue, text: string): ChapterReviewIssue {
  const bytes = encoder.encode(text);
  const boundaries = utf8Boundaries(text);
  const aligned = issue.startByte >= 0 && issue.endByte > issue.startByte && issue.endByte <= bytes.length && boundaries.has(issue.startByte) && boundaries.has(issue.endByte);
  if (aligned && decoder.decode(bytes.slice(issue.startByte, issue.endByte)) === issue.quote) return issue;
  const first = text.indexOf(issue.quote);
  if (first < 0 || text.indexOf(issue.quote, first + issue.quote.length) >= 0) throw new Error("Reviewer 问题的 UTF-8 区间越界、未对齐或引文无法唯一定位。 ");
  const startByte = encoder.encode(text.slice(0, first)).length;
  const endByte = startByte + encoder.encode(issue.quote).length;
  return { ...issue, startByte, endByte };
}

function utf8Boundaries(text: string): Set<number> {
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const character of text) { offset += encoder.encode(character).length; boundaries.add(offset); }
  return boundaries;
}

async function optionalDocument(driver: SqlDriver, projectId: string, documentId: string): Promise<{ documentType: string; status: string; contentObjectHash: string | null; revision: number; stale: boolean } | null> {
  const rows = await driver.query<{ document_type: string; status: string; content_object_hash: string | null; current_revision: number; stale: number }>({
    sql: `
      SELECT doc.document_type, doc.status, revision.content_object_hash, artifact.current_revision,
             CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      WHERE doc.project_id = ? AND doc.document_id = ?
    `,
    params: [projectId, documentId],
  });
  return rows[0] ? { documentType: rows[0].document_type, status: rows[0].status, contentObjectHash: rows[0].content_object_hash, revision: rows[0].current_revision, stale: rows[0].stale === 1 } : null;
}

async function currentManifestRevision(driver: SqlDriver, projectId: string, chapterId: string, manifestId: string): Promise<number> {
  const rows = await driver.query<{ current_revision: number; stale: number; document_type: string; status: string; payload_json: string }>({
    sql: `SELECT artifact.current_revision, doc.document_type, doc.status, revision.payload_json,
                 CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
          FROM project_documents doc INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          WHERE doc.project_id = ? AND doc.document_id = ?`,
    params: [projectId, `production:context_manifest:${manifestId}`],
  });
  const row = rows[0];
  if (!row || row.document_type !== "context_manifest" || row.status !== "frozen" || row.stale === 1) throw new Error("Reviewer 必须绑定当前且已冻结的 Writer ContextManifest。 ");
  const payload = recordValue(JSON.parse(row.payload_json));
  if (!payload || payload.kind !== "context_manifest" || payload.manifestId !== manifestId || payload.chapterId !== chapterId || payload.taskRole !== "writer") throw new Error("Writer ContextManifest 与章节不匹配。 ");
  return row.current_revision;
}

function assertDraft(draft: ChapterReaderDraft | null, projectId: string, chapterId: string): asserts draft is ChapterReaderDraft {
  if (!draft || draft.projectId !== projectId || draft.chapterId !== chapterId || !draft.documentId.trim() || !draft.text.trim() || !["v1", "v2", "v3"].includes(draft.revision)) throw new Error("待评 Writer 草稿不存在或不属于当前章节。 ");
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || new Set(value).size !== value.length) throw new Error(`${label} 必须是无重复的非空字符串数组。`);
  return [...value] as string[];
}

function assertFeedbackDocuments(value: readonly string[]): void {
  if (!Array.isArray(value) || value.length !== READER_KINDS.length || new Set(value).size !== READER_KINDS.length || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error("Reviewer 必须引用三个已验证 Reader 反馈文档。 ");
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function requiredString(value: RecordValue, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || !item.trim()) throw new Error(`${key} 必须是非空字符串。`);
  return item;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串或 null。`);
  return value;
}

function nullableRevision(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${label} 必须是正整数或 null。`);
  return value as number;
}

function recordValue(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
