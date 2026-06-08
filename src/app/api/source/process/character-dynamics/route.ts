// ============================================
// POST /api/source/process/character-dynamics — 角色动力学
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { systemPrompt, userMessage, apiKey, model, baseURL } = body as {
      systemPrompt: string;
      userMessage: string;
      apiKey: string;
      model: string;
      baseURL: string;
    };

    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }
    if (!userMessage) {
      return new Response(JSON.stringify({ error: '缺少文本内容' }), { status: 400 });
    }

    const stream = chatCompletionStream(
      { apiKey, model: model || DEFAULT_MODEL, baseURL: baseURL || DEFAULT_BASE_URL },
      { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 8192 },
    );

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '角色动力学分析失败';
    console.error('角色动力学分析错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
