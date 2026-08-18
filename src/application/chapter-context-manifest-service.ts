import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";
import { planningDocumentId } from "@/application/planning-document-id";
import type { ModelResolver } from "@/application/model-resolver";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
type RecordValue = Record<string, unknown>;

export type WriterContextLayerName =
  | "chapter_contract"
  | "story_contract_and_system"
  | "canon_and_character"
  | "recent_accepted_text"
  | "reader_state_and_promises"
  | "creative_recipe";

export interface WriterContextLayer {
  name: WriterContextLayerName;
  required: boolean;
  documentIds: string[];
  value: unknown;
}

export interface WriterContextManifest {
  schema_version: 1;
  kind: "chapter_context_manifest";
  manifestId: string;
  projectId: string;
  chapterId: string;
  taskRole: "writer";
  conversationHistory: [];
  tokenBudget: number;
  reservedOutputTokens: number;
  modelContextWindowTokens: number;
  modelMaxOutputTokens: number;
  tokenEstimate: number;
  layers: WriterContextLayer[];
}

export interface ChapterContextManifestService {
  freeze(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    projectId: string;
    chapterId: string;
    manifestId: string;
    tokenBudget: number;
    reservedOutputTokens: number;
  }): Promise<CommandResult>;
  get(input: { projectId: string; manifestId: string }): Promise<WriterContextManifest | null>;
}

/**
 * Writer 上下文的唯一组装点。它采取封闭白名单：不枚举项目的所有文档，
 * 也不查询 reference/analysis 表；因此参考原文、书名、证据和 provenance
 * 无法通过“遗漏的过滤条件”流入 Writer。
 */
