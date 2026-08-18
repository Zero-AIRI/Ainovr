import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ChapterMechanismApplicationSnapshot, DecisionText } from "@/application/chapter-mechanism-application-service";
import type { ChapterReview, ChapterReviewEffectAssessment } from "@/application/chapter-review-service";
import type { SqlDriver } from "@/persistence/sql-driver";

type RecordValue = Record<string, unknown>;
const DISPOSITIONS = ["accept_current", "accept_with_gap", "request_revision", "hold"] as const;

export type ChapterMechanismDisposition = typeof DISPOSITIONS[number];

export interface ChapterMechanismOutcomeDecision {
  signal: DecisionText;
  agreement: "agree" | "disagree";
  disagreementReason?: string;
}

/** 人类不可变地记录一次章节方法应用处置；它不改变全局 MechanismAsset 生命周期。 */
export interface ChapterMechanismOutcome {
  schema_version: 1;
  kind: "chapter_mechanism_outcome";
  outcomeId: string;
  chapterId: string;
  applicationId: string;
  applicationRevision: number;
  reviewId: string;
  reviewRevision: number;
  decisions: ChapterMechanismOutcomeDecision[];
  disposition: ChapterMechanismDisposition;
  riskAcceptanceReason?: string;
  observedSideEffects: string[];
}

export interface ChapterMechanismOutcomeSnapshot extends ChapterMechanismOutcome { revision: number; }

export interface ChapterMechanismOutcomeService {
  save(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; expectedRevision: number | null; outcome: ChapterMechanismOutcome }): Promise<CommandResult>;
  get(input: { projectId: string; chapterId: string }): Promise<ChapterMechanismOutcomeSnapshot | null>;
}

export function createChapterMechanismOutcomeService(options: {
  driver: SqlDriver;
  commands: CommandService;
  applications: Pick<{ get(input: { projectId: string; chapterId: string }): Promise<ChapterMechanismApplicationSnapshot | null> }, "get">;
  reviews: Pick<{ get(input: { projectId: string; reviewId: string }): Promise<ChapterReview | null> }, "get">;
}): ChapterMechanismOutcomeService {
  return {
    async save(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertExpectedRevision(input.expectedRevision);
      const outcome = parseOutcome(input.outcome, input.chapterId);
      const application = await options.applications.get({ projectId: input.projectId, chapterId: input.chapterId });
      if (!application || outcome.applicationId !== application.applicationId || outcome.applicationRevision !== application.revision) throw new Error("本章应用结果必须绑定当前且未过期的本章采用记录。 ");
      const review = await options.reviews.get({ projectId: input.projectId, reviewId: outcome.reviewId });
      if (!review || review.chapterId !== input.chapterId || review.revision !== outcome.reviewRevision || review.applicationId !== application.applicationId || review.applicationRevision !== application.revision) throw new Error("本章应用结果必须绑定当前且未过期的 Reviewer 反馈。 ");
      assertDecisions(outcome.decisions, application.fields.reviewSignals, review.effectAssessments ?? []);
      const documentId = outcomeDocumentId(input.chapterId);
      const current = await currentDocument(options.driver, input.projectId, documentId);
      if (current && current.revision !== input.expectedRevision) return { kind: "conflict", currentRevision: current.revision, diagnostics: [{ code: "revision_conflict", message: "本章应用结果已更新，请重新读取后再保存。", resourceId: documentId }] };
      if (!current && input.expectedRevision !== null) return { kind: "blocked", diagnostics: [{ code: "revision_conflict", message: "本章应用结果尚不存在，不能用旧 revision 覆盖。", resourceId: documentId }] };
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        ...(input.expectedRevision === null ? {} : { expectedRevision: input.expectedRevision }),
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId, documentId, documentType: "chapter_mechanism_outcome", status: "approved", expectedRevision: input.expectedRevision, payload: outcome,
          dependencies: [
            { artifactId: `document:${application.applicationId}`, revision: application.revision },
            { artifactId: `document:production:chapter_review:${outcome.reviewId}`, revision: outcome.reviewRevision },
          ],
        },
      });
    },
    async get(input) {
      assertId(input.projectId, "projectId"); assertId(input.chapterId, "chapterId");
      const document = await currentDocument(options.driver, input.projectId, outcomeDocumentId(input.chapterId));
      return !document || document.stale || document.documentType !== "chapter_mechanism_outcome" ? null : { ...parseOutcome(document.payload, input.chapterId), revision: document.revision };
    },
  };
}

export function chapterMechanismOutcomeDocumentId(chapterId: string): string { assertId(chapterId, "chapterId"); return outcomeDocumentId(chapterId); }

function outcomeDocumentId(chapterId: string): string { return `production:chapter_mechanism_outcome:${chapterId}`; }

