import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { AdoptedMechanismSnapshot } from "@/application/mechanism-asset-service";
import { planningDocumentId } from "@/application/planning-document-id";
import type { SqlDriver } from "@/persistence/sql-driver";

type RecordValue = Record<string, unknown>;
const DECISION_STATUSES = ["specified", "unknown", "not_applicable"] as const;

export type DecisionText =
  | { status: "specified"; value: string }
  | { status: "unknown" }
  | { status: "not_applicable" };

export interface ChapterMechanismApplication {
  schema_version: 1;
  kind: "chapter_mechanism_application";
  applicationId: string;
  chapterId: string;
  chapterContractRevision: number;
  mechanismAssetId: string;
  mechanismRevision: number;
  fields: {
    reason: DecisionText;
    plannedUse: DecisionText;
    observableReaderEffect: DecisionText;
    misuseToAvoid: DecisionText;
    reviewSignals: DecisionText[];
  };
}

export interface ChapterMechanismApplicationSnapshot extends ChapterMechanismApplication {
  revision: number;
}

export interface ChapterMechanismApplicationService {
  save(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    projectId: string;
    chapterId: string;
    expectedRevision: number | null;
    application: ChapterMechanismApplication;
  }): Promise<CommandResult>;
  get(input: { projectId: string; chapterId: string }): Promise<ChapterMechanismApplicationSnapshot | null>;
}

/**
 * 本章采用记录是 Writer 方法选择的唯一真相。它只保存去来源化的作者决定，
 * 并精确依赖当前 ChapterContract 与已采纳的 Writer 方法卡 revision。
 */
export function createChapterMechanismApplicationService(options: {
  driver: SqlDriver;
  commands: CommandService;
  mechanisms: Pick<{ listAdoptedSnapshots(projectId: string): Promise<AdoptedMechanismSnapshot[]> }, "listAdoptedSnapshots">;
}): ChapterMechanismApplicationService {
  return {
    async save(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertExpectedRevision(input.expectedRevision);
      const application = parseApplication(input.application, input.chapterId);
      const documentId = applicationDocumentId(input.chapterId);
      const current = await currentDocument(options.driver, input.projectId, documentId);
      if (current && current.revision !== input.expectedRevision) {
        return { kind: "conflict", currentRevision: current.revision, diagnostics: [{ code: "revision_conflict", message: "本章采用记录已更新，请重新读取后再保存。", resourceId: documentId }] };
      }
      if (!current && input.expectedRevision !== null) {
        return { kind: "blocked", diagnostics: [{ code: "revision_conflict", message: "本章采用记录尚不存在，不能用旧 revision 覆盖。", resourceId: documentId }] };
      }

      const contract = await currentDocument(options.driver, input.projectId, planningDocumentId(input.projectId, "chapter_contract", input.chapterId));
      if (!contract || contract.documentType !== "chapter_contract" || contract.stale) throw new Error("当前章节尚未保存有效 ChapterContract。 ");
      if (application.chapterContractRevision !== contract.revision) throw new Error("本章采用记录必须绑定当前 ChapterContract revision。 ");

      const adopted = await options.mechanisms.listAdoptedSnapshots(input.projectId);
      const mechanism = adopted.find((snapshot) => snapshot.card.id === application.mechanismAssetId);
      if (!mechanism || !mechanism.card.targetLayers.includes("draft")) throw new Error("本章采用记录只能使用当前项目已采纳且可供 Writer 使用的方法卡。 ");
      if (mechanism.revision !== application.mechanismRevision) throw new Error("本章采用记录的方法卡 revision 已过期，必须重新选择当前版本。 ");

      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        ...(input.expectedRevision === null ? {} : { expectedRevision: input.expectedRevision }),
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId,
          documentType: "chapter_mechanism_application",
          status: "approved",
          expectedRevision: input.expectedRevision,
          payload: application,
          dependencies: [
            { artifactId: contract.artifactId, revision: contract.revision },
            { artifactId: `mechanism:${application.mechanismAssetId}`, revision: application.mechanismRevision },
          ],
        },
      });
    },

    async get(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      const document = await currentDocument(options.driver, input.projectId, applicationDocumentId(input.chapterId));
      if (!document || document.stale || document.documentType !== "chapter_mechanism_application") return null;
      return { ...parseApplication(document.payload, input.chapterId), revision: document.revision };
    },
  };
}

