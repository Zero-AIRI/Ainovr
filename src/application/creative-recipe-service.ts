import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { TransferMechanismCard } from "@/lib/analysis/transfer-card";
import type { AdoptedMechanismSnapshot } from "@/application/mechanism-asset-service";
import type { ChapterMechanismApplicationSnapshot } from "@/application/chapter-mechanism-application-service";
import type { SqlDriver } from "@/persistence/sql-driver";
import { planningDocumentId } from "@/application/planning-document-id";

type RecordValue = Record<string, unknown>;
const MECHANISM_SCOPES = ["distributed", "local", "exception"] as const;
const MECHANISM_TARGET_LAYERS = ["outline", "chapter_plan", "draft", "editor"] as const;

export interface CreativeRecipe {
  projectId: string;
  chapterId: string;
  documentId: string;
  revision: number;
  chapterContractRevision: number;
  applicationId: string | null;
  applicationRevision: number | null;
  mechanismAssetId: string | null;
  mechanismRevision: number | null;
  writerMechanisms: TransferMechanismCard[];
  editorMechanisms: TransferMechanismCard[];
}

export interface CreativeRecipeService {
  create(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string }): Promise<CommandResult>;
  get(input: { projectId: string; chapterId: string }): Promise<CreativeRecipe | null>;
}

/**
 * 将已采纳机制冻结为本章的生产配方。这里仅接收 MechanismAssetService 的
 * 去来源化投影，绝不读取 AnalysisProject、SourceSpan、原文或机制候选原始 JSON。
 */
export function createCreativeRecipeService(options: {
  driver: SqlDriver;
  commands: CommandService;
  mechanisms: Pick<{ listAdoptedSnapshots(projectId: string): Promise<AdoptedMechanismSnapshot[]> }, "listAdoptedSnapshots">;
  applications: Pick<{ get(input: { projectId: string; chapterId: string }): Promise<ChapterMechanismApplicationSnapshot | null> }, "get">;
}): CreativeRecipeService {
  return {
    async create(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      const contract = await currentDocument(options.driver, input.projectId, chapterContractDocumentId(input.projectId, input.chapterId))
        ?? await currentDocument(options.driver, input.projectId, `planning:chapter_contract:${input.chapterId}`);
      if (!contract || contract.documentType !== "chapter_contract") throw new Error("当前章节尚未保存 ChapterContract。 ");
      if (contract.stale) throw new Error("当前 ChapterContract 已过期，必须重新保存后才能冻结配方。 ");
      const application = await options.applications.get({ projectId: input.projectId, chapterId: input.chapterId });
      if (application && application.chapterContractRevision !== contract.revision) throw new Error("本章采用记录与当前 ChapterContract revision 不一致，必须重新保存。 ");
      const selected = application ? selectSafeMechanism(await options.mechanisms.listAdoptedSnapshots(input.projectId), application.mechanismAssetId, application.mechanismRevision) : null;
      const previous = await currentDocument(options.driver, input.projectId, recipeDocumentId(input.chapterId));
      const payload: RecordValue = {
        schema_version: 1,
        kind: "creative_recipe",
        chapterId: input.chapterId,
        chapterContractRevision: contract.revision,
        applicationId: application?.applicationId ?? null,
        applicationRevision: application?.revision ?? null,
        mechanismAssetId: application?.mechanismAssetId ?? null,
        mechanismRevision: application?.mechanismRevision ?? null,
        writerMechanisms: selected ? [selected.card] : [],
        editorMechanisms: selected?.card.targetLayers.includes("editor") ? [selected.card] : [],
      };
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        ...(previous ? { expectedRevision: previous.revision } : {}),
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId: recipeDocumentId(input.chapterId),
          documentType: "creative_recipe",
          status: "approved",
          expectedRevision: previous?.revision ?? null,
          payload,
          dependencies: [
            { artifactId: `document:${contract.documentId}`, revision: contract.revision },
            ...(application ? [
              { artifactId: `document:${application.applicationId}`, revision: application.revision },
              { artifactId: `mechanism:${application.mechanismAssetId}`, revision: application.mechanismRevision },
            ] : []),
          ],
        },
      });
    },

    async get(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      const document = await currentDocument(options.driver, input.projectId, recipeDocumentId(input.chapterId));
      return document && !document.stale ? recipeFromDocument(input.projectId, input.chapterId, document) : null;
    },
  };
}

function chapterContractDocumentId(projectId: string, chapterId: string): string {
  return planningDocumentId(projectId, "chapter_contract", chapterId);
}

function recipeDocumentId(chapterId: string): string {
  return `production:creative_recipe:${chapterId}`;
}

async function currentDocument(driver: SqlDriver, projectId: string, documentId: string): Promise<{ documentId: string; artifactId: string; documentType: string; revision: number; stale: boolean; payload: RecordValue } | null> {
  const rows = await driver.query<{ document_id: string; artifact_id: string; document_type: string; current_revision: number; payload_json: string; stale: number }>({
    sql: `
      SELECT doc.document_id, artifact.artifact_id, doc.document_type, artifact.current_revision, revision.payload_json,
             CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      WHERE doc.project_id = ? AND doc.document_id = ?
    `,
    params: [projectId, documentId],
  });
  if (!rows[0]) return null;
  return { documentId: rows[0].document_id, artifactId: rows[0].artifact_id, documentType: rows[0].document_type, revision: rows[0].current_revision, stale: rows[0].stale === 1, payload: record(rows[0].payload_json, "项目文档 payload") };
}

