// ============================================
// 叙事约束 — 客户端编排模块
// ============================================

import {
  buildNarrativeConstraintsExtractionMessages,
  buildNarrativeConstraintsSupplementMessages,
} from '@/lib/ai/prompts';
import { computeMaxCharsPerBatch, splitIntoBatches } from '@/lib/analysis-chunker';
import type { SemanticSlice } from '@/types';

/** 获取首批叙事约束提取的请求体 */
export function getNarrativeConstraintsExtractionRequestBody(
  slices: SemanticSlice[],
  narrativeDynamics: string,
  characterDynamics: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const slicesText = slices.map((s) => `### ${s.title}\n\n${s.content}`).join('\n\n');
  const { systemPrompt, userMessage } = buildNarrativeConstraintsExtractionMessages(
    slicesText, narrativeDynamics, characterDynamics,
  );

  return { systemPrompt, userMessage, apiKey, model, baseURL };
}

/** 获取补充批次的请求体 */
export function getNarrativeConstraintsSupplementRequestBody(
  newChunk: string,
  previousReport: string,
  narrativeDynamics: string,
  characterDynamics: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const { systemPrompt, userMessage } = buildNarrativeConstraintsSupplementMessages(
    newChunk, previousReport, narrativeDynamics, characterDynamics,
  );
  return { systemPrompt, userMessage, apiKey, model, baseURL };
}

/** 计算是否需要分批 */
export function computeNarrativeConstraintsBatches(
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