export function createChapterContextManifestService(options: {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  modelResolver?: ModelResolver;
}): ChapterContextManifestService {
  return {
    async freeze(input) {
      assertId(input.projectId, "projectId");
      assertId(input.chapterId, "chapterId");
      assertId(input.manifestId, "manifestId");
      assertBudget(input.tokenBudget, input.reservedOutputTokens);
      await assertProject(options.driver, input.projectId);

      const chapterContract = await requiredDocument(options.driver, input.projectId, planningDocumentId(input.projectId, "chapter_contract", input.chapterId), "chapter_contract", "ChapterContract");
      const storyContract = await requiredDocument(options.driver, input.projectId, planningDocumentId(input.projectId, "story_contract"), "story_contract", "StoryContract");
      const storySystem = await requiredDocument(options.driver, input.projectId, planningDocumentId(input.projectId, "story_system"), "story_system", "StorySystem");
      const recipe = await requiredDocument(options.driver, input.projectId, `production:creative_recipe:${input.chapterId}`, "creative_recipe", "CreativeRecipe");
      assertRecipe(recipe.payload, input.chapterId);
      if (recipe.payload.chapterContractRevision !== chapterContract.revision) throw new Error("CreativeRecipe 与当前 ChapterContract revision 不一致，必须重新冻结配方。 ");
      const inputDependencies = await recipeInputDependencies(options.driver, recipe.artifactId, recipe.revision);

      const layers: WriterContextLayer[] = [
        { name: "chapter_contract", required: true, documentIds: [chapterContract.documentId], value: chapterContract.payload },
        { name: "story_contract_and_system", required: true, documentIds: [storyContract.documentId, storySystem.documentId], value: { storyContract: storyContract.payload, storySystem: storySystem.payload } },
        { name: "canon_and_character", required: false, documentIds: [], value: await projectTruth(options.driver, input.projectId) },
        { name: "recent_accepted_text", required: false, documentIds: [], value: await recentAcceptedText(options.driver, options.objects, input.projectId, Number(chapterContract.payload.ordinal)) },
        { name: "reader_state_and_promises", required: false, documentIds: [], value: await readerView(options.driver, input.projectId) },
        { name: "creative_recipe", required: true, documentIds: [recipe.documentId], value: recipe.payload },
      ];
      assertWriterSafe(layers);
      if (!options.modelResolver) throw new Error("Writer ContextManifest 没有可用的 ModelResolver；拒绝冻结。 ");
      const route = await options.modelResolver.resolve({ role: "writer", complexity: "complex" });
      const tokenBudget = Math.min(input.tokenBudget, route.contextWindowTokens);
      const reservedOutputTokens = Math.min(input.reservedOutputTokens, route.maxOutputTokens);
      assertBudget(tokenBudget, reservedOutputTokens);
      const selectedLayers = selectLayersForBudget(layers, tokenBudget, reservedOutputTokens);
      assertWriterSafe(selectedLayers);
      const manifest: WriterContextManifest = {
        schema_version: 1,
        kind: "chapter_context_manifest",
        manifestId: input.manifestId,
        projectId: input.projectId,
        chapterId: input.chapterId,
        taskRole: "writer",
        conversationHistory: [],
        tokenBudget,
        reservedOutputTokens,
        modelContextWindowTokens: route.contextWindowTokens,
        modelMaxOutputTokens: route.maxOutputTokens,
        tokenEstimate: 0,
        layers: selectedLayers,
      };
      manifest.tokenEstimate = estimateTokens(JSON.stringify(manifest.layers));
      if (manifest.tokenEstimate + reservedOutputTokens > tokenBudget) throw new Error("ContextManifest 超出有效模型 token 预算，拒绝调用 Writer。 ");
      const object = await options.objects.put({ content: encoder.encode(JSON.stringify(manifest)), mediaType: "application/vnd.ainovr.chapter-context-manifest+json" });
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        tool: "commit_project_planning_document",
        args: {
          projectId: input.projectId,
          documentId: manifestDocumentId(input.manifestId),
          documentType: "context_manifest",
          status: "frozen",
          expectedRevision: null,
          payload: {
            schema_version: 1,
            kind: "context_manifest",
            manifestId: input.manifestId,
            chapterId: input.chapterId,
            taskRole: "writer",
            tokenBudget,
            reservedOutputTokens,
            modelContextWindowTokens: route.contextWindowTokens,
            modelMaxOutputTokens: route.maxOutputTokens,
            tokenEstimate: manifest.tokenEstimate,
            contextObjectHash: object.sha256,
          },
          dependencies: [
            { artifactId: `document:${storyContract.documentId}`, revision: storyContract.revision },
            { artifactId: `document:${storySystem.documentId}`, revision: storySystem.revision },
            { artifactId: `document:${chapterContract.documentId}`, revision: chapterContract.revision },
            { artifactId: `document:${recipe.documentId}`, revision: recipe.revision },
            ...inputDependencies,
          ],
          rawOutput: object,
        },
      });
    },

    async get(input) {
      assertId(input.projectId, "projectId");
      assertId(input.manifestId, "manifestId");
      const document = await optionalDocument(options.driver, input.projectId, manifestDocumentId(input.manifestId));
      if (!document) return null;
      if (document.stale) return null;
      if (document.documentType !== "context_manifest" || document.contentObjectHash === null) throw new Error("ContextManifest 文档损坏。 ");
      const parsed = parseManifest(decoder.decode(await options.objects.read(document.contentObjectHash)));
      if (parsed.projectId !== input.projectId || parsed.manifestId !== input.manifestId) throw new Error("ContextManifest 与请求不匹配。 ");
      return parsed;
    },
  };
}

/**
 * Optional truth is deliberately selected, rather than making a mature project
 * unwritable.  The selection is stable and the manifest records every omitted
 * count, so a writer run can be reproduced and audited without silently
 * changing the source of truth.
 */
