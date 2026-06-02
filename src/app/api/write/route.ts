// ============================================
// POST /api/write — 流式仿写接口
// ============================================

import { streamText } from 'ai';
import { createAIModel } from '@/lib/ai/providers';
import { buildWriteMessages, buildContinueMessages } from '@/lib/ai/write-prompt';
import type { AIProviderType, WriteLength } from '@/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.mode === 'continue') {
      return handleContinue(body);
    }

    return handleWrite(body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '仿写失败';
    console.error('仿写接口错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

async function handleWrite(body: {
  analysisReport: string;
  genre: string;
  length: WriteLength;
  synopsis: string;
  extraRequirements?: string;
  provider: AIProviderType;
  apiKey: string;
  model: string;
  baseURL?: string;
}) {
  const { analysisReport, genre, length, synopsis, extraRequirements, provider, apiKey, model, baseURL } = body;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
  }

  const aiModel = createAIModel(provider, { apiKey, model, baseURL });
  const { systemPrompt, userMessage } = buildWriteMessages(
    analysisReport, genre, length, synopsis, extraRequirements,
  );

  const result = streamText({
    model: aiModel,
    system: systemPrompt,
    prompt: userMessage,
    maxOutputTokens: 8192,
  });

  return result.toTextStreamResponse();
}

async function handleContinue(body: {
  analysisReport: string;
  existingText: string;
  extraHint?: string;
  provider: AIProviderType;
  apiKey: string;
  model: string;
  baseURL?: string;
}) {
  const { analysisReport, existingText, extraHint, provider, apiKey, model, baseURL } = body;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
  }

  const aiModel = createAIModel(provider, { apiKey, model, baseURL });
  const { systemPrompt, userMessage } = buildContinueMessages(
    analysisReport, existingText, extraHint,
  );

  const result = streamText({
    model: aiModel,
    system: systemPrompt,
    prompt: userMessage,
    maxOutputTokens: 4096,
  });

  return result.toTextStreamResponse();
}
