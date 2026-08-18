import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import { buildHierarchicalSegmentation } from "@/lib/analysis/hierarchical-segmentation";
import { calculateSourceInputBudget, type SourceTokenBudgetInput } from "@/lib/analysis/source-token-budget";
import { createSourceDocument } from "@/lib/analysis/source-document";
import { utf8ByteOffsetsByUtf16Boundary } from "@/lib/analysis/utf8-byte-boundaries";
import { sha256Hex } from "@/lib/sha256";
import type { CorpusBoundary } from "@/lib/analysis/types";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";
import type { ModelResolver } from "@/application/model-resolver";

const decoder = new TextDecoder("utf-8", { fatal: true });

export interface PrepareAnalysisCorpusInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  analysisProjectId: string;
  segmentationId: string;
  sourceEditionId: string;
  boundary: CorpusBoundary;
  /** 将完整 SourceEdition 中已确认的卷/片段冻结为分析范围，区间仍指向原始规范化 UTF-8 对象。 */
  byteRange?: { startByte: number; endByte: number };
  budget: SourceTokenBudgetInput;
}

export interface AnalysisCorpusOverview {
  analysisProjectId: string;
  sourceEditionId: string;
  segmentationId: string;
  sourceInputBudgetTokens: number;
  spanCount: number;
  computeUnits: Array<{ analysisUnitId: string; ordinal: number; startByte: number; endByte: number }>;
}

export interface StoredSourceSpanView {
  spanId: string;
  sourceEditionId: string;
  analysisUnitId: string;
  startByte: number;
  endByte: number;
  sourceHash: string;
  exactTextHash: string;
  text: string;
  locator: Record<string, unknown>;
}

export interface AnalysisCorpusService {
  prepare(input: PrepareAnalysisCorpusInput): Promise<CommandResult>;
  getOverview(analysisProjectId: string): Promise<AnalysisCorpusOverview | null>;
  getSourceSpan(spanId: string): Promise<StoredSourceSpanView | null>;
}

export interface CreateAnalysisCorpusServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  /** 若已组装路由，FactExtractor 的有效模型预算是唯一上限；调用方不能伪造更大的窗口。 */
  modelResolver?: ModelResolver;
  now?: () => number;
}

/**
 * 将已导入 SourceEdition 冻结成 V2 AnalysisCorpus。文本切片始终转换为
 * normalized UTF-8 半开 byte range，模型输入预算则完全由 Provider 参数动态推导。
 */
