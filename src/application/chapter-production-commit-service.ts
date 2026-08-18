import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ChapterReaderDraft } from "@/application/chapter-reader-manifest-service";
import type { ObjectReference, ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";
import { planningDocumentId } from "@/application/planning-document-id";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
type RecordValue = Record<string, unknown>;

export interface RevisionPatch {
  expectedRevision: number | null;
  payload: RecordValue;
}

export interface CanonPatch extends RevisionPatch { canonEntryId: string; }
export interface CharacterKnowledgePatch extends RevisionPatch { knowledgeId: string; characterId: string; }
export interface ReaderStatePatch { readerStateId: string; payload: RecordValue; }
export interface ReaderPromisePatch { readerPromiseId: string; status: "establish" | "reinforce" | "delay" | "payoff" | "transform"; payload: RecordValue; }

export interface AcceptChapterDraftInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  projectId: string;
  chapterId: string;
  chapterOrdinal: number;
  productionCommitId: string;
  /** 人工明确选择的、已提交到领域存储的 V1/V2/V3 草稿。 */
  draftDocumentId: string;
  chapterDelta: RecordValue;
  canonPatches: CanonPatch[];
  characterKnowledgePatches: CharacterKnowledgePatch[];
  readerState: ReaderStatePatch;
  readerPromiseUpdates: ReaderPromisePatch[];
  outlineDrift: { payload: RecordValue };
}

export interface AcceptedChapter {
  projectId: string;
  chapterId: string;
  revision: number;
  title: string;
  text: string;
  manifestId: string;
  draftDocumentId: string;
  draftRevision: "v1" | "v2" | "v3";
  draftModel: string;
  reviewLineage: string[];
  chapterDelta: RecordValue;
  productionCommitId: string;
}

export interface ChapterProductionCommitService {
  /**
   * 人工接受一个现有草稿。调用方不能提供任意正文、标题或 Manifest，从而确保
   * ProductionCommit 始终指向 Writer/Editor 已产生且可审计的一个版本。
   */
  acceptDraft(input: AcceptChapterDraftInput): Promise<CommandResult>;
  getAcceptedChapter(input: { projectId: string; chapterId: string }): Promise<AcceptedChapter | null>;
}

/**
 * 生产端唯一的正式落库入口。正文和 Manifest 先写对象库，随后由单个
 * CommandService 事务同时提交章节、所有状态 patch、版本和审计；内部 Agent
 * 不被允许调用它把自己的输出直接设为 accepted。
 */
export function createChapterProductionCommitService(options: {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">;
}): ChapterProductionCommitService {
  return {
    async acceptDraft(input) {
      assertHumanActor(input.command);
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertId(input.productionCommitId, "productionCommitId");
      assertId(input.draftDocumentId, "draftDocumentId");
      if (!Number.isInteger(input.chapterOrdinal) || input.chapterOrdinal < 1) throw new Error("chapterOrdinal 非法。 ");
      const selected = await selectedDraft(options.drafts, input.projectId, input.chapterId, input.draftDocumentId);
      await assertProductionChapterBoundary(options.driver, input.projectId, input.chapterId, input.chapterOrdinal);
      const manifest = await frozenManifest(options.driver, input.projectId, input.chapterId, selected.manifestId);
      const previous = await currentChapter(options.driver, input.projectId, input.chapterId);
      const textObject = await options.objects.put({ content: encoder.encode(selected.text), mediaType: "text/plain; charset=utf-8" });
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        ...(previous ? { expectedRevision: previous.chapterRevision } : {}),
        tool: "commit_chapter_production",
        args: {
          projectId: input.projectId,
          chapterId: input.chapterId,
          chapterOrdinal: input.chapterOrdinal,
          title: selected.title,
          productionCommitId: input.productionCommitId,
          manifestId: selected.manifestId,
          manifestObject: manifest.object,
          textObject,
          selectedDraft: {
            documentId: selected.documentId,
            revision: selected.revision,
            model: selected.model,
            reviewLineage: selected.reviewLineage,
          },
          expectedChapterRevision: previous?.chapterRevision ?? null,
          expectedTextRevision: previous?.textRevision ?? null,
          chapterDelta: input.chapterDelta,
          canonPatches: input.canonPatches,
          characterKnowledgePatches: input.characterKnowledgePatches,
          readerState: input.readerState,
          readerPromiseUpdates: input.readerPromiseUpdates,
          outlineDrift: input.outlineDrift,
        },
      });
    },

    async getAcceptedChapter(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      const rows = await options.driver.query<{
        current_revision: number;
        payload_json: string;
        content_object_hash: string | null;
      }>({
        sql: `
          SELECT artifact.current_revision, revision.payload_json, revision.content_object_hash
          FROM project_documents doc
          INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          WHERE doc.project_id = ? AND doc.document_id = ? AND doc.document_type = 'chapter_text' AND doc.status = 'accepted'
        `,
        params: [input.projectId, chapterTextDocumentId(input.chapterId)],
      });
      const row = rows[0];
      if (!row || !row.content_object_hash) return null;
      const payload = parseRecord(row.payload_json, "ChapterText payload");
      if (payload.schema_version !== 1 || payload.kind !== "chapter_text" || payload.chapterId !== input.chapterId) throw new Error("ChapterText 文档损坏。 ");
      const selected = acceptedDraft(payload);
      return {
        projectId: input.projectId,
        chapterId: input.chapterId,
        revision: row.current_revision,
        title: readString(payload.title, "ChapterText.title"),
        text: decoder.decode(await options.objects.read(row.content_object_hash)),
        manifestId: readString(payload.manifestId, "ChapterText.manifestId"),
        draftDocumentId: selected.documentId,
        draftRevision: selected.revision,
        draftModel: selected.model,
        reviewLineage: selected.reviewLineage,
        chapterDelta: recordValue(payload.chapterDelta, "ChapterText.chapterDelta"),
        productionCommitId: readString(payload.productionCommitId, "ChapterText.productionCommitId"),
      };
    },
  };
}

