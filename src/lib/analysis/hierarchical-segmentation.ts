import type { SourceDocument, SourceSpan } from "./types";

export interface SegmentationPolicy {
  hierarchy: ["volume", "chapter", "scene", "chunk"];
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginRatio: number;
  overlapSpanCount: number;
  /** 系列实体版不用“第一卷”时，由运行前结构预览显式确认的卷标题前缀。 */
  volumeTitlePrefixes?: string[];
}

export type StructuralLevel = "book" | "volume" | "chapter" | "scene" | "chunk";

export interface SegmentationStructureNode {
  id: string;
  level: Exclude<StructuralLevel, "chunk">;
  parentId?: string;
  title?: string;
  spanIds: string[];
}

export interface HierarchicalComputeUnit {
  id: string;
  kind: "compute_container";
  structuralLevel: StructuralLevel;
  structuralNodeId?: string;
  requiresExtraction: true;
  primarySpanIds: string[];
  contextBeforeSpanIds: string[];
  contextAfterSpanIds: string[];
  startOffset: number;
  endOffset: number;
  estimatedInputTokens: number;
  budgetExceeded: boolean;
}

export interface SegmentationTrace {
  tokenCountMode: "estimated";
  estimator: "cjk_ascii_calibrated_v1";
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginRatio: number;
  inputBudgetTokens: number;
  overflowUnitIds: string[];
}

export interface HierarchicalSegmentationResult {
  structure: SegmentationStructureNode[];
  computeUnits: HierarchicalComputeUnit[];
  trace: SegmentationTrace;
}

const VOLUME_HEADING = /^第[零〇一二三四五六七八九十百千万两\d]+[卷部](?:[\s·:：]+.*)?$/;
const CHAPTER_HEADING = /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节回篇集幕](?:[\s·:：]+.*)?|序\s*[章幕](?:\s+.*)?|楔子(?:\s+.*)?|引子(?:\s+.*)?|尾\s*声(?:\s+.*)?|后记(?:\s+.*)?)$/;

/**
 * 先按可观察的卷/章/分隔符建立结构，再只对超出 provider 输入预算的叶组降级为
 * 物理 chunk。结构节点不是文学解释，compute unit 也不声称自己是叙事弧。
 */
export function buildHierarchicalSegmentation(
  document: SourceDocument,
  policy: SegmentationPolicy,
): HierarchicalSegmentationResult {
  const inputBudgetTokens = validateAndComputeBudget(policy);
  const structure = buildStructure(document, policy);
  const trace: SegmentationTrace = {
    tokenCountMode: "estimated",
    estimator: "cjk_ascii_calibrated_v1",
    contextWindowTokens: policy.contextWindowTokens,
    reservedOutputTokens: policy.reservedOutputTokens,
    safetyMarginRatio: policy.safetyMarginRatio,
    inputBudgetTokens,
    overflowUnitIds: [],
  };
  if (document.spans.length === 0) return { structure, computeUnits: [], trace };

  const totalTokens = estimateSpanTokens(document.spans);
  const groups = totalTokens <= inputBudgetTokens
    ? [{ spans: document.spans, level: "book" as StructuralLevel, structuralNodeId: structure[0]?.id }]
    : buildBoundaryGroups(document.spans, structure, policy);
  const primaryGroups: Array<{ spans: SourceSpan[]; level: StructuralLevel; structuralNodeId?: string }> = [];

  for (const group of groups) {
    if (estimateSpanTokens(group.spans) <= inputBudgetTokens) {
      primaryGroups.push(group);
      continue;
    }
    for (const chunk of splitToBudget(group.spans, inputBudgetTokens)) {
      primaryGroups.push({ spans: chunk, level: "chunk", structuralNodeId: group.structuralNodeId });
    }
  }

  const indexById = new Map(document.spans.map((span, index) => [span.id, index]));
  const computeUnits = primaryGroups.map((group, index): HierarchicalComputeUnit => {
    const first = group.spans[0];
    const last = group.spans[group.spans.length - 1];
    const firstIndex = indexById.get(first.id)!;
    const lastIndex = indexById.get(last.id)!;
    const estimatedInputTokens = estimateSpanTokens(group.spans);
    const unit: HierarchicalComputeUnit = {
      id: `hu_${document.analysisVersion.slice(0, 12)}_${String(index + 1).padStart(5, "0")}`,
      kind: "compute_container",
      structuralLevel: group.level,
      ...(group.structuralNodeId ? { structuralNodeId: group.structuralNodeId } : {}),
      requiresExtraction: true,
      primarySpanIds: group.spans.map((span) => span.id),
      contextBeforeSpanIds: document.spans
        .slice(Math.max(0, firstIndex - policy.overlapSpanCount), firstIndex)
        .map((span) => span.id),
      contextAfterSpanIds: document.spans
        .slice(lastIndex + 1, lastIndex + policy.overlapSpanCount + 1)
        .map((span) => span.id),
      startOffset: first.startOffset,
      endOffset: last.endOffset,
      estimatedInputTokens,
      budgetExceeded: estimatedInputTokens > inputBudgetTokens,
    };
    if (unit.budgetExceeded) trace.overflowUnitIds.push(unit.id);
    return unit;
  });

  const primaryIds = computeUnits.flatMap((unit) => unit.primarySpanIds);
  if (primaryIds.length !== document.spans.length
    || primaryIds.some((id, index) => id !== document.spans[index].id)) {
    throw new Error("层级切片 span coverage 不完整或顺序发生变化");
  }
  return { structure, computeUnits, trace };
}

