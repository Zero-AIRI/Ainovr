// ============================================
// 消融测试器 — 客户端编排模块
// "删掉这段会失去什么？"四分类判定
// ============================================

import { buildAblationTestingMessages } from '@/lib/ai/prompts';
import { computeMaxCharsPerBatch } from '@/lib/analysis-chunker';
import type { SemanticSlice, AblationResult, AblationCategory } from '@/types';

const VALID_CATEGORIES: ReadonlySet<string> = new Set(['bone', 'muscle', 'filler_a', 'filler_b', 'uncertain']);

/** 构建消融测试请求体 */
export function getAblationTestingRequestBody(
  slices: SemanticSlice[],
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const slicesJson = slices.map((s) =>
    JSON.stringify({
      sliceId: s.id,
      index: s.index,
      title: s.title,
      semanticTags: s.semanticTags,
      plotArc: s.plotArc,
      emotionalTone: s.emotionalTone,
      narrativeFunction: s.narrativeFunction,
      contentPreview: s.content.slice(0, 800),
      charCount: s.charCount,
    })
  ).join('\n');

  const { systemPrompt, userMessage } = buildAblationTestingMessages(slicesJson);
  return { systemPrompt, userMessage, apiKey, model, baseURL };
}

/** 解析消融测试 AI 输出 */
export function parseAblationResults(raw: string, slices: SemanticSlice[]): AblationResult[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return fallbackResults(slices);
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return fallbackResults(slices);

    // 按 sliceId 建立 slices 索引（AI 输出可能乱序）
    const sliceById = new Map<string, SemanticSlice>();
    const sliceByIndex = new Map<number, SemanticSlice>();
    for (const s of slices) {
      sliceById.set(s.id, s);
      sliceByIndex.set(s.index, s);
    }

    return parsed
      .map((item: Record<string, unknown>) => {
        const category = String(item.category ?? 'uncertain');
        // 优先按 sliceId 匹配，回退到 sliceIndex
        const matchedSlice = (typeof item.sliceId === 'string' && sliceById.get(item.sliceId))
          || sliceByIndex.get(Number(item.sliceIndex ?? 0));
        return {
          sliceId: matchedSlice?.id ?? `unknown-${Number(item.sliceIndex ?? 0)}`,
          sliceIndex: matchedSlice?.index ?? Number(item.sliceIndex ?? 0),
          category: VALID_CATEGORIES.has(category) ? (category as AblationCategory) : 'uncertain',
          lostIfRemoved: String(item.lostIfRemoved ?? '不确定'),
          confidence: Math.min(1, Math.max(0, Number(item.confidence ?? 0.3))),
          reasoning: String(item.reasoning ?? '无法判定'),
        };
      })
      .filter((r: AblationResult) => sliceById.has(r.sliceId) || sliceByIndex.has(r.sliceIndex));
  } catch (err) {
    console.error('消融测试结果解析失败:', err);
    return fallbackResults(slices);
  }
}

/** 当 AI 输出无法解析时的回退结果（全部标记为 uncertain） */
function fallbackResults(slices: SemanticSlice[]): AblationResult[] {
  return slices.map((s) => ({
    sliceId: s.id,
    sliceIndex: s.index,
    category: 'uncertain' as AblationCategory,
    lostIfRemoved: '解析失败，无法判定',
    confidence: 0,
    reasoning: 'AI 输出格式异常，回退为 uncertain',
  }));
}

/** 计算消融测试批次 */
export function computeAblationBatches(
  slices: SemanticSlice[],
  maxContextTokens: number,
): { needsBatch: boolean; sliceGroups: SemanticSlice[][] } {
  const maxChars = computeMaxCharsPerBatch(maxContextTokens);
  const groups: SemanticSlice[][] = [];
  let currentGroup: SemanticSlice[] = [];
  let currentChars = 0;

  // 每切片大约 1000 字符开销（摘要JSON）
  const CHARS_PER_SLICE_OVERHEAD = 1000;

  for (const slice of slices) {
    if (currentChars + CHARS_PER_SLICE_OVERHEAD > maxChars && currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
      currentChars = 0;
    }
    currentGroup.push(slice);
    currentChars += CHARS_PER_SLICE_OVERHEAD;
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  return { needsBatch: groups.length > 1, sliceGroups: groups };
}

/** 聚合消融结果的统计摘要 */
export function summarizeAblationResults(results: AblationResult[]): {
  boneCount: number;
  muscleCount: number;
  fillerACount: number;
  fillerBCount: number;
  uncertainCount: number;
  totalCount: number;
} {
  const counts = { boneCount: 0, muscleCount: 0, fillerACount: 0, fillerBCount: 0, uncertainCount: 0, totalCount: results.length };
  for (const r of results) {
    switch (r.category) {
      case 'bone': counts.boneCount++; break;
      case 'muscle': counts.muscleCount++; break;
      case 'filler_a': counts.fillerACount++; break;
      case 'filler_b': counts.fillerBCount++; break;
      case 'uncertain': counts.uncertainCount++; break;
    }
  }
  return counts;
}
