// ============================================
// 角色动力学 — 客户端编排模块
// ============================================

import {
  buildCharacterDynamicsExtractionMessages,
  buildCharacterDynamicsSupplementMessages,
} from '@/lib/ai/prompts';
import { computeMaxCharsPerBatch, splitIntoBatches } from '@/lib/analysis-chunker';
import type { SemanticSlice } from '@/types';

/** 获取首批角色动力学提取的请求体 */
export function getCharacterDynamicsExtractionRequestBody(
  slices: SemanticSlice[],
  narrativeDynamics: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const slicesText = slices.map((s) => `### ${s.title}\n\n${s.content}`).join('\n\n');
  const { systemPrompt, userMessage } = buildCharacterDynamicsExtractionMessages(slicesText, narrativeDynamics);

  return {
    systemPrompt,
    userMessage,
    apiKey,
    model,
    baseURL,
  };
}

/** 获取补充批次的请求体 */
export function getCharacterDynamicsSupplementRequestBody(
  newChunk: string,
  previousReport: string,
  narrativeDynamics: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const { systemPrompt, userMessage } = buildCharacterDynamicsSupplementMessages(newChunk, previousReport, narrativeDynamics);
  return {
    systemPrompt,
    userMessage,
    apiKey,
    model,
    baseURL,
  };
}

/**
 * 计算角色动力学提取是否需要分批
 */
export function computeCharacterDynamicsBatches(
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