async function assertProductionChapterBoundary(driver: SqlDriver, projectId: string, chapterId: string, ordinal: number): Promise<void> {
  const contractRows = await driver.query<{ payload_json: string }>(
    { sql: `SELECT revision.payload_json FROM project_documents doc INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision WHERE doc.project_id = ? AND doc.document_id = ? AND doc.document_type = 'chapter_contract' AND doc.status = 'approved'`, params: [projectId, planningDocumentId(projectId, "chapter_contract", chapterId)] },
  );
  if (!contractRows[0]) throw new Error("ChapterContract 不存在或尚未批准，不能提交正式章节。 ");
  const contract = parseRecord(contractRows[0].payload_json, "ChapterContract");
  if (contract.chapterId !== chapterId || contract.ordinal !== ordinal) throw new Error("ProductionCommit 的 chapterOrdinal 必须匹配已批准 ChapterContract。 ");
  const current = await driver.query<{ ordinal: number }>({ sql: "SELECT ordinal FROM chapters WHERE project_id = ? AND chapter_id = ?", params: [projectId, chapterId] });
  if (current[0]) {
    if (current[0].ordinal !== ordinal) throw new Error("已存在章节的 ordinal 不可被 ProductionCommit 静默改变。 ");
    return;
  }
  const previous = await driver.query<{ ordinal: number }>({ sql: "SELECT MAX(ordinal) AS ordinal FROM chapters WHERE project_id = ?", params: [projectId] });
  if (previous[0]?.ordinal !== null && ordinal !== Number(previous[0].ordinal) + 1) throw new Error("新章节必须紧接当前生产游标，不能跳过或倒序提交。 ");
}

interface SelectedDraft {
  documentId: string;
  title: string;
  text: string;
  manifestId: string;
  model: string;
  revision: "v1" | "v2" | "v3";
  reviewLineage: string[];
}

async function selectedDraft(
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">,
  projectId: string,
  chapterId: string,
  documentId: string,
): Promise<SelectedDraft> {
  const draft = await drafts.getDraft(documentId);
  if (!draft || draft.documentId !== documentId || draft.projectId !== projectId || draft.chapterId !== chapterId) {
    throw new Error("被选择的章节草稿不存在，或不属于当前作品和章节。 ");
  }
  if (draft.revision !== "v1" && draft.revision !== "v2" && draft.revision !== "v3") throw new Error("只能接受 V1、V2 或 V3 章节草稿。 ");
  if (draft.documentId !== expectedDraftDocumentId(chapterId, draft.revision)) throw new Error("被选择的章节草稿不是受控版本文档。 ");
  const title = nonEmpty(draft.title, "draft.title");
  const text = nonEmpty(draft.text, "draft.text");
  const manifestId = nonEmpty(draft.manifestId, "draft.manifestId");
  const model = nonEmpty(draft.model, "draft.model");
  return { documentId, title, text, manifestId, model, revision: draft.revision, reviewLineage: await reviewLineage(drafts, draft) };
}