function parseOutcome(value: unknown, chapterId: string): ChapterMechanismOutcome {
  const payload = record(value, "本章应用结果");
  if (payload.schema_version !== 1 || payload.kind !== "chapter_mechanism_outcome" || nonEmpty(payload.chapterId, "chapterId") !== chapterId) throw new Error("本章应用结果 schema 非法。 ");
  const disposition = payload.disposition;
  if (!(DISPOSITIONS as readonly string[]).includes(disposition as string)) throw new Error("本章应用结果处置非法。 ");
  const riskAcceptanceReason = payload.riskAcceptanceReason === undefined ? undefined : nonEmpty(payload.riskAcceptanceReason, "riskAcceptanceReason");
  if (disposition === "accept_with_gap" && !riskAcceptanceReason) throw new Error("带风险接受必须填写理由。 ");
  if (disposition !== "accept_with_gap" && riskAcceptanceReason) throw new Error("仅带风险接受可以填写风险理由。 ");
  const effects = payload.observedSideEffects;
  if (!Array.isArray(effects) || effects.some((effect) => typeof effect !== "string" || !effect.trim()) || new Set(effects).size !== effects.length) throw new Error("observedSideEffects 必须是无重复的非空字符串数组。 ");
  const decisionsValue = payload.decisions;
  if (!Array.isArray(decisionsValue)) throw new Error("decisions 必须是数组。 ");
  const decisions = decisionsValue.map((value, index) => {
    const decision = record(value, `decisions[${index}]`); const agreement = decision.agreement;
    if (agreement !== "agree" && agreement !== "disagree") throw new Error("人类判断必须选择同意或不同意。 ");
    const disagreementReason = decision.disagreementReason === undefined ? undefined : nonEmpty(decision.disagreementReason, "disagreementReason");
    if (agreement === "disagree" && !disagreementReason) throw new Error("不同意 Reviewer 判断必须填写理由。 ");
    if (agreement === "agree" && disagreementReason) throw new Error("同意 Reviewer 判断不得填写不同意理由。 ");
    return { signal: decisionText(decision.signal, `decisions[${index}].signal`), agreement: agreement as "agree" | "disagree", ...(disagreementReason ? { disagreementReason } : {}) };
  });
  return { schema_version: 1, kind: "chapter_mechanism_outcome", outcomeId: nonEmpty(payload.outcomeId, "outcomeId"), chapterId, applicationId: nonEmpty(payload.applicationId, "applicationId"), applicationRevision: positive(payload.applicationRevision, "applicationRevision"), reviewId: nonEmpty(payload.reviewId, "reviewId"), reviewRevision: positive(payload.reviewRevision, "reviewRevision"), decisions, disposition: disposition as ChapterMechanismDisposition, ...(riskAcceptanceReason ? { riskAcceptanceReason } : {}), observedSideEffects: [...effects] };
}

function assertDecisions(decisions: readonly ChapterMechanismOutcomeDecision[], signals: readonly DecisionText[], assessments: readonly ChapterReviewEffectAssessment[]): void {
  const expected = signals.map(decisionKey);
  if (assessments.length !== expected.length || decisions.length !== expected.length) throw new Error("本章应用结果必须逐项保留 Reviewer 判断与人类处置。 ");
  const decisionKeys = decisions.map((item) => decisionKey(item.signal));
  const assessmentKeys = assessments.map((item) => decisionKey(item.signal));
  if (new Set(decisionKeys).size !== decisionKeys.length || decisionKeys.some((item) => !expected.includes(item)) || assessmentKeys.some((item) => !expected.includes(item))) throw new Error("本章应用结果的信号集合与 Reviewer 或采用记录不匹配。 ");
}

async function currentDocument(driver: SqlDriver, projectId: string, documentId: string): Promise<{ documentType: string; revision: number; stale: boolean; payload: RecordValue } | null> {
  const rows = await driver.query<{ document_type: string; current_revision: number; payload_json: string; stale: number }>({ sql: `SELECT doc.document_type, artifact.current_revision, revision.payload_json, CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale FROM project_documents doc INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision WHERE doc.project_id = ? AND doc.document_id = ?`, params: [projectId, documentId] });
  return rows[0] ? { documentType: rows[0].document_type, revision: rows[0].current_revision, stale: rows[0].stale === 1, payload: record(JSON.parse(rows[0].payload_json), "项目文档 payload") } : null;
}

function decisionText(value: unknown, label: string): DecisionText { const item = record(value, label); if (item.status === "specified") return { status: "specified", value: nonEmpty(item.value, label) }; if (item.status === "unknown" || item.status === "not_applicable") return { status: item.status }; throw new Error(`${label} 非法。`); }
function decisionKey(value: DecisionText): string { return value.status === "specified" ? `specified:${value.value}` : value.status; }
function record(value: unknown, label: string): RecordValue { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`); return value as RecordValue; }
function positive(value: unknown, label: string): number { if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${label} 必须是正整数。`); return value as number; }
function nonEmpty(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`); return value.trim(); }
function assertExpectedRevision(value: number | null): void { if (value !== null && (!Number.isInteger(value) || value < 1)) throw new Error("expectedRevision 必须是 null 或正整数。 "); }
function assertId(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`); }