export function createAnalysisCorpusService(options: CreateAnalysisCorpusServiceOptions): AnalysisCorpusService {
  return {
    async prepare(input) {
      assertPrepareInput(input);
      const source = await readSourceEdition(options.driver, input.sourceEditionId);
      if (!source) throw new Error("SourceEdition 不存在。");
      const sourceBytes = await options.objects.read(source.normalizedObjectHash);
      const sourceSlice = sourceTextSlice(sourceBytes, input.byteRange);
      const text = sourceSlice.text;
      const budgetInput = options.modelResolver ? await boundedBudget(options.modelResolver, input.budget) : input.budget;
      const budget = calculateSourceInputBudget(budgetInput);
      const document = await createSourceDocument({ sourceId: source.sourceEditionId, title: source.title, text, boundary: input.boundary });
      if (!input.byteRange && document.sourceHash !== source.sourceHash) throw new Error("规范化 SourceEdition hash 校验失败。");
      const segmentation = buildHierarchicalSegmentation(document, {
        hierarchy: ["volume", "chapter", "scene", "chunk"],
        contextWindowTokens: budget.sourceInputBudgetTokens,
        reservedOutputTokens: 0,
        safetyMarginRatio: 0,
        overlapSpanCount: 1,
      });
      // SourceSpan 与计算单元共用同一段 normalized 文本。预先建立边界索引，
      // 不能在每个 span 转换时重扫整段文本，否则长篇会退化为 O(n²)。
      const utf8Offsets = utf8ByteOffsetsByUtf16Boundary(text);
      const analysisUnits = segmentation.computeUnits.map((unit, index) => ({
        analysisUnitId: `${input.segmentationId}:unit:${String(index + 1).padStart(5, "0")}`,
        ordinal: index + 1,
        ...offsetByteRange(utf8RangeFromOffsets(utf8Offsets, unit.startOffset, unit.endOffset), sourceSlice.startByte),
        primarySpanIds: unit.primarySpanIds,
      }));
      const unitBySpanId = new Map(analysisUnits.flatMap((unit) => unit.primarySpanIds.map((spanId) => [spanId, unit.analysisUnitId] as const)));
      const spans = document.spans.map((span) => {
        const bytes = offsetByteRange(utf8RangeFromOffsets(utf8Offsets, span.startOffset, span.endOffset), sourceSlice.startByte);
        const analysisUnitId = unitBySpanId.get(span.id);
        if (!analysisUnitId) throw new Error(`SourceSpan ${span.id} 没有主计算单元。`);
        return {
          // 同一完整 SourceEdition 可被多个已确认的卷/片段 Corpus 引用；范围版必须把 span ID
          // 置于 segmentation 命名空间，避免覆盖已有分析版本的不可变证据记录。
          spanId: `${input.segmentationId}:${span.id}`,
          analysisUnitId,
          ...bytes,
          sourceHash: source.sourceHash,
          exactTextHash: sha256Hex(span.text),
          locator: {
            schema_version: 1,
            kind: span.kind,
            ordinal: span.ordinal,
            ...(span.chapterIndex === undefined ? {} : { chapterIndex: span.chapterIndex }),
            ...(span.sectionIndex === undefined ? {} : { sectionIndex: span.sectionIndex }),
            normalizedStartUtf16: sourceSlice.startUtf16 + span.startOffset,
            normalizedEndUtf16: sourceSlice.startUtf16 + span.endOffset,
          },
        };
      });
      return options.commands.execute({
        ...input.command,
        tool: "create_analysis_corpus",
        args: {
          analysisProjectId: input.analysisProjectId,
          segmentationId: input.segmentationId,
          sourceEditionId: input.sourceEditionId,
          segmentation: {
            schema_version: 1,
            boundary: input.boundary,
            sourceHash: source.sourceHash,
            ...(input.byteRange ? { byteRange: { ...input.byteRange } } : {}),
            budget: {
              ...budget,
              contextWindowTokens: budgetInput.contextWindowTokens,
              safetyMarginRatio: budgetInput.safetyMarginRatio,
              reservedOutputTokens: budgetInput.reservedOutputTokens,
              renderedSystemPromptTokens: budgetInput.renderedSystemPromptTokens,
              renderedSchemaTokens: budgetInput.renderedSchemaTokens,
              envelopeTokens: budgetInput.envelopeTokens,
            },
            structure: segmentation.structure.map(({ id, level, parentId, title, spanIds }) => ({ id, level, ...(parentId ? { parentId } : {}), ...(title ? { title } : {}), spanIds })),
            computeUnits: segmentation.computeUnits.map((unit) => ({ id: unit.id, structuralLevel: unit.structuralLevel, primarySpanIds: unit.primarySpanIds, contextBeforeSpanIds: unit.contextBeforeSpanIds, contextAfterSpanIds: unit.contextAfterSpanIds, estimatedInputTokens: unit.estimatedInputTokens })),
            trace: segmentation.trace,
          },
          units: analysisUnits.map(({ analysisUnitId, ordinal, startByte, endByte }) => ({ analysisUnitId, ordinal, startByte, endByte })),
          spans,
        },
      });
    },

    async getOverview(analysisProjectId) {
      const projects = await options.driver.query<{ analysis_project_id: string; source_edition_id: string; segmentation_id: string; payload_json: string }>({
        sql: `SELECT p.analysis_project_id, p.source_edition_id, p.segmentation_id, s.payload_json
              FROM analysis_projects p INNER JOIN analysis_segmentations s ON s.segmentation_id = p.segmentation_id
              WHERE p.analysis_project_id = ?`,
        params: [analysisProjectId],
      });
      const project = projects[0];
      if (!project) return null;
      const payload = parseSegmentationPayload(project.payload_json);
      const [units, spans] = await Promise.all([
        options.driver.query<{ analysis_unit_id: string; ordinal: number; start_byte: number; end_byte: number }>({ sql: "SELECT analysis_unit_id, ordinal, start_byte, end_byte FROM analysis_units WHERE segmentation_id = ? ORDER BY ordinal ASC", params: [project.segmentation_id] }),
        options.driver.query<{ count: number }>({
          sql: `SELECT COUNT(*) AS count
                FROM source_spans span
                INNER JOIN analysis_units unit ON unit.analysis_unit_id = span.analysis_unit_id
                WHERE unit.segmentation_id = ? AND span.source_edition_id = ?`,
          params: [project.segmentation_id, project.source_edition_id],
        }),
      ]);
      return {
        analysisProjectId: project.analysis_project_id,
        sourceEditionId: project.source_edition_id,
        segmentationId: project.segmentation_id,
        sourceInputBudgetTokens: payload.sourceInputBudgetTokens,
        spanCount: spans[0]?.count ?? 0,
        computeUnits: units.map((unit) => ({ analysisUnitId: unit.analysis_unit_id, ordinal: unit.ordinal, startByte: unit.start_byte, endByte: unit.end_byte })),
      };
    },

    async getSourceSpan(spanId) {
      const rows = await options.driver.query<{
        span_id: string; source_edition_id: string; analysis_unit_id: string; start_byte: number; end_byte: number; source_hash: string; exact_text_hash: string; locator_json: string; normalized_object_hash: string;
      }>({
        sql: `SELECT sp.span_id, sp.source_edition_id, sp.analysis_unit_id, sp.start_byte, sp.end_byte, sp.source_hash, sp.exact_text_hash, sp.locator_json, e.normalized_object_hash
              FROM source_spans sp INNER JOIN source_editions e ON e.source_edition_id = sp.source_edition_id WHERE sp.span_id = ?`,
        params: [spanId],
      });
      const row = rows[0];
      if (!row || !row.analysis_unit_id) return null;
      const bytes = await options.objects.read(row.normalized_object_hash);
      const slice = bytes.slice(row.start_byte, row.end_byte);
      const text = decoder.decode(slice);
      if (sha256Hex(text) !== row.exact_text_hash) throw new Error("SourceSpan exactTextHash 校验失败。");
      return {
        spanId: row.span_id,
        sourceEditionId: row.source_edition_id,
        analysisUnitId: row.analysis_unit_id,
        startByte: row.start_byte,
        endByte: row.end_byte,
        sourceHash: row.source_hash,
        exactTextHash: row.exact_text_hash,
        text,
        locator: parseRecord(row.locator_json),
      };
    },
  };
}