async function reviewLineage(
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">,
  selected: ChapterReaderDraft,
): Promise<string[]> {
  const lineage: string[] = [];
  let current: ChapterReaderDraft = selected;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current.revision === "v1") return lineage;
    const editor = current as ChapterReaderDraft & { parentDocumentId?: unknown; parentRevision?: unknown; reviewId?: unknown };
    if (typeof editor.parentDocumentId !== "string" || !editor.parentDocumentId.trim() || typeof editor.reviewId !== "string" || !editor.reviewId.trim()) {
      throw new Error("Editor 草稿缺少父版本或 Reviewer 绑定，不能接受。 ");
    }
    const expectedParentRevision = current.revision === "v2" ? "v1" : "v2";
    if (editor.parentRevision !== expectedParentRevision || editor.parentDocumentId !== expectedDraftDocumentId(current.chapterId, expectedParentRevision)) {
      throw new Error("Editor 草稿的父版本链不完整，不能接受。 ");
    }
    lineage.unshift(editor.reviewId);
    const parent = await drafts.getDraft(editor.parentDocumentId);
    if (!parent || parent.documentId !== editor.parentDocumentId || parent.projectId !== current.projectId || parent.chapterId !== current.chapterId || parent.revision !== expectedParentRevision) {
      throw new Error("Editor 草稿的父版本不存在或不匹配，不能接受。 ");
    }
    current = parent;
  }
  throw new Error("章节草稿的版本链超过 V1/V2/V3 上限。 ");
}

function expectedDraftDocumentId(chapterId: string, revision: "v1" | "v2" | "v3"): string {
  return `production:chapter_draft:${chapterId}:${revision}`;
}

function acceptedDraft(payload: RecordValue): Pick<SelectedDraft, "documentId" | "revision" | "model" | "reviewLineage"> {
  const selected = recordValue(payload.selectedDraft, "ChapterText.selectedDraft");
  const revision = selected.revision;
  if (revision !== "v1" && revision !== "v2" && revision !== "v3") throw new Error("ChapterText.selectedDraft.revision 非法。 ");
  return {
    documentId: readString(selected.documentId, "ChapterText.selectedDraft.documentId"),
    revision,
    model: readString(selected.model, "ChapterText.selectedDraft.model"),
    reviewLineage: stringList(selected.reviewLineage, "ChapterText.selectedDraft.reviewLineage"),
  };
}

function chapterTextDocumentId(chapterId: string): string {
  return `production:chapter_text:${chapterId}`;
}

async function frozenManifest(driver: SqlDriver, projectId: string, chapterId: string, manifestId: string): Promise<{ object: ObjectReference }> {
  const rows = await driver.query<{
    document_type: string;
    status: string;
    payload_json: string;
    content_object_hash: string | null;
    sha256: string | null;
    byte_length: number | null;
    media_type: string | null;
  }>({
    sql: `
      SELECT doc.document_type, doc.status, revision.payload_json, revision.content_object_hash,
             object.sha256, object.byte_length, object.media_type
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      LEFT JOIN objects object ON object.sha256 = revision.content_object_hash
      WHERE doc.project_id = ? AND doc.document_id = ?
    `,
    params: [projectId, `production:context_manifest:${manifestId}`],
  });
  const row = rows[0];
  if (!row || row.document_type !== "context_manifest" || row.status !== "frozen" || !row.content_object_hash || !row.sha256 || row.byte_length === null || !row.media_type) throw new Error("必须使用已冻结的 ContextManifest 提交章节。 ");
  const payload = parseRecord(row.payload_json, "ContextManifest payload");
  if (payload.schema_version !== 1 || payload.kind !== "context_manifest" || payload.manifestId !== manifestId || payload.chapterId !== chapterId || payload.taskRole !== "writer" || payload.contextObjectHash !== row.content_object_hash) throw new Error("ContextManifest 与章节不匹配。 ");
  return { object: { sha256: row.sha256, byteLength: row.byte_length, mediaType: row.media_type } };
}

async function currentChapter(driver: SqlDriver, projectId: string, chapterId: string): Promise<{ chapterRevision: number; textRevision: number } | null> {
  const rows = await driver.query<{ chapter_revision: number; text_revision: number | null }>({
    sql: `
      SELECT chapter.current_revision AS chapter_revision, artifact.current_revision AS text_revision
      FROM chapters chapter
      LEFT JOIN project_documents doc ON doc.project_id = chapter.project_id AND doc.document_id = ?
      LEFT JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      WHERE chapter.project_id = ? AND chapter.chapter_id = ?
    `,
    params: [chapterTextDocumentId(chapterId), projectId, chapterId],
  });
  const row = rows[0];
  if (!row) return null;
  if (!Number.isInteger(row.chapter_revision) || !Number.isInteger(row.text_revision)) throw new Error("章节与正文版本状态不一致。 ");
  return { chapterRevision: row.chapter_revision as number, textRevision: row.text_revision as number };
}

function assertHumanActor(command: Omit<CommandEnvelope, "tool" | "args">): void {
  if (command.actor.kind !== "human" && command.actor.kind !== "human_via_agent") throw new Error("只有人类或经人类确认的 Agent 可以接受正式章节。 ");
}

function parseRecord(value: string, label: string): RecordValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return recordValue(parsed, label);
  } catch {
    throw new Error(`${label} 不是 JSON 对象。`);
  }
}

function recordValue(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
  return value as RecordValue;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()) || new Set(value).size !== value.length) {
    throw new Error(`${label} 必须是无重复的非空字符串数组。`);
  }
  return [...value] as string[];
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value;
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
