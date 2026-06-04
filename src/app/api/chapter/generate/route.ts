// ============================================
// POST /api/chapter/generate — 章节正文生成
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { buildChapterWritingMessages } from '@/lib/ai/prompts';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { styleGuide, hierarchyContext, chapterTask, previousState, apiKey, model, baseURL } = body;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }

    const { systemPrompt, userMessage } = buildChapterWritingMessages(
      styleGuide ?? '',
      hierarchyContext ?? '',
      chapterTask ?? '',
      previousState ?? '',
    );

    const stream = chatCompletionStream(
      { apiKey, model: model || DEFAULT_MODEL, baseURL: baseURL || DEFAULT_BASE_URL },
      { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 8192 },
    );

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '章节生成失败';
    console.error('章节生成错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
