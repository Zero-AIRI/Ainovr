// ============================================
// POST /api/chapter/revise — 基于审查结果修正章节
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { buildChapterRevisionMessages } from '@/lib/ai/prompts';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { chapterContent, reviews, humanFeedback, styleGuide, chapterTask, apiKey, model, baseURL } = body;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }
    if (!chapterContent) {
      return new Response(JSON.stringify({ error: '缺少章节内容' }), { status: 400 });
    }

    const { systemPrompt, userMessage } = buildChapterRevisionMessages(
      chapterContent,
      reviews ?? '',
      humanFeedback ?? null,
      styleGuide ?? '',
      chapterTask ?? '',
    );

    const stream = chatCompletionStream(
      { apiKey, model: model || DEFAULT_MODEL, baseURL: baseURL || DEFAULT_BASE_URL },
      { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 8192 },
    );

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '修正失败';
    console.error('章节修正错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
