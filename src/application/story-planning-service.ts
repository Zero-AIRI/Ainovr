import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ObjectReference, ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";
import { planningDocumentId } from "@/application/planning-document-id";

const encoder = new TextEncoder();
type RecordValue = Record<string, unknown>;
export type PlanningReviewStatus = "approved" | "rejected";

interface PlanningDocument {
  documentId: string;
  documentType: string;
  status: string;
  revision: number;
  payload: RecordValue;
  contentObject: ObjectReference | null;
}

export interface StoryPlanningService {
  saveProjectIntent(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; intent: RecordValue }): Promise<CommandResult>;
  submitStoryConcepts(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; rawOutput: string }): Promise<CommandResult>;
  selectStoryConcept(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; conceptId: string }): Promise<CommandResult>;
  saveStoryContract(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; contract: RecordValue }): Promise<CommandResult>;
  saveStorySystem(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; system: RecordValue }): Promise<CommandResult>;
  saveBookOutline(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; outline: RecordValue }): Promise<CommandResult>;
  saveStagePlan(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; stage: RecordValue }): Promise<CommandResult>;
  saveChapterContract(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; contract: RecordValue }): Promise<CommandResult>;
  /** 只有 human / human_via_agent 能将 Agent 规划从 pending_review 变为最终处置。 */
  reviewDocument(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; documentId: string; expectedRevision: number; status: PlanningReviewStatus }): Promise<CommandResult>;
  listDocuments(projectId: string): Promise<Array<{ documentId: string; documentType: string; status: string; revision: number; payload: RecordValue }>>;
}

export function createStoryPlanningService(options: { driver: SqlDriver; commands: CommandService; objects?: Pick<ObjectStore, "put"> }): StoryPlanningService {
  const save = async (command: Omit<CommandEnvelope, "tool" | "args">, projectId: string, kind: string, payload: RecordValue, rawOutput?: string, documentId = planningDocumentId(projectId, kind), status: "approved" | "pending_review" = "pending_review"): Promise<CommandResult> => {
    await assertProject(options.driver, projectId);
    const previous = await document(options.driver, projectId, documentId);
    if (rawOutput && !options.objects) throw new Error("当前宿主未配置 ObjectStore，无法提交 Agent 规划原始输出。 ");
    const raw = rawOutput ? await options.objects!.put({ content: encoder.encode(rawOutput), mediaType: "application/json; charset=utf-8" }) : null;
    return options.commands.execute({ ...command, projectId, ...(previous ? { expectedRevision: previous.revision } : {}), tool: "commit_project_planning_document", args: { projectId, documentId, documentType: kind, status, expectedRevision: previous?.revision ?? null, payload: { schema_version: 1, kind, ...payload, ...(raw ? { rawOutputObjectHash: raw.sha256 } : {}) }, ...(raw ? { rawOutput: raw } : {}) } });
  };
  return {
    async saveProjectIntent(input) { assertIntent(input.intent); return save(input.command, input.projectId, "project_intent", input.intent, undefined, undefined, "approved"); },
    async submitStoryConcepts(input) {
      const root = parse(input.rawOutput); const concepts = root.concepts;
      if (!Array.isArray(concepts) || concepts.length !== 3 || new Set(concepts.map((item) => record(item).id)).size !== 3 || concepts.some((item) => !validConcept(item))) throw new Error("StoryConcept 必须是三个字段完整且明显不同的概念。 ");
      return save(input.command, input.projectId, "story_concepts", { concepts }, input.rawOutput);
    },
    async selectStoryConcept(input) {
      if (input.command.actor.kind !== "human" && input.command.actor.kind !== "human_via_agent") throw new Error("StoryConcept 必须由 human 或 human_via_agent 选择。 ");
      const concepts = await document(options.driver, input.projectId, planningDocumentId(input.projectId, "story_concepts"));
      const entries = concepts?.payload.concepts;
      if (!concepts || concepts.status !== "approved") throw new Error("StoryConcept 尚未通过人工审核，不能选择。 ");
      if (!Array.isArray(entries) || !entries.some((item) => record(item).id === input.conceptId)) throw new Error("选择的 StoryConcept 不存在。 ");
      return save(input.command, input.projectId, "story_concept_selection", { conceptId: nonEmpty(input.conceptId, "conceptId") }, undefined, undefined, "approved");
    },
    async saveStoryContract(input) { await selected(options.driver, input.projectId); assertContract(input.contract); return save(input.command, input.projectId, "story_contract", input.contract); },
    async saveStorySystem(input) { await selected(options.driver, input.projectId); assertSystem(input.system); return save(input.command, input.projectId, "story_system", input.system); },
    async saveBookOutline(input) { await selected(options.driver, input.projectId); assertOutline(input.outline); return save(input.command, input.projectId, "book_outline", input.outline); },
    async saveStagePlan(input) { await selected(options.driver, input.projectId); assertStage(input.stage); return save(input.command, input.projectId, "stage_plan", input.stage, undefined, planningDocumentId(input.projectId, "stage_plan", nonEmpty(input.stage.stageId, "stageId"))); },
    async saveChapterContract(input) {
      const mechanismCardIds = assertChapter(input.contract);
      await assertAdoptedMechanisms(options.driver, input.projectId, mechanismCardIds);
      return save(input.command, input.projectId, "chapter_contract", input.contract, undefined, planningDocumentId(input.projectId, "chapter_contract", nonEmpty(input.contract.chapterId, "chapterId")));
    },
    async reviewDocument(input) {
      if (input.command.actor.kind !== "human" && input.command.actor.kind !== "human_via_agent") throw new Error("规划审核必须由 human 或 human_via_agent 明确执行。 ");
      if (input.status !== "approved" && input.status !== "rejected") throw new Error("规划审核状态无效。 ");
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error("规划审核必须携带 expectedRevision。 ");
      const documentId = normalizePlanningDocumentId(input.projectId, input.documentId);
      // 0005 之前由低层测试/旧工作区写入的 planning:* 文档仍可审核；新服务始终写入命名空间 ID。
      const current = await document(options.driver, input.projectId, documentId) ?? await document(options.driver, input.projectId, input.documentId);
      if (!current) throw new Error("待审核规划文档不存在。 ");
      if (current.status !== "pending_review") throw new Error("只有 pending_review 规划文档可以审核。 ");
      if (current.revision !== input.expectedRevision) {
        return { kind: "conflict", currentRevision: current.revision, diagnostics: [{ code: "revision_conflict", message: "规划文档已被更新，请比较当前版本后再审核。", resourceId: current.documentId }] };
      }
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId: current.documentId,
          documentType: current.documentType,
          status: input.status,
          expectedRevision: input.expectedRevision,
          payload: current.payload,
          ...(current.contentObject ? { contentObject: current.contentObject } : {}),
        },
      });
    },
    async listDocuments(projectId) { await assertProject(options.driver, projectId); return list(options.driver, projectId); },
  };
}
function normalizePlanningDocumentId(projectId: string, documentId: string): string {
  const prefix = `planning:${projectId}:`;
  if (!documentId.startsWith("planning:") || documentId.startsWith(prefix)) return documentId;
  return `${prefix}${documentId.slice("planning:".length)}`;
}