function validateAndComputeBudget(policy: SegmentationPolicy): number {
  if (policy.hierarchy.join("/") !== "volume/chapter/scene/chunk") throw new Error("hierarchy 必须为 volume/chapter/scene/chunk");
  if (!Number.isInteger(policy.contextWindowTokens) || policy.contextWindowTokens <= 0) throw new Error("contextWindowTokens 必须是正整数");
  if (!Number.isInteger(policy.reservedOutputTokens) || policy.reservedOutputTokens < 0 || policy.reservedOutputTokens >= policy.contextWindowTokens) {
    throw new Error("reservedOutputTokens 必须小于上下文预算");
  }
  if (!Number.isFinite(policy.safetyMarginRatio) || policy.safetyMarginRatio < 0 || policy.safetyMarginRatio >= 1) throw new Error("safetyMarginRatio 必须在 [0, 1) 内");
  if (!Number.isInteger(policy.overlapSpanCount) || policy.overlapSpanCount < 0) throw new Error("overlapSpanCount 必须是非负整数");
  const budget = Math.floor((policy.contextWindowTokens - policy.reservedOutputTokens) * (1 - policy.safetyMarginRatio));
  if (budget <= 0) throw new Error("可用输入预算为零");
  return budget;
}

function buildStructure(document: SourceDocument, policy: SegmentationPolicy): SegmentationStructureNode[] {
  const nodes: SegmentationStructureNode[] = [{ id: "book", level: "book", title: document.title, spanIds: [] }];
  let volume: SegmentationStructureNode | undefined;
  let chapter: SegmentationStructureNode | undefined;
  let scene: SegmentationStructureNode | undefined;
  let volumeCount = 0;
  let chapterCount = 0;
  let sceneCount = 0;
  const seenVolumeTitles = new Set<string>();

  const addSpan = (span: SourceSpan) => {
    nodes[0].spanIds.push(span.id);
    volume?.spanIds.push(span.id);
    chapter?.spanIds.push(span.id);
    scene?.spanIds.push(span.id);
  };
  for (const span of document.spans) {
    const volumeTitleKey = normalizeVolumeTitle(span.text);
    if (isVolumeHeading(span.text, policy) && !seenVolumeTitles.has(volumeTitleKey)) {
      seenVolumeTitles.add(volumeTitleKey);
      volumeCount += 1;
      volume = { id: `volume_${volumeCount}`, level: "volume", parentId: "book", title: span.text, spanIds: [] };
      nodes.push(volume);
      chapter = undefined;
      scene = undefined;
    } else if (span.kind === "chapter_heading" && CHAPTER_HEADING.test(span.text)) {
      chapterCount += 1;
      chapter = { id: `chapter_${chapterCount}`, level: "chapter", parentId: volume?.id ?? "book", title: span.text, spanIds: [] };
      nodes.push(chapter);
      scene = undefined;
    } else if (span.kind === "separator") {
      sceneCount += 1;
      scene = { id: `scene_${sceneCount}`, level: "scene", parentId: chapter?.id ?? volume?.id ?? "book", spanIds: [] };
      nodes.push(scene);
    } else if (!scene) {
      sceneCount += 1;
      scene = { id: `scene_${sceneCount}`, level: "scene", parentId: chapter?.id ?? volume?.id ?? "book", spanIds: [] };
      nodes.push(scene);
    }
    addSpan(span);
  }
  return nodes;
}

