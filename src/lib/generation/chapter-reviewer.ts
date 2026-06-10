// ============================================
// 章节自动审查 — 5 维度评分
// ============================================

import type { ChapterReview, ReviewDimension } from '@/types';
import { buildChapterReviewMessages, buildChapterRevisionMessages } from '@/lib/ai/prompts';

/** 合法的审查维度集合，用于过滤 LLM 异常输出 */
const VALID_DIMENSIONS: ReadonlySet<string> = new Set([
  'style_consistency',
  'plot_coherence',
  'pacing',
  'pattern_execution',
  'foreshadow_execution',
  'qi_consistency',
]);

/** 解析 AI 审查输出为 ChapterReview[] */
export function parseReviewOutput(raw: string): ChapterReview[] {
  try {
    // 尝试从 markdown 中提取 JSON 块
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: Record<string, unknown>) =>
        item.dimension && typeof item.dimension === 'string' && VALID_DIMENSIONS.has(item.dimension) && typeof item.score === 'number')
      .map((item: Record<string, unknown>, index: number) => ({
        id: `review-${index}`,
        dimension: item.dimension as ReviewDimension,
        score: Math.min(10, Math.max(1, Number(item.score))),
        issues: Array.isArray(item.issues) ? item.issues.map(String) : [],
        suggestions: Array.isArray(item.suggestions) ? item.suggestions.map(String) : [],
        reviewedAt: new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

/**
 * 获取章节审查 API 的请求体
 */
export function getReviewRequestBody(
  chapterContent: string,
  styleGuide: string,
  chapterTask: string,
  apiKey: string,
  model: string,
  baseURL: string,
  daoContext?: string,
) {
  const { systemPrompt, userMessage } = buildChapterReviewMessages(chapterContent, styleGuide, chapterTask, daoContext);
  return { systemPrompt, userMessage, apiKey, model, baseURL, daoContext };
}

/**
 * 获取章节修正 API 的请求体
 */
export function getRevisionRequestBody(
  chapterContent: string,
  reviews: ChapterReview[],
  humanFeedback: string | null,
  styleGuide: string,
  chapterTask: string,
  apiKey: string,
  model: string,
  baseURL: string,
  daoContext?: string,
) {
  const reviewsText = reviews
    .map((r) => `- ${r.dimension}: ${r.score}/10\n  问题: ${r.issues.join('; ') || '无'}\n  建议: ${r.suggestions.join('; ') || '无'}`)
    .join('\n');
  const { systemPrompt, userMessage } = buildChapterRevisionMessages(chapterContent, reviewsText, humanFeedback, styleGuide, chapterTask, daoContext);
  return { systemPrompt, userMessage, apiKey, model, baseURL, daoContext };
}

/**
 * 判断审查是否通过
 * @param reviews 审查结果
 * @param threshold 及格线（默认 7）
 */
export function isReviewPassed(reviews: ChapterReview[], threshold = 7): boolean {
  if (reviews.length === 0) return false;
  return reviews.every((r) => r.score >= threshold);
}
