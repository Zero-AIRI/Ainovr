// ============================================
// POST /api/source/process/classify-entities — AI实体分类
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
      return new Response(JSON.stringify({ error: '缺少实体列表' }), { status: 400 });
    }

    const stream = chatCompletionStream(
      { apiKey, model: model || DEFAULT_MODEL, baseURL: baseURL || DEFAULT_BASE_URL },
      { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 2048 },
    );

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '实体分类失败';
    console.error('实体分类错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
