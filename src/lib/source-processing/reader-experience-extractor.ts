// ============================================
// 读者体验模型 — 客户端编排模块
// ============================================

import {
  buildReaderExperienceExtractionMessages,
  buildReaderExperienceSupplementMessages,
} from '@/lib/ai/prompts';
import { computeMaxCharsPerBatch, splitIntoBatches } from '@/lib/analysis-chunker';
import type { SemanticSlice } from '@/types';

/** 获取首批读者体验提取的请求体 */
export function getReaderExperienceExtractionRequestBody(
  slices: SemanticSlice[],
  styleProfile: string,
  narrativeDynamics: string,
  characterDynamics: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const slicesText = slices.map((s) => `### ${s.title}\n\n${s.content}`).join('\n\n');
  const { systemPrompt, userMessage } = buildReaderExperienceExtractionMessages(
    slicesText, styleProfile, narrativeDynamics, characterDynamics,
  );

  return { systemPrompt, userMessage, apiKey, model, baseURL };
}

/** 获取补充批次的请求体 */
export function getReaderExperienceSupplementRequestBody(
  newChunk: string,
  previousReport: string,
  styleProfile: string,
  narrativeDynamics: string,
  characterDynamics: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const { systemPrompt, userMessage } = buildReaderExperienceSupplementMessages(
    newChunk, previousReport, styleProfile, narrativeDynamics, characterDynamics,
  );
  return { systemPrompt, userMessage, apiKey, model, baseURL };
}

/** 计算是否需要分批 */
export function computeReaderExperienceBatches(
  slices: SemanticSlice[],
  maxContextTokens: number,
): { needsBatch: boolean; batches: string[] } {
  const fullText = slices.map((s) => `### ${s.title}\n\n${s.content}`).join('\n\n');
  const maxChars = computeMaxCharsPerBatch(maxContextTokens);

  if (fullText.length <= maxChars) {
    return { needsBatch: false, batches: [fullText] };
  }

  return { needsBatch: true, batches: splitIntoBatches(fullText, maxChars) };
}
