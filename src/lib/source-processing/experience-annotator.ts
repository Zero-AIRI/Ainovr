// ============================================
// 体验流标注器 — 客户端编排模块
// AI 扮演读者（非批评家），多 reader persona 投票
// ============================================

import { buildExperienceAnnotationMessages, READER_PERSONAS } from '@/lib/ai/prompts';
import { computeMaxCharsPerBatch, splitIntoBatches } from '@/lib/analysis-chunker';
import type { SemanticSlice, ExperienceAnnotation, ExperienceCurve } from '@/types';

/** 构建体验流标注请求体 */
export function getExperienceAnnotationRequestBody(
  slices: SemanticSlice[],
  persona: string,
  personaDescription: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const slicesJson = slices.map((s) =>
    `## 切片 ${s.index}: ${s.title}\n- 语义标签: ${s.semanticTags.join(', ')}\n- 情节弧线: ${s.plotArc}\n- 情绪基调: ${s.emotionalTone}\n\n${s.content.slice(0, 1500)}`
  ).join('\n\n---\n\n');

  const { systemPrompt, userMessage } = buildExperienceAnnotationMessages(slicesJson, persona, personaDescription);
  return { systemPrompt, userMessage, apiKey, model, baseURL };
}

/** 解析体验流标注 AI 输出 */
export function parseExperienceAnnotations(raw: string, slices: SemanticSlice[], persona: string): ExperienceAnnotation[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // 按 sliceId 建立 slices 索引（AI 输出可能乱序）
    const sliceById = new Map<string, SemanticSlice>();
    const sliceByIndex = new Map<number, SemanticSlice>();
    for (const s of slices) {
      sliceById.set(s.id, s);
      sliceByIndex.set(s.index, s);
    }

    return parsed
      .filter((item: Record<string, unknown>) =>
        typeof item.immersion === 'number' &&
        typeof item.emotional_intensity === 'number' &&
        typeof item.anticipation === 'number')
      .map((item: Record<string, unknown>) => {
        // 优先按 sliceId 匹配，回退到位置索引
        const matchedSlice = (typeof item.sliceId === 'string' && sliceById.get(item.sliceId))
          || sliceByIndex.get(Number(item.sliceIndex));
        return {
          sliceId: matchedSlice?.id ?? `unknown-${Number(item.sliceIndex ?? 0)}`,
          sliceIndex: matchedSlice?.index ?? Number(item.sliceIndex ?? 0),
          immersion: Math.min(10, Math.max(1, Math.round(Number(item.immersion)))),
          emotionalIntensity: Math.min(10, Math.max(1, Math.round(Number(item.emotional_intensity)))),
          anticipation: Math.min(10, Math.max(1, Math.round(Number(item.anticipation)))),
          perceivedPace: (['fast', 'medium', 'slow'].includes(String(item.perceived_pace)) ? String(item.perceived_pace) : 'medium') as 'fast' | 'medium' | 'slow',
          confidence: Math.min(1, Math.max(0, Number(item.confidence ?? 0.5))),
          readerPersona: persona,
          notes: String(item.notes ?? ''),
        };
      })
      .filter((ann: ExperienceAnnotation) => sliceById.has(ann.sliceId) || sliceByIndex.has(ann.sliceIndex));
  } catch (err) {
    console.error('体验流标注解析失败:', err);
    return [];
  }
}

/** 聚合多 persona 的标注结果为体验曲线 */
export function aggregateExperienceCurves(
  allAnnotations: ExperienceAnnotation[],
  slices: SemanticSlice[],
): ExperienceCurve[] {
  // 按 sliceId 分组
  const grouped = new Map<string, ExperienceAnnotation[]>();
  for (const ann of allAnnotations) {
    const existing = grouped.get(ann.sliceId) || [];
    existing.push(ann);
    grouped.set(ann.sliceId, existing);
  }

  return slices.map((slice) => {
    const annotations = grouped.get(slice.id) || [];
    if (annotations.length === 0) {
      return {
        sliceId: slice.id,
        sliceIndex: slice.index,
        avgImmersion: 0,
        avgEmotionalIntensity: 0,
        avgAnticipation: 0,
        dominantPace: 'medium' as const,
        scoreSpread: 0,
        highPoints: false,
      };
    }

    const n = annotations.length;
    const avgImmersion = annotations.reduce((s, a) => s + a.immersion, 0) / n;
    const avgEmotionalIntensity = annotations.reduce((s, a) => s + a.emotionalIntensity, 0) / n;
    const avgAnticipation = annotations.reduce((s, a) => s + a.anticipation, 0) / n;

    // 计算标准差（衡量主观性）
    const immersionVariance = annotations.reduce((s, a) => s + (a.immersion - avgImmersion) ** 2, 0) / n;

    // 主导节奏（投票）
    const paceVotes = { fast: 0, medium: 0, slow: 0 };
    for (const a of annotations) { paceVotes[a.perceivedPace]++; }
    const dominantPace = (Object.entries(paceVotes).sort(([, a], [, b]) => b - a)[0][0]) as 'fast' | 'medium' | 'slow';

    return {
      sliceId: slice.id,
      sliceIndex: slice.index,
      avgImmersion: Math.round(avgImmersion * 10) / 10,
      avgEmotionalIntensity: Math.round(avgEmotionalIntensity * 10) / 10,
      avgAnticipation: Math.round(avgAnticipation * 10) / 10,
      dominantPace,
      scoreSpread: Math.round(Math.sqrt(immersionVariance) * 10) / 10,
      highPoints: avgImmersion >= 7 && Math.sqrt(immersionVariance) <= 2,
    };
  });
}

/** 计算体验标注是否需要分批 */
export function computeExperienceBatches(
  slices: SemanticSlice[],
  maxContextTokens: number,
): { needsBatch: boolean; sliceGroups: SemanticSlice[][] } {
  const maxChars = computeMaxCharsPerBatch(maxContextTokens);
  const groups: SemanticSlice[][] = [];
  let currentGroup: SemanticSlice[] = [];
  let currentChars = 0;

  for (const slice of slices) {
    const sliceChars = slice.content.length + 200; // 标题+标签开销
    if (currentChars + sliceChars > maxChars && currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
      currentChars = 0;
    }
    currentGroup.push(slice);
    currentChars += sliceChars;
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  return { needsBatch: groups.length > 1, sliceGroups: groups };
}
