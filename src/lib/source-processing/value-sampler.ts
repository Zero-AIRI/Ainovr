// ============================================
// 价值采样器 — 从事件图谱选取核心切片
// 不平均采样，按叙事价值选取 30-50 个
// ============================================

import type { EventGraph, NovelEvent, SemanticSlice, TextChunk } from '@/types';

/** 采样配置 */
export interface ValueSamplingConfig {
  maxSamples: number;            // 最大采样数（默认 50）
  climaxRatio: number;           // 高潮占比
  turningPointRatio: number;     // 转折点占比
  foreshadowingRatio: number;    // 伏笔-回收对占比
  breathRatio: number;           // 呼吸段落占比
  userAnchorCount: number;       // 用户锚点数量
}

const DEFAULT_CONFIG: ValueSamplingConfig = {
  maxSamples: 50,
  climaxRatio: 0.30,
  turningPointRatio: 0.20,
  foreshadowingRatio: 0.25,
  breathRatio: 0.15,
  userAnchorCount: 5,
};

/** 采样结果 */
export interface ValueSamplingResult {
  selectedSliceIndices: number[];    // 选中的切片索引
  samplingRationale: string;         // 采样理由摘要
  byCategory: Record<string, number[]>; // 按类别的切片索引
}

/** 事件图谱的高潮转折类型集合 */
const CLIMAX_TYPES = new Set(['战斗/冲突', '突破/升级', '死亡/牺牲', '揭露/发现']);
const TURNING_TYPES = new Set(['背叛/决裂', '决策/选择', '离别/重逢', '结盟/合作']);
const BREATH_TYPES = new Set(['日常/过渡']);

/**
 * 从事件图谱中执行价值采样
 * @param eventGraph 事件图谱
 * @param slices 原始切片（SemanticSlice[]）
 * @param config 采样配置
 * @param userAnchorSliceIndices 用户标注的锚点切片索引
 */
export function sampleByValue(
  eventGraph: EventGraph,
  slices: SemanticSlice[],
  config: Partial<ValueSamplingConfig> = {},
  userAnchorSliceIndices: number[] = [],
): ValueSamplingResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const events = eventGraph.events;
  const selected = new Set<number>();
  const byCategory: Record<string, number[]> = {
    climax: [],
    turning: [],
    foreshadowing: [],
    breath: [],
    userAnchor: [],
  };

  // ── 1. 高潮点 ──
  const climaxEvents = events
    .filter((e) => CLIMAX_TYPES.has(e.type) || Math.abs(e.tensionChange) >= 3)
    .sort((a, b) => b.confidence - a.confidence || Math.abs(b.tensionChange) - Math.abs(a.tensionChange));

  const climaxCount = Math.floor(cfg.maxSamples * cfg.climaxRatio);
  for (const e of climaxEvents.slice(0, climaxCount)) {
    const sliceIdx = findSliceIndex(e, slices);
    if (sliceIdx >= 0 && !selected.has(sliceIdx)) {
      selected.add(sliceIdx);
      byCategory.climax.push(sliceIdx);
    }
  }

  // ── 2. 转折点 ──
  const turningEvents = events
    .filter((e) => TURNING_TYPES.has(e.type))
    .sort((a, b) => b.confidence - a.confidence);

  const turningCount = Math.floor(cfg.maxSamples * cfg.turningPointRatio);
  for (const e of turningEvents.slice(0, turningCount)) {
    const sliceIdx = findSliceIndex(e, slices);
    if (sliceIdx >= 0 && !selected.has(sliceIdx)) {
      selected.add(sliceIdx);
      byCategory.turning.push(sliceIdx);
    }
  }

  // ── 3. 伏笔-回收对 ──
  const foreshadowCount = Math.floor(cfg.maxSamples * cfg.foreshadowingRatio);
  const pairs = eventGraph.foreshadowingPairs
    .filter((p) => p.distance > 5) // 只取长程伏笔
    .sort((a, b) => b.distance - a.distance);

  for (const pair of pairs.slice(0, Math.ceil(foreshadowCount / 2))) {
    const setupEvent = events.find((e) => e.id === pair.setup);
    const payoffEvent = events.find((e) => e.id === pair.payoff);
    for (const e of [setupEvent, payoffEvent]) {
      if (!e) continue;
      const sliceIdx = findSliceIndex(e, slices);
      if (sliceIdx >= 0 && !selected.has(sliceIdx)) {
        selected.add(sliceIdx);
        byCategory.foreshadowing.push(sliceIdx);
      }
    }
  }

  // ── 4. 呼吸段落 ──
  const breathCount = Math.floor(cfg.maxSamples * cfg.breathRatio);
  const breathEvents = events
    .filter((e) => BREATH_TYPES.has(e.type) || (Math.abs(e.tensionChange) <= 1 && !CLIMAX_TYPES.has(e.type)))
    .sort((a, b) => a.chapter - b.chapter); // 均匀分布在时间线上

  if (breathEvents.length > 0) {
    const step = Math.max(1, Math.floor(breathEvents.length / breathCount));
    for (let i = 0; i < breathEvents.length && byCategory.breath.length < breathCount; i += step) {
      const sliceIdx = findSliceIndex(breathEvents[i], slices);
      if (sliceIdx >= 0 && !selected.has(sliceIdx)) {
        selected.add(sliceIdx);
        byCategory.breath.push(sliceIdx);
      }
    }
  }

  // ── 5. 用户锚点 ──
  for (const idx of userAnchorSliceIndices.slice(0, cfg.userAnchorCount)) {
    if (idx >= 0 && idx < slices.length && !selected.has(idx)) {
      selected.add(idx);
      byCategory.userAnchor.push(idx);
    }
  }

  // ── 补充未达标 ──
  if (selected.size < cfg.maxSamples * 0.6) {
    // 按置信度随机补充
    const remaining = events
      .filter((e) => !selected.has(findSliceIndex(e, slices)))
      .sort((a, b) => b.confidence - a.confidence);

    for (const e of remaining) {
      if (selected.size >= cfg.maxSamples) break;
      const sliceIdx = findSliceIndex(e, slices);
      if (sliceIdx >= 0 && !selected.has(sliceIdx)) {
        selected.add(sliceIdx);
      }
    }
  }

  const rationale = `价值采样：高潮${byCategory.climax.length}个 + 转折${byCategory.turning.length}个 + 伏笔对${byCategory.foreshadowing.length}个 + 呼吸${byCategory.breath.length}个 + 用户锚点${byCategory.userAnchor.length}个 = 共${selected.size}个切片`;

  return {
    selectedSliceIndices: [...selected].sort((a, b) => a - b),
    samplingRationale: rationale,
    byCategory,
  };
}

/** 从事件找到对应的切片索引 */
function findSliceIndex(event: NovelEvent, slices: SemanticSlice[]): number {
  // 通过 chunkIndex 映射：事件所在 chunk 对应切片
  const ratio = event.chunkIndex / Math.max(1, slices.length);
  const estimatedSlice = Math.floor(ratio * slices.length);
  // 就近搜索带匹配角色引用的切片
  const searchStart = Math.max(0, estimatedSlice - 3);
  const searchEnd = Math.min(slices.length - 1, estimatedSlice + 3);

  for (let i = searchStart; i <= searchEnd; i++) {
    const slice = slices[i];
    if (slice && event.participants.some((p) => slice.characterRefs?.includes(p))) {
      return i;
    }
  }

  return estimatedSlice >= 0 && estimatedSlice < slices.length ? estimatedSlice : -1;
}