function buildBoundaryGroups(
  spans: SourceSpan[],
  structure: SegmentationStructureNode[],
  policy: SegmentationPolicy,
): Array<{ spans: SourceSpan[]; level: StructuralLevel; structuralNodeId?: string }> {
  const groups: Array<{ spans: SourceSpan[]; level: StructuralLevel; structuralNodeId?: string }> = [];
  // 每个 span 只归属于至多 book/volume/chapter/scene 四层。预先记录其最深节点，
  // 避免长文本在每次 flush 时再次扫描所有结构节点与其 spanIds（此前这里是 O(n²)）。
  const deepestStructureBySpanId = new Map<string, { id: string; rank: number }>();
  for (let rank = 0; rank < structure.length; rank += 1) {
    const node = structure[rank];
    for (const spanId of node.spanIds) deepestStructureBySpanId.set(spanId, { id: node.id, rank });
  }
  let current: SourceSpan[] = [];
  let level: StructuralLevel = "book";
  let deepestRank = -1;
  let structuralNodeId: string | undefined;
  const seenVolumeTitles = new Set<string>();
  const flush = () => {
    if (!current.length) return;
    groups.push({ spans: current, level, ...(structuralNodeId ? { structuralNodeId } : {}) });
    current = [];
    deepestRank = -1;
    structuralNodeId = undefined;
  };
  for (const span of spans) {
    const volumeTitleKey = normalizeVolumeTitle(span.text);
    const newVolume = isVolumeHeading(span.text, policy) && !seenVolumeTitles.has(volumeTitleKey);
    if (newVolume) seenVolumeTitles.add(volumeTitleKey);
    const boundaryLevel = newVolume
      ? "volume"
      : span.kind === "chapter_heading" && CHAPTER_HEADING.test(span.text)
        ? "chapter"
        : span.kind === "separator" ? "scene" : undefined;
    if (boundaryLevel && current.length) flush();
    if (boundaryLevel) level = boundaryLevel;
    current.push(span);
    const structural = deepestStructureBySpanId.get(span.id);
    if (structural && structural.rank > deepestRank) {
      deepestRank = structural.rank;
      structuralNodeId = structural.id;
    }
  }
  flush();
  return groups;
}

function normalizeVolumeTitle(text: string): string {
  const roman: Record<string, string> = { VIII: "Ⅷ", VII: "Ⅶ", VI: "Ⅵ", IV: "Ⅳ", III: "Ⅲ", II: "Ⅱ", IX: "Ⅸ", V: "Ⅴ", X: "Ⅹ", I: "Ⅰ" };
  return text.trim().replace(/[：:]/g, "·").replace(/(VIII|VII|VI|IV|III|II|IX|V|X|I)(?=·)/g, (value) => roman[value] ?? value);
}

function isVolumeHeading(text: string, policy: SegmentationPolicy): boolean {
  if (VOLUME_HEADING.test(text)) return true;
  return (policy.volumeTitlePrefixes ?? []).some((prefix) => {
    const value = prefix.trim();
    if (!value || !text.startsWith(value)) return false;
    const rest = text.slice(value.length);
    return /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX\d]+)?[·:：][^。！？]{2,40}$/.test(rest);
  });
}

function splitToBudget(spans: SourceSpan[], budget: number): SourceSpan[][] {
  const chunks: SourceSpan[][] = [];
  let current: SourceSpan[] = [];
  let tokens = 0;
  for (const span of spans) {
    const spanTokens = estimateTextTokens(span.text);
    if (current.length && tokens + spanTokens > budget) {
      chunks.push(current);
      current = [];
      tokens = 0;
    }
    current.push(span);
    tokens += spanTokens;
    if (tokens > budget) {
      chunks.push(current);
      current = [];
      tokens = 0;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function estimateSpanTokens(spans: readonly SourceSpan[]): number {
  return spans.reduce((sum, span) => sum + estimateTextTokens(span.text), 0);
}

/** 无 tokenizer 时的保守校准估算：CJK/全角按约 1 token，连续 ASCII 按约 4 字符。 */
function estimateTextTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii));
}
