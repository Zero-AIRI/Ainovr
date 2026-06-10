// ============================================
// 势能追踪器 — 客户端编排模块
// 追踪"积累→释放"周期，分析势能模式与呼吸节奏
// ============================================

import { buildTensionTrackingMessages } from '@/lib/ai/prompts';
import type { SemanticSlice, TensionPattern, TensionAnalysis, TensionAnchor, RhythmProfile, ExperienceCurve } from '@/types';

const VALID_CLIMAX_TYPES: ReadonlySet<string> = new Set(['emotional', 'cognitive', 'power', 'identity', 'relationship']);
const VALID_PAYOFFS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'extreme']);

/** 构建势能追踪请求体 */
export function getTensionTrackingRequestBody(
  slices: SemanticSlice[],
  plotReport: string,
  experienceCurve: ExperienceCurve[],
  apiKey: string,
  model: string,
  baseURL: string,
) {
  // 切片摘要（只传关键元数据，不传全文以节省 token）
  const slicesSummary = slices.map((s) =>
    `[${s.index}] ${s.title} | 标签: ${s.semanticTags.join(',')} | 弧线: ${s.plotArc} | 情绪: ${s.emotionalTone} | 叙事功能: ${s.narrativeFunction} | 紧张度: ${s.tensionLevel}`
  ).join('\n');

  const experienceCurveJson = JSON.stringify(
    experienceCurve.map((c) => ({
      sliceIndex: c.sliceIndex,
      immersion: c.avgImmersion,
      emotionalIntensity: c.avgEmotionalIntensity,
      anticipation: c.avgAnticipation,
      pace: c.dominantPace,
      isHighPoint: c.highPoints,
    })),
    null, 2
  );

  const { systemPrompt, userMessage } = buildTensionTrackingMessages(slicesSummary, plotReport, experienceCurveJson);
  return { systemPrompt, userMessage, apiKey, model, baseURL };
}

/** 解析势能追踪 AI 输出 */
export function parseTensionAnalysis(raw: string, slices: SemanticSlice[]): TensionAnalysis | null {
  try {
    // 尝试提取 JSON 块
    const jsonMatch = raw.match(/\{[\s\S]*"rhythmProfile"[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const patterns: TensionPattern[] = (Array.isArray(parsed.patterns) ? parsed.patterns : [])
      .filter((p: Record<string, unknown>) =>
        typeof p.climaxType === 'string' && VALID_CLIMAX_TYPES.has(p.climaxType) &&
        typeof p.climaxSliceIndex === 'number' &&
        typeof p.startSliceIndex === 'number' &&
        typeof p.duration === 'number')
      .map((p: Record<string, unknown>, index: number) => ({
        id: `tension-${index}`,
        climaxType: p.climaxType as TensionPattern['climaxType'],
        startIndex: Number(p.startSliceIndex),
        duration: Number(p.duration),
        reinforcements: Array.isArray(p.reinforcements)
          ? p.reinforcements.map((r: Record<string, unknown>): TensionAnchor => ({
            sliceId: slices[Number(r.sliceIndex)]?.id ?? '',
            sliceIndex: Number(r.sliceIndex),
            chapter: slices[Number(r.sliceIndex)]?.chapterRange ?? '',
            type: 'reinforcement' as const,
            description: String(r.description ?? ''),
            tensionBefore: Math.min(10, Math.max(1, Number(r.tensionBefore ?? 5))),
            tensionAfter: Math.min(10, Math.max(1, Number(r.tensionAfter ?? 7))),
          }))
          : [],
        release: {
          sliceId: slices[Number(p.climaxSliceIndex)]?.id ?? '',
          sliceIndex: Number(p.climaxSliceIndex),
          chapter: slices[Number(p.climaxSliceIndex)]?.chapterRange ?? '',
          type: 'release' as const,
          description: String(p.climaxDescription ?? ''),
          tensionBefore: 9,
          tensionAfter: 3,
        },
        payoffMultiplier: VALID_PAYOFFS.has(String(p.payoffMultiplier)) ? String(p.payoffMultiplier) as TensionPattern['payoffMultiplier'] : 'medium',
        description: String(p.climaxDescription ?? ''),
      }));

    const rhythmProfile: RhythmProfile = {
      propulsionRatio: Number(parsed.rhythmProfile?.propulsionRatio ?? 0),
      buildupRatio: Number(parsed.rhythmProfile?.buildupRatio ?? 0),
      releaseRatio: Number(parsed.rhythmProfile?.releaseRatio ?? 0),
      breathRatio: Number(parsed.rhythmProfile?.breathRatio ?? 0),
      existenceRatio: Number(parsed.rhythmProfile?.existenceRatio ?? 0),
      calibrationRatio: Number(parsed.rhythmProfile?.calibrationRatio ?? 0),
    };

    return {
      patterns,
      breathingCycle: String(parsed.breathingCycle ?? '未知'),
      rhythmProfile,
    };
  } catch {
    return null;
  }
}
