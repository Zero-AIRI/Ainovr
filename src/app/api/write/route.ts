// ============================================
// POST /api/write — 流式仿写接口
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { buildWriteMessages, buildContinueMessages } from '@/lib/ai/write-prompt';
import type { WriteLength, ThinkingEffort } from '@/types';

interface CommonParams {
  apiKey: string;
  model: string;
  baseURL: string;
  thinkingMode?: boolean;
  thinkingEffort?: ThinkingEffort;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.mode === 'continue') return handleContinue(body);
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
} & CommonParams) {
  const { analysisReport, genre, length, synopsis, extraRequirements, apiKey, model, baseURL, thinkingMode, thinkingEffort } = body;
  if (!apiKey) return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });

  const { systemPrompt, userMessage } = buildWriteMessages(analysisReport, genre, length, synopsis, extraRequirements);
  const stream = chatCompletionStream(
    { apiKey, model: model || 'deepseek-v4-flash', baseURL: baseURL || 'https://api.deepseek.com' },
    { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 8192, thinkingMode, thinkingEffort },
  );

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

async function handleContinue(body: {
  analysisReport: string;
  existingText: string;
  extraHint?: string;
} & CommonParams) {
  const { analysisReport, existingText, extraHint, apiKey, model, baseURL, thinkingMode, thinkingEffort } = body;
  if (!apiKey) return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });

  const { systemPrompt, userMessage } = buildContinueMessages(analysisReport, existingText, extraHint);
  const stream = chatCompletionStream(
    { apiKey, model: model || 'deepseek-v4-flash', baseURL: baseURL || 'https://api.deepseek.com' },
    { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 4096, thinkingMode, thinkingEffort },
  );

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
