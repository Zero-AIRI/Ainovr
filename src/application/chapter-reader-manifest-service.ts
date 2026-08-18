import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";
import { planningDocumentId } from "@/application/planning-document-id";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const READER_KINDS = ["immersive", "low_patience", "logic_sensitive"] as const;
const LAYER_NAMES = ["generated_chapter_text", "reader_state_and_promises", "necessary_past_context"] as const;
type RecordValue = Record<string, unknown>;

export type ChapterReaderKind = typeof READER_KINDS[number];
export type ChapterDraftRevision = "v1" | "v2" | "v3";

/** Reader 只能从这一受限投影取得待评正文，而不能反向读取 Writer Manifest。 */
export interface ChapterReaderDraft {
  documentId: string;
  projectId: string;
  chapterId: string;
  manifestId: string;
  title: string;
  text: string;
  model: string;
  taskId: string;
  revision: ChapterDraftRevision;
}

export interface ChapterReaderContextLayer {
  name: typeof LAYER_NAMES[number];
  required: boolean;
  documentIds: string[];
  value: unknown;
}

export interface ChapterReaderContextManifest {
  schema_version: 1;
  kind: "chapter_reader_context_manifest";
  manifestId: string;
  projectId: string;
  chapterId: string;
  readerKind: ChapterReaderKind;
  conversationHistory: [];
  tokenBudget: number;
  tokenEstimate: number;
  draft: Pick<ChapterReaderDraft, "documentId" | "title" | "text" | "revision">;
  layers: ChapterReaderContextLayer[];
}

export interface ChapterReaderManifestService {
  freeze(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    projectId: string;
    chapterId: string;
    draftDocumentId: string;
    manifestId: string;
    readerKind: ChapterReaderKind;
    tokenBudget: number;
  }): Promise<CommandResult>;
  get(input: { projectId: string; manifestId: string }): Promise<ChapterReaderContextManifest | null>;
}

/**
 * 三类 Reader 的冻结上下文。它故意不复用 Writer ContextManifest：Reader 只可见
 * 已生成正文、当前可知 ReaderState/Promise 与已经接受的上文，绝不扫描规划、配方、
 * 机制、参考或分析表。
 */
export function createChapterReaderManifestService(options: {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  drafts: Pick<{ getDraft(documentId: string): Promise<ChapterReaderDraft | null> }, "getDraft">;
}): ChapterReaderManifestService {
  return {
    async freeze(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertId(input.draftDocumentId, "draftDocumentId");
      assertId(input.manifestId, "manifestId");
      assertReaderKind(input.readerKind);
      assertTokenBudget(input.tokenBudget);
      await assertProject(options.driver, input.projectId);
      const draft = await options.drafts.getDraft(input.draftDocumentId);
      assertDraft(draft, input.projectId, input.chapterId);

      const chapterOrdinal = await readChapterOrdinal(options.driver, input.projectId, input.chapterId);
      const layers: ChapterReaderContextLayer[] = [
        {
          name: "generated_chapter_text",
          required: true,
          documentIds: [draft.documentId],
          value: { documentId: draft.documentId, revision: draft.revision, title: draft.title, text: draft.text },
        },
        {
          name: "reader_state_and_promises",
          required: false,
          documentIds: [],
          value: await readerView(options.driver, input.projectId),
        },
        {
          name: "necessary_past_context",
          required: false,
          documentIds: [],
          value: await pastAcceptedContext(options.driver, options.objects, input.projectId, chapterOrdinal),
        },
      ];
      const manifest: ChapterReaderContextManifest = {
        schema_version: 1,
        kind: "chapter_reader_context_manifest",
        manifestId: input.manifestId,
        projectId: input.projectId,
        chapterId: input.chapterId,
        readerKind: input.readerKind,
        conversationHistory: [],
        tokenBudget: input.tokenBudget,
        tokenEstimate: 0,
        draft: { documentId: draft.documentId, title: draft.title, text: draft.text, revision: draft.revision },
        layers,
      };
      assertReaderSafe(manifest);
      manifest.tokenEstimate = estimateTokens(JSON.stringify(manifest));
      if (manifest.tokenEstimate > input.tokenBudget) throw new Error("Reader ContextManifest 超出 token 预算，拒绝冻结。 ");
      const object = await options.objects.put({ content: encoder.encode(JSON.stringify(manifest)), mediaType: "application/vnd.ainovr.chapter-reader-context-manifest+json" });
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId: manifestDocumentId(input.manifestId),
          documentType: "reader_context_manifest",
          status: "frozen",
          expectedRevision: null,
          payload: {
            schema_version: 1,
            kind: "reader_context_manifest",
            manifestId: input.manifestId,
            chapterId: input.chapterId,
            readerKind: input.readerKind,
            draftDocumentId: draft.documentId,
            draftRevision: draft.revision,
            tokenBudget: input.tokenBudget,
            tokenEstimate: manifest.tokenEstimate,
            contextObjectHash: object.sha256,
          },
          rawOutput: object,
        },
      });
    },

    async get(input) {
      assertId(input.projectId, "projectId");
      assertId(input.manifestId, "manifestId");
      const document = await optionalDocument(options.driver, input.projectId, manifestDocumentId(input.manifestId));
      if (!document) return null;
      if (document.documentType !== "reader_context_manifest" || document.status !== "frozen" || !document.contentObjectHash) throw new Error("Reader ContextManifest 文档损坏。 ");
      const manifest = parseManifest(decoder.decode(await options.objects.read(document.contentObjectHash)));
      if (manifest.projectId !== input.projectId || manifest.manifestId !== input.manifestId) throw new Error("Reader ContextManifest 与请求不匹配。 ");
      assertReaderSafe(manifest);
      return manifest;
    },
  };
}