async function readSourceEdition(driver: SqlDriver, sourceEditionId: string): Promise<{ sourceEditionId: string; title: string; normalizedObjectHash: string; sourceHash: string } | null> {
  const rows = await driver.query<{ source_edition_id: string; title: string; normalized_object_hash: string; source_hash: string }>({
    sql: `SELECT e.source_edition_id, r.title, e.normalized_object_hash, e.source_hash
          FROM source_editions e INNER JOIN reference_works r ON r.reference_work_id = e.reference_work_id
          WHERE e.source_edition_id = ?`,
    params: [sourceEditionId],
  });
  const source = rows[0];
  return source ? { sourceEditionId: source.source_edition_id, title: source.title, normalizedObjectHash: source.normalized_object_hash, sourceHash: source.source_hash } : null;
}

function assertPrepareInput(input: PrepareAnalysisCorpusInput): void {
  for (const [key, value] of [["analysisProjectId", input.analysisProjectId], ["segmentationId", input.segmentationId], ["sourceEditionId", input.sourceEditionId]] as const) {
    if (!value.trim()) throw new Error(`${key} 必须是非空字符串。`);
  }
  if (input.boundary !== "complete" && input.boundary !== "volume" && input.boundary !== "fragment") throw new Error("boundary 非法。");
  if (!input.byteRange) return;
  const { startByte, endByte } = input.byteRange;
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte) || startByte < 0 || endByte <= startByte) throw new Error("byteRange 必须是非空、非负的 UTF-8 半开字节区间。 ");
}