function selectLayersForBudget(layers: WriterContextLayer[], tokenBudget: number, reservedOutputTokens: number): WriterContextLayer[] {
  const selected = layers.map((layer) => layer.required ? layer : emptyOptionalLayer(layer));
  const fits = () => estimateTokens(JSON.stringify(selected)) + reservedOutputTokens <= tokenBudget;
  if (!fits()) throw new Error("ContextManifest 的必需规划层超出 token 预算，无法安全调用 Writer。 ");

  for (const original of layers) {
    if (original.required) continue;
    const target = selected.find((layer) => layer.name === original.name)!;
    if (original.name === "recent_accepted_text") {
      const text = asRecord(original.value).text;
      if (typeof text !== "string" || !text) continue;
      const documentId = asRecord(original.value).documentId;
      const maximum = largestFittingText(text, (candidate) => {
        target.value = { documentId: typeof documentId === "string" ? documentId : null, text: candidate, selection: { strategy: "latest_accepted_text_tail", truncated: candidate.length < text.length } };
        return fits();
      });
      target.value = { documentId: typeof documentId === "string" ? documentId : null, text: maximum, selection: { strategy: "latest_accepted_text_tail", truncated: (maximum?.length ?? 0) < text.length } };
      continue;
    }
    const source = asRecord(original.value);
    const keys = original.name === "canon_and_character" ? ["canon", "characterKnowledge"] : ["readerStates", "readerPromises"];
    const pools = keys.map((key) => Array.isArray(source[key]) ? [...source[key] as unknown[]] : []);
    const ordered = pools.map((pool) => pool.sort(compareByRevisionThenId));
    const included = keys.map(() => [] as unknown[]);
    const candidates = ordered.flatMap((pool, index) => pool.map((item) => ({ index, item })));
    for (const candidate of candidates) {
      included[candidate.index].push(candidate.item);
      target.value = selectedCollectionValue(keys, included, ordered, original.name);
      if (!fits()) included[candidate.index].pop();
    }
    target.value = selectedCollectionValue(keys, included, ordered, original.name);
  }
  return selected;
}

function emptyOptionalLayer(layer: WriterContextLayer): WriterContextLayer {
  if (layer.name === "recent_accepted_text") return { ...layer, value: { documentId: null, text: null, selection: { strategy: "latest_accepted_text_tail", truncated: false } } };
  const source = layer.name === "canon_and_character" ? ["canon", "characterKnowledge"] : ["readerStates", "readerPromises"];
  return { ...layer, value: selectedCollectionValue(source, source.map(() => []), source.map(() => []), layer.name) };
}

function selectedCollectionValue(keys: string[], included: unknown[][], all: unknown[][], layerName: WriterContextLayerName): RecordValue {
  const value: RecordValue = { selection: { strategy: "revision_desc_then_id", omitted: Object.fromEntries(keys.map((key, index) => [key, all[index].length - included[index].length])), layer: layerName } };
  keys.forEach((key, index) => { value[key] = included[index]; });
  return value;
}

function compareByRevisionThenId(left: unknown, right: unknown): number {
  const a = asRecord(left); const b = asRecord(right);
  const revision = Number(b.revision ?? 0) - Number(a.revision ?? 0);
  if (revision !== 0) return revision;
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

function largestFittingText(text: string, fits: (candidate: string) => boolean): string | null {
  if (fits(text)) return text;
  let low = 0; let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(text.slice(-middle))) low = middle;
    else high = middle - 1;
  }
  return low > 0 ? text.slice(-low) : null;
}