function manifestDocumentId(manifestId: string): string {
  return `production:reader_context_manifest:${manifestId}`;
}

async function assertProject(driver: SqlDriver, projectId: string): Promise<void> {
  const rows = await driver.query<{ project_id: string }>({ sql: "SELECT project_id FROM novel_projects WHERE project_id = ?", params: [projectId] });
  if (rows.length !== 1) throw new Error("原创 Project 不存在。 ");
}

async function readChapterOrdinal(driver: SqlDriver, projectId: string, chapterId: string): Promise<number | null> {
  const rows = await driver.query<{ payload_json: string }>({
    sql: `
      SELECT revision.payload_json
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      WHERE doc.project_id = ? AND doc.document_id = ? AND doc.document_type = 'chapter_contract'
    `,
    params: [projectId, planningDocumentId(projectId, "chapter_contract", chapterId)],
  });
  if (!rows[0]) return null;
  const ordinal = parseRecord(rows[0].payload_json, "ChapterContract").ordinal;
  return Number.isInteger(ordinal) && Number(ordinal) > 0 ? Number(ordinal) : null;
}

async function readerView(driver: SqlDriver, projectId: string): Promise<RecordValue> {
  const [states, promises] = await Promise.all([
    driver.query<{ reader_state_id: string; payload_json: string; revision: number }>({ sql: "SELECT reader_state_id, payload_json, revision FROM reader_states WHERE project_id = ? ORDER BY created_at, reader_state_id", params: [projectId] }),
    driver.query<{ reader_promise_id: string; payload_json: string; status: string; revision: number }>({ sql: "SELECT reader_promise_id, payload_json, status, revision FROM reader_promises WHERE project_id = ? ORDER BY created_at, reader_promise_id", params: [projectId] }),
  ]);
  const value = {
    readerStates: states.map((item) => ({ id: item.reader_state_id, revision: item.revision, value: parseRecord(item.payload_json, "ReaderState payload") })),
    readerPromises: promises.map((item) => ({ id: item.reader_promise_id, status: item.status, revision: item.revision, value: parseRecord(item.payload_json, "ReaderPromise payload") })),
  };
  assertNoForbiddenKeys(value);
  return value;
}

async function pastAcceptedContext(driver: SqlDriver, objects: ObjectStore, projectId: string, chapterOrdinal: number | null): Promise<RecordValue> {
  if (chapterOrdinal === null) return { acceptedChapter: null };
  const rows = await driver.query<{ document_id: string; content_object_hash: string; ordinal: number }>({
    sql: `
      SELECT doc.document_id, revision.content_object_hash, chapter.ordinal
      FROM project_documents doc
      INNER JOIN chapters chapter ON chapter.chapter_id = doc.chapter_id
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      WHERE doc.project_id = ? AND doc.document_type = 'chapter_text' AND doc.status = 'accepted'
        AND chapter.ordinal < ? AND revision.content_object_hash IS NOT NULL
      ORDER BY chapter.ordinal DESC, doc.document_id DESC LIMIT 1
    `,
    params: [projectId, chapterOrdinal],
  });
  const row = rows[0];
  if (!row) return { acceptedChapter: null };
  return { acceptedChapter: { documentId: row.document_id, ordinal: row.ordinal, text: decoder.decode(await objects.read(row.content_object_hash)) } };
}

