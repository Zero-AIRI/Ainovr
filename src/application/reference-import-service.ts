import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import { createNormalizedSourceView } from "@/lib/analysis/normalization";
import { utf8ByteOffsetsByUtf16Boundary } from "@/lib/analysis/utf8-byte-boundaries";
import { utf8RangeAtCharacterBoundaries } from "@/lib/analysis/utf8-byte-boundaries";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface ImportReferenceTextInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  referenceWorkId: string;
  sourceEditionId: string;
  title: string;
  /** 明确由调用者提供的单份参考文本；不提供任意路径读取。 */
  text: string;
  /** 文件导入任务通过同一领域事务提交参考作品与任务终态。 */
  task?: { taskId: string; hostId: string };
}

export interface ReferenceWorkView {
  referenceWorkId: string;
  title: string;
  sourceEditionId: string;
  rawObjectHash: string;
  normalizedObjectHash: string;
  sourceHash: string;
  normalizedByteLength: number;
  tokenEstimate: number;
  normalizationMapObjectHash: string;
}

export interface ReferenceExcerptInput {
  sourceEditionId: string;
  startByte: number;
  endByte: number;
}

export interface ReferenceTextSearchInput {
  /** 必须是已登记 SourceEdition，不能传对象 hash 或文件路径。 */
  sourceEditionId: string;
  /** 调用者已知的短文本锚点；结果只返回位置，绝不回显周边原文。 */
  query: string;
  /** 限制返回结果，防止把此入口变成整本枚举工具。 */
  limit: number;
}

export interface ReferenceImportService {
  importText(input: ImportReferenceTextInput): Promise<CommandResult>;
  listReferenceWorks(): Promise<ReferenceWorkView[]>;
  getReferenceWork(referenceWorkId: string): Promise<ReferenceWorkView | null>;
  getExcerpt(input: ReferenceExcerptInput): Promise<{ text: string; startByte: number; endByte: number }>;
  findText(input: ReferenceTextSearchInput): Promise<Array<{ startByte: number; endByte: number }>>;
}

export interface CreateReferenceImportServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  now?: () => number;
}

/**
 * V2 参考文本入口：原文只进对象库，SQLite 仅保存 hash、字节区间及定位映射的对象引用。
 * 该服务不接受路径，因此 MCP/CLI 不会获得任意文件读取能力。
 */
export function createReferenceImportService(options: CreateReferenceImportServiceOptions): ReferenceImportService {
  return {
    async importText(input) {
      assertTextInput(input);
      const normalized = createNormalizedSourceView(input.text);
      const raw = await options.objects.put({ content: encoder.encode(input.text), mediaType: "text/plain; charset=utf-8" });
      const normalizedObject = await options.objects.put({ content: encoder.encode(normalized.text), mediaType: "text/plain; charset=utf-8" });
      const normalizationMap = await options.objects.put({
        content: encoder.encode(JSON.stringify(createNormalizationMap(input.text, normalized.text, normalized.originalOffsetByNormalizedBoundary))),
        mediaType: "application/vnd.ainovr.normalization-map+json",
      });
      return options.commands.execute({
        ...input.command,
        tool: "import_reference_text",
        // 原文和规范化文本只存在 ObjectStore；命令日志不保存它们。
        args: {
          referenceWorkId: input.referenceWorkId,
          sourceEditionId: input.sourceEditionId,
          title: input.title,
          raw,
          normalized: normalizedObject,
          normalizationMap,
          sourceHash: normalizedObject.sha256,
          tokenEstimate: estimateTokens(normalized.text),
          ...(input.task ? { task: input.task } : {}),
        },
      });
    },

    async listReferenceWorks() {
      const rows = await options.driver.query<{ reference_work_id: string }>({
        sql: "SELECT reference_work_id FROM reference_works ORDER BY updated_at DESC, reference_work_id ASC",
        params: [],
      });
      const references = await Promise.all(rows.map((row) => readReferenceWork(options.driver, row.reference_work_id)));
      return references.filter((reference): reference is ReferenceWorkView => reference !== null);
    },

    getReferenceWork(referenceWorkId) { return readReferenceWork(options.driver, referenceWorkId); },

    async getExcerpt(input) {
      if (!Number.isInteger(input.startByte) || !Number.isInteger(input.endByte) || input.startByte < 0 || input.endByte < input.startByte) {
        throw new Error("原文摘录字节区间非法。");
      }
      const rows = await options.driver.query<{ normalized_object_hash: string; byte_length: number }>({
        sql: "SELECT normalized_object_hash, byte_length FROM source_editions WHERE source_edition_id = ?",
        params: [input.sourceEditionId],
      });
      const edition = rows[0];
      if (!edition) throw new Error("SourceEdition 不存在。");
      if (input.endByte > edition.byte_length) throw new Error("原文摘录字节区间越界。");
      const bytes = await options.objects.read(edition.normalized_object_hash);
      const excerpt = bytes.slice(input.startByte, input.endByte);
      let text: string;
      try {
        text = decoder.decode(excerpt);
      } catch {
        throw new Error("原文摘录必须位于 UTF-8 字符边界。");
      }
      if (encoder.encode(text).byteLength !== excerpt.byteLength) throw new Error("原文摘录必须位于 UTF-8 字符边界。");
      return { text, startByte: input.startByte, endByte: input.endByte };
    },

    async findText(input) {
      if (!input.sourceEditionId.trim()) throw new Error("sourceEditionId 必须是非空字符串。 ");
      if (!input.query.trim() || input.query.length > 512) throw new Error("query 必须是 1 至 512 个字符的非空字符串。 ");
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error("limit 必须是 1 至 50 的整数。 ");
      const rows = await options.driver.query<{ normalized_object_hash: string }>({
        sql: "SELECT normalized_object_hash FROM source_editions WHERE source_edition_id = ?",
        params: [input.sourceEditionId],
      });
      const edition = rows[0];
      if (!edition) throw new Error("SourceEdition 不存在。 ");
      let source: string;
      try { source = decoder.decode(await options.objects.read(edition.normalized_object_hash)); } catch { throw new Error("SourceEdition 规范化对象无效。 "); }
      const matches: Array<{ startByte: number; endByte: number }> = [];
      let searchStart = 0;
      while (matches.length < input.limit) {
        const index = source.indexOf(input.query, searchStart);
        if (index < 0) break;
        matches.push(utf8RangeAtCharacterBoundaries(source, index, index + input.query.length));
        searchStart = index + input.query.length;
      }
      return matches;
    },
  };
}

