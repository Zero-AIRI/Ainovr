// ============================================
// 文风提取 — 客户端编排模块
// ============================================

import {
  buildStyleExtractionMessages,
  buildStyleSupplementMessages,
} from '@/lib/ai/prompts';
import { computeMaxCharsPerBatch, splitIntoBatches } from '@/lib/analysis-chunker';
import type { SemanticSlice } from '@/types';

/** 获取首批文风提取的请求体 */
export function getStyleExtractionRequestBody(
  slices: SemanticSlice[],
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const slicesText = slices.map((s) => `### ${s.title}\n\n${s.content}`).join('\n\n');
  const { systemPrompt, userMessage } = buildStyleExtractionMessages(slicesText);

  return {
    systemPrompt,
    userMessage,
    apiKey,
    model,
    baseURL,
  };
}

/** 获取补充批次的请求体（用于多批处理） */
export function getStyleSupplementRequestBody(
  newChunk: string,
  previousProfile: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const { systemPrompt, userMessage } = buildStyleSupplementMessages(newChunk, previousProfile);
  return {
    systemPrompt,
    userMessage,
    apiKey,
    model,
    baseURL,
  };
}

/**
 * 计算文风提取是否需要分批
 * 返回 null 表示无需分批，否则返回分批信息
 */
export function computeStyleBatches(
  slices: SemanticSlice[],
  maxContextTokens: number,
): { needsBatch: boolean; batches: string[] } {
  const fullText = slices.map((s) => `### ${s.title}\n\n${s.content}`).join('\n\n');
  const maxChars = computeMaxCharsPerBatch(maxContextTokens);

  if (fullText.length <= maxChars) {
    return { needsBatch: false, batches: [fullText] };
  }

  return {
    needsBatch: true,
    batches: splitIntoBatches(fullText, maxChars),
  };
}