export function chapterMechanismApplicationDocumentId(chapterId: string): string {
  assertId(chapterId, "chapterId");
  return applicationDocumentId(chapterId);
}

function applicationDocumentId(chapterId: string): string {
  return `production:chapter_mechanism_application:${chapterId}`;
}

function parseApplication(value: unknown, chapterId: string): ChapterMechanismApplication {
  const payload = record(value, "本章采用记录");
  if (payload.schema_version !== 1 || payload.kind !== "chapter_mechanism_application") throw new Error("本章采用记录 schema 非法。 ");
  const applicationId = nonEmpty(payload.applicationId, "applicationId");
  if (applicationId !== applicationDocumentId(chapterId)) throw new Error("本章采用记录 applicationId 必须与章节唯一对应。 ");
  if (nonEmpty(payload.chapterId, "chapterId") !== chapterId) throw new Error("本章采用记录 chapterId 不匹配。 ");
  const chapterContractRevision = revision(payload.chapterContractRevision, "chapterContractRevision");
  const mechanismAssetId = nonEmpty(payload.mechanismAssetId, "mechanismAssetId");
  const mechanismRevision = revision(payload.mechanismRevision, "mechanismRevision");
  const fields = record(payload.fields, "fields");
  const reviewSignalsValue = fields.reviewSignals;
  if (!Array.isArray(reviewSignalsValue) || reviewSignalsValue.length === 0) throw new Error("reviewSignals 必须至少包含一项明确决定。 ");
  const reviewSignals = reviewSignalsValue.map((signal, index) => decisionText(signal, `reviewSignals[${index}]`));
  const specifiedSignals = reviewSignals.filter((signal): signal is Extract<DecisionText, { status: "specified" }> => signal.status === "specified");
  if (new Set(specifiedSignals.map((signal) => signal.value)).size !== specifiedSignals.length) throw new Error("reviewSignals 不能包含重复的明确检查信号。 ");
  return {
    schema_version: 1,
    kind: "chapter_mechanism_application",
    applicationId,
    chapterId,
    chapterContractRevision,
    mechanismAssetId,
    mechanismRevision,
    fields: {
      reason: decisionText(fields.reason, "reason"),
      plannedUse: decisionText(fields.plannedUse, "plannedUse"),
      observableReaderEffect: decisionText(fields.observableReaderEffect, "observableReaderEffect"),
      misuseToAvoid: decisionText(fields.misuseToAvoid, "misuseToAvoid"),
      reviewSignals,
    },
  };
}

function decisionText(value: unknown, label: string): DecisionText {
  const decision = record(value, label);
  if (typeof decision.status !== "string" || !DECISION_STATUSES.includes(decision.status as typeof DECISION_STATUSES[number])) throw new Error(`${label}.status 非法。`);
  if (decision.status === "specified") {
    if (Object.keys(decision).length !== 2) throw new Error(`${label} 只能包含 status 与 value。`);
    return { status: "specified", value: nonEmpty(decision.value, label) };
  }
  if (Object.keys(decision).length !== 1) throw new Error(`${label} 的 ${decision.status} 状态不能携带 value。`);
  return { status: decision.status as "unknown" | "not_applicable" };
}

async function currentDocument(driver: SqlDriver, projectId: string, documentId: string): Promise<{ artifactId: string; documentType: string; revision: number; stale: boolean; payload: RecordValue } | null> {
  const rows = await driver.query<{ artifact_id: string; document_type: string; current_revision: number; payload_json: string; stale: number }>({
    sql: `SELECT artifact.artifact_id, doc.document_type, artifact.current_revision, revision.payload_json,
                 CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
          FROM project_documents doc
          INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          WHERE doc.project_id = ? AND doc.document_id = ?`,
    params: [projectId, documentId],
  });
  const row = rows[0];
  if (!row) return null;
  return { artifactId: row.artifact_id, documentType: row.document_type, revision: row.current_revision, stale: row.stale === 1, payload: parsePayload(row.payload_json) };
}

function parsePayload(value: string): RecordValue {
  try { return record(JSON.parse(value), "项目文档 payload"); } catch { throw new Error("项目文档 payload 不是 JSON 对象。 "); }
}

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
  return value as RecordValue;
}

function revision(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${label} 必须是正整数。`);
  return value as number;
}

function assertExpectedRevision(value: number | null): void {
  if (value !== null && (!Number.isInteger(value) || value < 1)) throw new Error("expectedRevision 必须是 null 或正整数。 ");
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value.trim();
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