function sourceTextSlice(sourceBytes: Uint8Array, byteRange: PrepareAnalysisCorpusInput["byteRange"]): { text: string; startByte: number; startUtf16: number } {
  if (!byteRange) return { text: decoder.decode(sourceBytes), startByte: 0, startUtf16: 0 };
  if (byteRange.endByte > sourceBytes.byteLength) throw new Error("byteRange 超出 SourceEdition 边界。 ");
  let prefix: string;
  let text: string;
  try {
    prefix = decoder.decode(sourceBytes.slice(0, byteRange.startByte));
    text = decoder.decode(sourceBytes.slice(byteRange.startByte, byteRange.endByte));
  } catch {
    throw new Error("byteRange 必须位于规范化 UTF-8 字符边界。 ");
  }
  return { text, startByte: byteRange.startByte, startUtf16: prefix.length };
}

function offsetByteRange(range: { startByte: number; endByte: number }, offset: number): { startByte: number; endByte: number } {
  return { startByte: range.startByte + offset, endByte: range.endByte + offset };
}

/**
 * 与 utf8RangeAtCharacterBoundaries 保持相同的边界契约，只是复用调用方已建立的
 * UTF-16→UTF-8 索引。null 表示落在 surrogate pair 中间，必须 fail closed。
 */
function utf8RangeFromOffsets(offsets: ReadonlyArray<number | null>, startOffset: number, endOffset: number): { startByte: number; endByte: number } {
  const textLength = offsets.length - 1;
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset < startOffset || endOffset > textLength) {
    throw new Error("文本偏移范围越界。");
  }
  const startByte = offsets[startOffset];
  const endByte = offsets[endOffset];
  if (startByte === null || endByte === null || startByte === undefined || endByte === undefined) throw new Error("文本偏移必须位于 UTF-8 字符边界。");
  return { startByte, endByte };
}

function parseSegmentationPayload(value: string): { sourceInputBudgetTokens: number } {
  const record = parseRecord(value);
  const budget = record.budget;
  if (!budget || typeof budget !== "object" || Array.isArray(budget) || !Number.isInteger((budget as Record<string, unknown>).sourceInputBudgetTokens)) throw new Error("AnalysisSegmentation payload 损坏。");
  return { sourceInputBudgetTokens: (budget as Record<string, number>).sourceInputBudgetTokens };
}

async function boundedBudget(modelResolver: ModelResolver, requested: SourceTokenBudgetInput): Promise<SourceTokenBudgetInput> {
  const route = await modelResolver.resolve({ role: "fact_extractor", complexity: "routine" });
  return {
    contextWindowTokens: Math.min(requested.contextWindowTokens, route.contextWindowTokens),
    safetyMarginRatio: Math.max(requested.safetyMarginRatio, route.safetyMarginRatio),
    // 输出预留是模型真实最大输出的硬保留，调用方不能通过传 0 把输出空间挪给原文。
    reservedOutputTokens: Math.max(requested.reservedOutputTokens, route.maxOutputTokens),
    renderedSystemPromptTokens: requested.renderedSystemPromptTokens,
    renderedSchemaTokens: requested.renderedSchemaTokens,
    envelopeTokens: requested.envelopeTokens,
  };
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON payload 损坏。");
  return parsed as Record<string, unknown>;
}
