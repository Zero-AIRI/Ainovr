// ============================================
// DNA 压缩 — 客户端编排模块
// ============================================

import { buildDnaCompressionMessages } from '@/lib/ai/prompts';

/** 获取 DNA 压缩的请求体（不需要分批，输入是汇总报告而非全文） */
export function getDnaCompressionRequestBody(
  styleProfile: string,
  narrativeDynamics: string,
  characterDynamics: string,
  readerExperience: string,
  narrativeConstraints: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const { systemPrompt, userMessage } = buildDnaCompressionMessages(
    styleProfile,
    narrativeDynamics,
    characterDynamics,
    readerExperience,
    narrativeConstraints,
  );

  return { systemPrompt, userMessage, apiKey, model, baseURL };
}