async function selected(driver: SqlDriver, projectId: string): Promise<void> { const selection = await document(driver, projectId, planningDocumentId(projectId, "story_concept_selection")); if (!selection || selection.status !== "approved") throw new Error("必须先由人类选择已审核的 StoryConcept。 "); }
async function assertProject(driver: SqlDriver, projectId: string): Promise<void> { if (!projectId.trim() || (await driver.query({ sql: "SELECT project_id FROM novel_projects WHERE project_id = ?", params: [projectId] })).length !== 1) throw new Error("原创 Project 不存在。 "); }
async function document(driver: SqlDriver, projectId: string, id: string): Promise<PlanningDocument | null> {
  const rows = await driver.query<{ document_id: string; document_type: string; status: string; current_revision: number; payload_json: string; sha256: string | null; byte_length: number | null; media_type: string | null }>({
    sql: `SELECT doc.document_id, doc.document_type, doc.status, artifact.current_revision, revision.payload_json,
                 object.sha256, object.byte_length, object.media_type
          FROM project_documents doc
          INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          LEFT JOIN objects object ON object.sha256 = revision.content_object_hash
          WHERE doc.project_id = ? AND doc.document_id = ?`,
    params: [projectId, id],
  });
  const row = rows[0];
  if (!row) return null;
  const contentObject = row.sha256 && row.byte_length !== null && row.media_type
    ? { sha256: row.sha256, byteLength: row.byte_length, mediaType: row.media_type }
    : null;
  return { documentId: row.document_id, documentType: row.document_type, status: row.status, revision: row.current_revision, payload: parse(row.payload_json), contentObject };
}
async function list(driver: SqlDriver, projectId: string) {
  const rows = await driver.query<{ document_id: string; document_type: string; status: string; current_revision: number; payload_json: string }>({
    sql: "SELECT doc.document_id, doc.document_type, doc.status, artifact.current_revision, revision.payload_json FROM project_documents doc INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision WHERE doc.project_id = ? ORDER BY doc.document_id",
    params: [projectId],
  });
  return rows.map((row) => ({ documentId: row.document_id, documentType: row.document_type, status: row.status, revision: row.current_revision, payload: parse(row.payload_json) }));
}
function assertIntent(v: RecordValue) { for (const key of ["genre", "audience", "targetScale"] as const) nonEmpty(v[key], key); for (const key of ["experienceGoals", "prohibitions"] as const) strings(v[key], key, true); }
function assertContract(v: RecordValue) { for (const key of ["corePromise", "centralConflict", "endingDirection"] as const) nonEmpty(v[key], key); strings(v.immutableBoundaries, "immutableBoundaries", true); }
function assertSystem(v: RecordValue) { for (const key of ["worldRules", "characterSystem", "causalityRules", "informationRules"] as const) strings(v[key], key, true); }
function assertOutline(v: RecordValue) { if (!Array.isArray(v.acts) || v.acts.length === 0) throw new Error("acts 必须是非空数组。 "); for (const [index, value] of v.acts.entries()) { const act = record(value); nonEmpty(act.id, `acts[${index}].id`); nonEmpty(act.purpose, `acts[${index}].purpose`); if (!Array.isArray(act.chapterRange) || act.chapterRange.length !== 2 || !act.chapterRange.every((item) => Number.isInteger(item) && Number(item) > 0) || Number(act.chapterRange[0]) > Number(act.chapterRange[1])) throw new Error(`acts[${index}].chapterRange 非法。`); } strings(v.endingDependencies, "endingDependencies", true); }
function assertStage(v: RecordValue) { for (const key of ["stageId", "objective", "entryCondition", "exitCondition", "readerExpectation"] as const) nonEmpty(v[key], key); strings(v.chapterIds, "chapterIds", true); }
function assertChapter(v: RecordValue): string[] {
  for (const key of ["chapterId", "desire", "pressure", "turningPoint", "emotionalCycle"] as const) nonEmpty(v[key], key);
  if (!Number.isInteger(v.ordinal) || Number(v.ordinal) < 1) throw new Error("ordinal 非法。 ");
  for (const key of ["entryState", "exitState", "mustNotHappen", "nextChapterInterface"] as const) strings(v[key], key, key !== "mustNotHappen");
  const mechanismCardIds = strings(v.mechanismCardIds, "mechanismCardIds", false);
  if (mechanismCardIds.length > 3) throw new Error("ChapterContract 最多激活三张 Writer 机制卡。 ");
  if (!["establish", "reinforce", "delay", "payoff", "transform"].includes(v.readerPromiseAction as string)) throw new Error("readerPromiseAction 无效。 ");
  return mechanismCardIds;
}
function validConcept(value: unknown): boolean { const v = record(value); try { for (const key of ["id", "title", "premise", "centralConflict", "novelty", "endingDirection"] as const) nonEmpty(v[key], key); return true; } catch { return false; } }
function record(value: unknown): RecordValue { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("字段必须是对象。 "); return value as RecordValue; }
function parse(value: string): RecordValue { try { return record(JSON.parse(value)); } catch { throw new Error("输出必须是 JSON 对象。 "); } }
async function assertAdoptedMechanisms(driver: SqlDriver, projectId: string, mechanismCardIds: readonly string[]): Promise<void> {
  if (mechanismCardIds.length === 0) return;
  const placeholders = mechanismCardIds.map(() => "?").join(", ");
  const rows = await driver.query<{ mechanism_asset_id: string }>({
    sql: `SELECT DISTINCT mechanism_asset_id FROM mechanism_adoptions WHERE project_id = ? AND status = 'adopted' AND mechanism_asset_id IN (${placeholders})`,
    params: [projectId, ...mechanismCardIds],
  });
  const adopted = new Set(rows.map((row) => row.mechanism_asset_id));
  const missing = mechanismCardIds.filter((id) => !adopted.has(id));
  if (missing.length > 0) throw new Error(`ChapterContract 只能选择当前项目已采纳的机制资产：${missing.join("、")}。`);
}
function strings(value: unknown, key: string, required: boolean): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || (required && value.length === 0) || new Set(value).size !== value.length) throw new Error(`${key} 必须是非空且无重复的字符串数组。`); return value as string[]; }
function nonEmpty(value: unknown, key: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 必须是非空字符串。`); return value; }