function selectSafeMechanism(adopted: readonly AdoptedMechanismSnapshot[], mechanismAssetId: string, mechanismRevision: number): AdoptedMechanismSnapshot {
  const selected = adopted.find((snapshot) => snapshot.card.id === mechanismAssetId && snapshot.revision === mechanismRevision);
  if (!selected || !selected.card.targetLayers.includes("draft")) throw new Error("本章采用记录引用的方法卡不再是当前已采纳的 Writer 安全投影。 ");
  return { revision: selected.revision, card: freezeCard(selected.card) };
}

/** 重新构造白名单字段，避免将底层服务的附加字段随配方写入 Writer 上下文。 */
function freezeCard(card: TransferMechanismCard): TransferMechanismCard {
  assertId(card.id, "机制卡 id");
  return {
    id: card.id,
    title: nonEmpty(card.title, "机制卡 title"),
    targetEffect: nonEmpty(card.targetEffect, "机制卡 targetEffect"),
    scope: enumValue(card.scope, MECHANISM_SCOPES, "机制卡 scope"),
    when: stringList(card.when, "机制卡 when"),
    operations: stringList(card.operations, "机制卡 operations"),
    avoid: stringList(card.avoid, "机制卡 avoid"),
    applicability: stringList(card.applicability, "机制卡 applicability"),
    targetLayers: enumList(card.targetLayers, MECHANISM_TARGET_LAYERS, "机制卡 targetLayers"),
  };
}

function recipeFromDocument(projectId: string, chapterId: string, document: { revision: number; payload: RecordValue }): CreativeRecipe {
  const payload = document.payload;
  if (payload.schema_version !== 1 || payload.kind !== "creative_recipe" || payload.chapterId !== chapterId || !Number.isInteger(payload.chapterContractRevision) || (payload.chapterContractRevision as number) < 1) throw new Error("CreativeRecipe 文档损坏。 ");
  const applicationId = nullableId(payload.applicationId, "CreativeRecipe.applicationId");
  const applicationRevision = nullableRevision(payload.applicationRevision, "CreativeRecipe.applicationRevision");
  const mechanismAssetId = nullableId(payload.mechanismAssetId, "CreativeRecipe.mechanismAssetId");
  const mechanismRevision = nullableRevision(payload.mechanismRevision, "CreativeRecipe.mechanismRevision");
  const hasApplication = applicationId !== null || applicationRevision !== null || mechanismAssetId !== null || mechanismRevision !== null;
  if (hasApplication && (!applicationId || !applicationRevision || !mechanismAssetId || !mechanismRevision)) throw new Error("CreativeRecipe 的本章采用记录冻结不完整。 ");
  const writerMechanisms = cardList(payload.writerMechanisms, "CreativeRecipe.writerMechanisms");
  const editorMechanisms = cardList(payload.editorMechanisms, "CreativeRecipe.editorMechanisms");
  if (!hasApplication && (writerMechanisms.length !== 0 || editorMechanisms.length !== 0)) throw new Error("零方法章节不能携带 Writer 或 Editor 方法卡。 ");
  if (hasApplication && (writerMechanisms.length !== 1 || writerMechanisms[0]?.id !== mechanismAssetId)) throw new Error("CreativeRecipe 必须包含本章采用记录指定的唯一 Writer 方法卡。 ");
  return {
    projectId,
    chapterId,
    documentId: recipeDocumentId(chapterId),
    revision: document.revision,
    chapterContractRevision: payload.chapterContractRevision as number,
    applicationId,
    applicationRevision,
    mechanismAssetId,
    mechanismRevision,
    writerMechanisms,
    editorMechanisms,
  };
}

function cardList(value: unknown, label: string): TransferMechanismCard[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`);
  const cards = value.map((item) => freezeCard(recordValue(item, label) as unknown as TransferMechanismCard));
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error(`${label} 不能包含重复机制。`);
  return cards;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || new Set(value).size !== value.length) throw new Error(`${label} 必须是无重复字符串数组。`);
  return [...value] as string[];
}

function enumList<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number][] {
  const values = stringList(value, label);
  if (values.some((item) => !allowed.includes(item))) throw new Error(`${label} 包含非法值。`);
  return values as T[number][];
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label} 非法。`);
  return value as T[number];
}

function record(value: string, label: string): RecordValue {
  try { return recordValue(JSON.parse(value), label); } catch { throw new Error(`${label} 不是 JSON 对象。`); }
}

function recordValue(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
  return value as RecordValue;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value;
}

function nullableId(value: unknown, label: string): string | null {
  if (value === null) return null;
  return nonEmpty(value, label);
}

function nullableRevision(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${label} 必须是 null 或正整数。`);
  return value as number;
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
