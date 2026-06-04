// ============================================
// 情节规律提取 — 客户端编排模块
// ============================================

import {
  buildPlotExtractionMessages,
  buildPlotSupplementMessages,
} from '@/lib/ai/prompts';
import { computeMaxCharsPerBatch, splitIntoBatches } from '@/lib/analysis-chunker';
import type { SemanticSlice } from '@/types';

/** 获取首批情节提取的请求体 */
export function getPlotExtractionRequestBody(
  slices: SemanticSlice[],
  styleProfile: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const slicesText = slices.map((s) => `### ${s.title}\n\n${s.content}`).join('\n\n');
  const { systemPrompt, userMessage } = buildPlotExtractionMessages(slicesText, styleProfile);

  return {
    systemPrompt,
    userMessage,
    apiKey,
    model,
    baseURL,
  };
}

/** 获取补充批次的请求体 */
export function getPlotSupplementRequestBody(
  newChunk: string,
  previousReport: string,
  styleProfile: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const { systemPrompt, userMessage } = buildPlotSupplementMessages(newChunk, previousReport, styleProfile);
  return {
    systemPrompt,
    userMessage,
    apiKey,
    model,
    baseURL,
  };
}

/**
 * 计算情节提取是否需要分批
 */
export function computePlotBatches(
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
