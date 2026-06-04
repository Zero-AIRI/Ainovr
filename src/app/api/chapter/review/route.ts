// ============================================
// POST /api/chapter/review — 章节自动审查（5维度）
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { buildChapterReviewMessages } from '@/lib/ai/prompts';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { chapterContent, styleGuide, chapterTask, apiKey, model, baseURL } = body;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }
    if (!chapterContent) {
      return new Response(JSON.stringify({ error: '缺少章节内容' }), { status: 400 });
    }

    const { systemPrompt, userMessage } = buildChapterReviewMessages(
      chapterContent,
      styleGuide ?? '',
      chapterTask ?? '',
    );

    const stream = chatCompletionStream(
      { apiKey, model: model || DEFAULT_MODEL, baseURL: baseURL || DEFAULT_BASE_URL },
      { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 4096 },
    );

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '审查失败';
    console.error('章节审查错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