async function optionalDocument(driver: SqlDriver, projectId: string, documentId: string): Promise<{ documentType: string; status: string; contentObjectHash: string | null } | null> {
  const rows = await driver.query<{ document_type: string; status: string; content_object_hash: string | null }>({
    sql: `
      SELECT doc.document_type, doc.status, revision.content_object_hash
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      WHERE doc.project_id = ? AND doc.document_id = ?
    `,
    params: [projectId, documentId],
  });
  return rows[0] ? { documentType: rows[0].document_type, status: rows[0].status, contentObjectHash: rows[0].content_object_hash } : null;
}

function assertDraft(draft: ChapterReaderDraft | null, projectId: string, chapterId: string): asserts draft is ChapterReaderDraft {
  if (!draft || draft.projectId !== projectId || draft.chapterId !== chapterId || !draft.documentId.trim() || !draft.manifestId.trim() || !draft.title.trim() || !draft.text.trim() || !["v1", "v2", "v3"].includes(draft.revision)) throw new Error("Writer 草稿不存在、不属于目标章节或不完整。 ");
}

function parseManifest(value: string): ChapterReaderContextManifest {
  const manifest = parseRecord(value, "Reader ContextManifest") as Partial<ChapterReaderContextManifest>;
  if (manifest.schema_version !== 1 || manifest.kind !== "chapter_reader_context_manifest" || !isReaderKind(manifest.readerKind) || !Array.isArray(manifest.conversationHistory) || manifest.conversationHistory.length !== 0 || !Array.isArray(manifest.layers) || !recordValue(manifest.draft)) throw new Error("Reader ContextManifest 对象损坏。 ");
  return manifest as ChapterReaderContextManifest;
}

function assertReaderSafe(manifest: ChapterReaderContextManifest): void {
  if (!isReaderKind(manifest.readerKind) || !manifest.projectId.trim() || !manifest.chapterId.trim() || !manifest.manifestId.trim() || !Array.isArray(manifest.conversationHistory) || manifest.conversationHistory.length !== 0) throw new Error("Reader ContextManifest 基础字段无效。 ");
  if (!Array.isArray(manifest.layers) || manifest.layers.length !== LAYER_NAMES.length || manifest.layers.some((layer, index) => layer.name !== LAYER_NAMES[index])) throw new Error("Reader ContextManifest 缺少隔离层。 ");
  if (!manifest.draft || !manifest.draft.documentId.trim() || !manifest.draft.title.trim() || !manifest.draft.text.trim() || !["v1", "v2", "v3"].includes(manifest.draft.revision)) throw new Error("Reader ContextManifest 缺少正文。 ");
  assertNoForbiddenKeys(manifest.layers.slice(1));
}

function assertNoForbiddenKeys(value: unknown): void {
  const forbidden = new Set(["storycontract", "storysystem", "creativerecipe", "mechanism", "provenance", "evidence", "span", "analysisprojectid", "reference", "source"]);
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(visit); return; }
    const record = recordValue(current);
    if (!record) return;
    for (const [key, nested] of Object.entries(record)) {
      if (forbidden.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) throw new Error("Reader ContextManifest 包含作者秘密、机制或参考侧字段。 ");
      visit(nested);
    }
  };
  visit(value);
}

function estimateTokens(value: string): number {
  let total = 0;
  let latinRun = 0;
  for (const char of value) {
    if (/^[\u3400-\u9fff\uff00-\uffef]$/u.test(char)) { total += 1; latinRun = 0; }
    else { latinRun += 1; if (latinRun === 4) { total += 1; latinRun = 0; } }
  }
  return total + (latinRun > 0 ? 1 : 0) + 32;
}

function parseRecord(value: string, label: string): RecordValue {
  try { return recordValue(JSON.parse(value)) ?? fail(`${label} 不是 JSON 对象。`); } catch { throw new Error(`${label} 不是 JSON 对象。`); }
}

function recordValue(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function fail(message: string): never { throw new Error(message); }
function assertId(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`); }
function assertTokenBudget(value: number): void { if (!Number.isInteger(value) || value < 2) throw new Error("Reader token 预算非法。 "); }
function isReaderKind(value: unknown): value is ChapterReaderKind { return typeof value === "string" && (READER_KINDS as readonly string[]).includes(value); }
function assertReaderKind(value: unknown): asserts value is ChapterReaderKind { if (!isReaderKind(value)) throw new Error("Reader 类型无效。 "); }
