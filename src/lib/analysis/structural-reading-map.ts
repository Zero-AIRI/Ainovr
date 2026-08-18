export interface StructuralReadingMapSpan {
  spanId: string;
  kind: string;
  startByte: number;
  endByte: number;
}

export interface StructuralReadingMapUnitInput {
  analysisUnitId: string;
  ordinal: number;
  startByte: number;
  endByte: number;
  spans: StructuralReadingMapSpan[];
}

export interface StructuralReadingMapInput {
  analysisProjectId: string;
  sourceEditionId: string;
  segmentationId: string;
  sourceHash: string;
  createdAt: number;
  units: StructuralReadingMapUnitInput[];
}

export interface StructuralReadingMap {
  schema_version: 1;
  kind: "structural_reading_map";
  analysisProjectId: string;
  sourceEditionId: string;
  segmentationId: string;
  sourceHash: string;
  createdAt: number;
  totalUnits: number;
  totalSpans: number;
  /** 结构地图不从元数据猜测人物、事件或作者意图，明确记录为尚未观察。 */
  candidateStatus: "not_observed";
  units: Array<{
    analysisUnitId: string;
    ordinal: number;
    startByte: number;
    endByte: number;
    spanCount: number;
    spanKinds: Record<string, number>;
  }>;
}

/**
 * 由冻结的 AnalysisCorpus 元数据派生 ReadingMap 的无文本结构层。
 * 它故意不读取 SourceSpan 正文，也不替模型杜撰实体或叙事结论。
 */
export function buildStructuralReadingMap(input: StructuralReadingMapInput): StructuralReadingMap {
  assertNonEmpty("analysisProjectId", input.analysisProjectId);
  assertNonEmpty("sourceEditionId", input.sourceEditionId);
  assertNonEmpty("segmentationId", input.segmentationId);
  if (!/^[a-f0-9]{64}$/.test(input.sourceHash)) throw new Error("sourceHash 必须是 SHA-256。");
  if (!Number.isInteger(input.createdAt) || input.createdAt < 0) throw new Error("createdAt 必须是非负整数。");
  if (input.units.length === 0) throw new Error("ReadingMap 至少需要一个 AnalysisUnit。");

  const seenUnits = new Set<string>();
  const seenSpans = new Set<string>();
  let totalSpans = 0;
  const units = input.units.map((unit, index) => {
    assertNonEmpty("analysisUnitId", unit.analysisUnitId);
    if (seenUnits.has(unit.analysisUnitId)) throw new Error(`AnalysisUnit 重复：${unit.analysisUnitId}。`);
    seenUnits.add(unit.analysisUnitId);
    if (unit.ordinal !== index + 1) throw new Error("AnalysisUnit ordinal 必须从 1 连续递增。");
    assertRange("AnalysisUnit", unit.startByte, unit.endByte);
    const spanKinds: Record<string, number> = {};
    for (const span of unit.spans) {
      assertNonEmpty("spanId", span.spanId);
      assertNonEmpty("span.kind", span.kind);
      if (seenSpans.has(span.spanId)) throw new Error(`SourceSpan 重复：${span.spanId}。`);
      seenSpans.add(span.spanId);
      assertRange("SourceSpan", span.startByte, span.endByte);
      if (span.startByte < unit.startByte || span.endByte > unit.endByte) throw new Error(`SourceSpan ${span.spanId} 超出所属 AnalysisUnit 范围。`);
      spanKinds[span.kind] = (spanKinds[span.kind] ?? 0) + 1;
      totalSpans += 1;
    }
    return {
      analysisUnitId: unit.analysisUnitId,
      ordinal: unit.ordinal,
      startByte: unit.startByte,
      endByte: unit.endByte,
      spanCount: unit.spans.length,
      spanKinds,
    };
  });

  return {
    schema_version: 1,
    kind: "structural_reading_map",
    analysisProjectId: input.analysisProjectId,
    sourceEditionId: input.sourceEditionId,
    segmentationId: input.segmentationId,
    sourceHash: input.sourceHash,
    createdAt: input.createdAt,
    totalUnits: units.length,
    totalSpans,
    candidateStatus: "not_observed",
    units,
  };
}

function assertNonEmpty(label: string, value: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}

function assertRange(label: string, startByte: number, endByte: number): void {
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte) || startByte < 0 || endByte < startByte) {
    throw new Error(`${label} 的 UTF-8 字节范围非法。`);
  }
}
