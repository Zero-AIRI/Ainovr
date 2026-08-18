import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { TransferMechanismCard } from "@/lib/analysis/transfer-card";
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
  mechanismCardIds: string[];
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
  mechanisms: Pick<{ listAdopted(projectId: string): Promise<TransferMechanismCard[]> }, "listAdopted">;
}): CreativeRecipeService {
  return {
    async create(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      const contract = await currentDocument(options.driver, input.projectId, chapterContractDocumentId(input.projectId, input.chapterId))
        ?? await currentDocument(options.driver, input.projectId, `planning:chapter_contract:${input.chapterId}`);
      if (!contract || contract.documentType !== "chapter_contract") throw new Error("当前章节尚未保存 ChapterContract。 ");
      const mechanismCardIds = stringList(contract.payload.mechanismCardIds, "ChapterContract.mechanismCardIds");
      if (mechanismCardIds.length > 3) throw new Error("ChapterContract 最多激活三张 Writer 机制卡。 ");
      const adopted = await options.mechanisms.listAdopted(input.projectId);
      const selected = selectSafeMechanisms(adopted, mechanismCardIds);
      const previous = await currentDocument(options.driver, input.projectId, recipeDocumentId(input.chapterId));
      const payload: RecordValue = {
        schema_version: 1,
        kind: "creative_recipe",
        chapterId: input.chapterId,
        chapterContractRevision: contract.revision,
        mechanismCardIds,
        writerMechanisms: selected.filter((card) => card.targetLayers.includes("draft")),
        editorMechanisms: selected.filter((card) => card.targetLayers.includes("editor")),
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
        },
      });
    },

    async get(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      const document = await currentDocument(options.driver, input.projectId, recipeDocumentId(input.chapterId));
      return document ? recipeFromDocument(input.projectId, input.chapterId, document) : null;
    },
  };
}

function chapterContractDocumentId(projectId: string, chapterId: string): string {
  return planningDocumentId(projectId, "chapter_contract", chapterId);
}

function recipeDocumentId(chapterId: string): string {
  return `production:creative_recipe:${chapterId}`;
}

async function currentDocument(driver: SqlDriver, projectId: string, documentId: string): Promise<{ documentType: string; revision: number; payload: RecordValue } | null> {
  const rows = await driver.query<{ document_type: string; current_revision: number; payload_json: string }>({
    sql: `
      SELECT doc.document_type, artifact.current_revision, revision.payload_json
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      WHERE doc.project_id = ? AND doc.document_id = ?
    `,
    params: [projectId, documentId],
  });
  if (!rows[0]) return null;
  return { documentType: rows[0].document_type, revision: rows[0].current_revision, payload: record(rows[0].payload_json, "项目文档 payload") };
}

function selectSafeMechanisms(adopted: readonly TransferMechanismCard[], ids: readonly string[]): TransferMechanismCard[] {
  const byId = new Map(adopted.map((card) => [card.id, freezeCard(card)]));
  const selected = ids.map((id) => byId.get(id));
  const missing = ids.filter((_, index) => !selected[index]);
  if (missing.length > 0) throw new Error(`ChapterContract 选择的机制尚未以安全投影采纳：${missing.join("、")}。`);
  return selected as TransferMechanismCard[];
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
  const mechanismCardIds = stringList(payload.mechanismCardIds, "CreativeRecipe.mechanismCardIds");
  if (mechanismCardIds.length > 3) throw new Error("CreativeRecipe 机制数超限。 ");
  return {
    projectId,
    chapterId,
    documentId: recipeDocumentId(chapterId),
    revision: document.revision,
    chapterContractRevision: payload.chapterContractRevision as number,
    mechanismCardIds,
    writerMechanisms: cardList(payload.writerMechanisms, "CreativeRecipe.writerMechanisms"),
    editorMechanisms: cardList(payload.editorMechanisms, "CreativeRecipe.editorMechanisms"),
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

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