function asRecord(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

interface ProjectDocument {
  documentId: string;
  artifactId: string;
  documentType: string;
  status: string;
  revision: number;
  stale: boolean;
  payload: RecordValue;
  contentObjectHash: string | null;
}

function manifestDocumentId(manifestId: string): string {
  return `production:context_manifest:${manifestId}`;
}

async function requiredDocument(driver: SqlDriver, projectId: string, documentId: string, type: string, label: string): Promise<ProjectDocument> {
  const document = await optionalDocument(driver, projectId, documentId);
  if (!document || document.documentType !== type || document.stale || (document.status !== "approved" && document.status !== "frozen" && document.status !== "canonical")) throw new Error(`${label} 不存在、已过期或尚未批准，无法构建 Writer ContextManifest。`);
  return document;
}

async function optionalDocument(driver: SqlDriver, projectId: string, documentId: string): Promise<ProjectDocument | null> {
  const rows = await driver.query<{ document_id: string; artifact_id: string; document_type: string; status: string; current_revision: number; payload_json: string; content_object_hash: string | null; stale: number }>({
    sql: `
      SELECT doc.document_id, doc.artifact_id, doc.document_type, doc.status, artifact.current_revision, revision.payload_json, revision.content_object_hash,
             CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      WHERE doc.project_id = ? AND doc.document_id = ?
    `,
    params: [projectId, documentId],
  });
  const row = rows[0];
  return row ? { documentId: row.document_id, artifactId: row.artifact_id, documentType: row.document_type, status: row.status, revision: row.current_revision, stale: row.stale === 1, payload: parseRecord(row.payload_json, "项目文档 payload"), contentObjectHash: row.content_object_hash } : null;
}

async function recipeInputDependencies(driver: SqlDriver, artifactId: string, revision: number): Promise<Array<{ artifactId: string; revision: number }>> {
  const rows = await driver.query<{ depends_on_artifact_id: string; depends_on_revision: number }>({
    sql: `SELECT depends_on_artifact_id, depends_on_revision
          FROM artifact_dependencies
          WHERE artifact_id = ? AND revision = ?
            AND (depends_on_artifact_id LIKE 'mechanism:%' OR depends_on_artifact_id LIKE 'document:production:chapter_mechanism_application:%')
            AND stale = 0
          ORDER BY depends_on_artifact_id ASC`,
    params: [artifactId, revision],
  });
  return rows.map((row) => ({ artifactId: row.depends_on_artifact_id, revision: row.depends_on_revision }));
}

async function assertProject(driver: SqlDriver, projectId: string): Promise<void> {
  const rows = await driver.query<{ project_id: string }>({ sql: "SELECT project_id FROM novel_projects WHERE project_id = ?", params: [projectId] });
  if (rows.length !== 1) throw new Error("原创 Project 不存在。 ");
}

async function projectTruth(driver: SqlDriver, projectId: string): Promise<RecordValue> {
  const [canon, knowledge] = await Promise.all([
    driver.query<{ canon_entry_id: string; payload_json: string; revision: number }>({ sql: "SELECT canon_entry_id, payload_json, revision FROM canon_entries WHERE project_id = ? AND status IN ('approved', 'canonical') ORDER BY canon_entry_id", params: [projectId] }),
    driver.query<{ knowledge_id: string; character_id: string; payload_json: string; revision: number }>({ sql: "SELECT knowledge_id, character_id, payload_json, revision FROM character_knowledge WHERE project_id = ? ORDER BY character_id, knowledge_id", params: [projectId] }),
  ]);
  return {
    canon: canon.map((item) => ({ id: item.canon_entry_id, revision: item.revision, value: parseRecord(item.payload_json, "Canon payload") })),
    characterKnowledge: knowledge.map((item) => ({ id: item.knowledge_id, characterId: item.character_id, revision: item.revision, value: parseRecord(item.payload_json, "CharacterKnowledge payload") })),
  };
}

async function recentAcceptedText(driver: SqlDriver, objects: ObjectStore, projectId: string, targetOrdinal: number): Promise<RecordValue> {
  const rows = await driver.query<{ document_id: string; content_object_hash: string | null }>({
    sql: `
      SELECT doc.document_id, revision.content_object_hash
      FROM project_documents doc
      INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
      INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
      INNER JOIN chapters chapter ON chapter.chapter_id = doc.chapter_id
      WHERE doc.project_id = ? AND doc.document_type = 'chapter_text' AND doc.status = 'accepted' AND chapter.ordinal < ?
      ORDER BY chapter.ordinal DESC, doc.document_id DESC LIMIT 1
    `,
    params: [projectId, targetOrdinal],
  });
  const row = rows[0];
  if (!row || !row.content_object_hash) return { documentId: null, text: null };
  return { documentId: row.document_id, text: decoder.decode(await objects.read(row.content_object_hash)) };
}

async function readerView(driver: SqlDriver, projectId: string): Promise<RecordValue> {
  const [states, promises] = await Promise.all([
    driver.query<{ reader_state_id: string; payload_json: string; revision: number }>({ sql: "SELECT reader_state_id, payload_json, revision FROM reader_states WHERE project_id = ? ORDER BY created_at, reader_state_id", params: [projectId] }),
    driver.query<{ reader_promise_id: string; payload_json: string; status: string; revision: number }>({ sql: "SELECT reader_promise_id, payload_json, status, revision FROM reader_promises WHERE project_id = ? ORDER BY created_at, reader_promise_id", params: [projectId] }),
  ]);
  return {
    readerStates: states.map((item) => ({ id: item.reader_state_id, revision: item.revision, value: parseRecord(item.payload_json, "ReaderState payload") })),
    readerPromises: promises.map((item) => ({ id: item.reader_promise_id, status: item.status, revision: item.revision, value: parseRecord(item.payload_json, "ReaderPromise payload") })),
  };
}

function assertRecipe(payload: RecordValue, chapterId: string): void {
  if (payload.schema_version !== 1 || payload.kind !== "creative_recipe" || payload.chapterId !== chapterId || !Number.isInteger(payload.chapterContractRevision) || !Array.isArray(payload.writerMechanisms) || !Array.isArray(payload.editorMechanisms)) throw new Error("CreativeRecipe 不完整，拒绝构建 Writer ContextManifest。 ");
  const selection = [payload.applicationId, payload.applicationRevision, payload.mechanismAssetId, payload.mechanismRevision];
  if (selection.some((value) => value === undefined) || (selection.some((value) => value === null) && selection.some((value) => value !== null))) throw new Error("CreativeRecipe 的本章采用记录冻结不完整，拒绝构建 Writer ContextManifest。 ");
  const serialized = JSON.stringify({ writerMechanisms: payload.writerMechanisms, editorMechanisms: payload.editorMechanisms });
  if (/"(?:source|provenance|evidence|span|analysisProjectId)"/i.test(serialized)) throw new Error("CreativeRecipe 包含来源侧字段，拒绝构建 Writer ContextManifest。 ");
}

/** Every Writer layer is treated as an untrusted projection until it passes
 * this common source-side redaction gate.  Planning/Canon payloads are user
 * authored JSON, so limiting table reads alone is insufficient. */
function assertWriterSafe(value: unknown): void {
  const forbidden = new Set(["source", "reference", "referencetitle", "provenance", "evidence", "span", "analysisprojectid", "originaltext", "excerpt"]);
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(visit); return; }
    if (typeof current === "string" && /(?:参考作品|原文摘录|provenance|sourcehash|exacttexthash|spanid|analysisprojectid|《[^》]+》)/i.test(current)) throw new Error("Writer ContextManifest 含来源侧文本值，拒绝冻结。 ");
    if (!current || typeof current !== "object") return;
    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      if (forbidden.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) throw new Error("Writer ContextManifest 包含参考侧字段，拒绝冻结。 ");
      visit(nested);
    }
  };
  visit(value);
}

