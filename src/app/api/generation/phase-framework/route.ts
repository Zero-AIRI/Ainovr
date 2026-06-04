// ============================================
// POST /api/generation/phase-framework — 阶段框架生成
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';
import { buildPhaseFrameworkMessages } from '@/lib/ai/prompts';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { outline, plotGuide, apiKey, model, baseURL } = body;
    if (!apiKey) return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    const { systemPrompt, userMessage } = buildPhaseFrameworkMessages(outline, plotGuide);
    const stream = chatCompletionStream(
      { apiKey, model: model || DEFAULT_MODEL, baseURL: baseURL || DEFAULT_BASE_URL },
      { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 8192 },
    );
    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '阶段框架生成失败';
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