async function readReferenceWork(driver: SqlDriver, referenceWorkId: string): Promise<ReferenceWorkView | null> {
  const rows = await driver.query<{
    reference_work_id: string; title: string; source_edition_id: string; raw_object_hash: string; normalized_object_hash: string; source_hash: string; byte_length: number; token_estimate: number; locator_json: string;
  }>({
    sql: `SELECT r.reference_work_id, r.title, e.source_edition_id, e.raw_object_hash, e.normalized_object_hash, e.source_hash, e.byte_length, e.token_estimate, l.locator_json
          FROM reference_works r
          INNER JOIN source_editions e ON e.reference_work_id = r.reference_work_id
          INNER JOIN source_locations l ON l.source_edition_id = e.source_edition_id AND l.source_location_id = ('normalization-map:' || e.source_edition_id)
          WHERE r.reference_work_id = ?`,
    params: [referenceWorkId],
  });
  const row = rows[0];
  if (!row) return null;
  const locator = parseNormalizationLocator(row.locator_json);
  return {
    referenceWorkId: row.reference_work_id,
    title: row.title,
    sourceEditionId: row.source_edition_id,
    rawObjectHash: row.raw_object_hash,
    normalizedObjectHash: row.normalized_object_hash,
    sourceHash: row.source_hash,
    normalizedByteLength: row.byte_length,
    tokenEstimate: row.token_estimate,
    normalizationMapObjectHash: locator.objectHash,
  };
}

function assertTextInput(input: ImportReferenceTextInput): void {
  for (const [key, value] of [["referenceWorkId", input.referenceWorkId], ["sourceEditionId", input.sourceEditionId], ["title", input.title]] as const) {
    if (!value.trim()) throw new Error(`${key} 必须是非空字符串。`);
  }
  if (input.text.length === 0) throw new Error("参考文本不能为空。");
}

function createNormalizationMap(original: string, normalized: string, originalOffsetByNormalizedBoundary: number[]) {
  const originalUtf8Offsets = utf8ByteOffsetsByUtf16Boundary(original);
  const normalizedUtf8Offsets = utf8ByteOffsetsByUtf16Boundary(normalized);
  return {
    schema_version: 1,
    kind: "utf8_normalization_boundary_map",
    normalizedUtf8Offsets,
    originalUtf8Offsets: originalOffsetByNormalizedBoundary.map((offset) => originalUtf8Offsets[offset]),
  };
}

function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(ascii / 4 + nonAscii / 1.5));
}

function parseNormalizationLocator(value: string): { objectHash: string } {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("规范化位置映射索引损坏。");
  const objectHash = (parsed as Record<string, unknown>).objectHash;
  if (typeof objectHash !== "string" || !/^[a-f0-9]{64}$/.test(objectHash)) throw new Error("规范化位置映射对象引用无效。");
  return { objectHash };
}