function parseManifest(value: string): WriterContextManifest {
  const manifest = parseRecord(value, "ContextManifest") as Partial<WriterContextManifest>;
  if (manifest.schema_version !== 1 || manifest.kind !== "chapter_context_manifest" || manifest.taskRole !== "writer" || !Array.isArray(manifest.conversationHistory) || manifest.conversationHistory.length !== 0 || !Array.isArray(manifest.layers)) throw new Error("ContextManifest 对象损坏。 ");
  return manifest as WriterContextManifest;
}

function estimateTokens(value: string): number {
  let total = 0;
  let latinRun = 0;
  for (const char of value) {
    if (/^[\u3400-\u9fff\uff00-\uffef]$/u.test(char)) {
      total += 1;
      latinRun = 0;
    } else {
      latinRun += 1;
      if (latinRun === 4) { total += 1; latinRun = 0; }
    }
  }
  return total + (latinRun > 0 ? 1 : 0) + 32;
}

function parseRecord(value: string, label: string): RecordValue {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as RecordValue;
  } catch {
    throw new Error(`${label} 不是 JSON 对象。`);
  }
}

function assertBudget(tokenBudget: number, reservedOutputTokens: number): void {
  if (!Number.isInteger(tokenBudget) || tokenBudget < 2 || !Number.isInteger(reservedOutputTokens) || reservedOutputTokens < 1 || reservedOutputTokens >= tokenBudget) throw new Error("ContextManifest token 预算非法。 ");
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}
