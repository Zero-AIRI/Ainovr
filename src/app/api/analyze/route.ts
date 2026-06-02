// ============================================
// POST /api/analyze — 流式风格分析接口
// ============================================

import { streamText } from 'ai';
import { createAIModel } from '@/lib/ai/providers';
import { buildAnalyzeMessages } from '@/lib/ai/analyze-prompt';
import type { AIProviderType } from '@/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      novelTexts,
      provider,
      apiKey,
      model,
      baseURL,
    }: {
      novelTexts: string[];
      provider: AIProviderType;
      apiKey: string;
      model: string;
      baseURL?: string;
    } = body;

    if (!novelTexts?.length) {
      return new Response(JSON.stringify({ error: '请上传至少一本小说' }), { status: 400 });
    }

    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }

    const aiModel = createAIModel(provider, { apiKey, model, baseURL });
    const { systemPrompt, userMessage } = buildAnalyzeMessages(novelTexts);

    const result = streamText({
      model: aiModel,
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 4096,
    });

    return result.toTextStreamResponse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '分析失败';
    console.error('分析接口错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
