// ============================================
// POST /api/analyze — 流式风格分析接口
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { buildAnalyzeMessages, buildSupplementMessages } from '@/lib/ai/analyze-prompt';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      novelTexts,
      previousReport,
      apiKey,
      model,
      baseURL,
    }: {
      novelTexts: string[];
      previousReport?: string;
      apiKey: string;
      model: string;
      baseURL: string;
    } = body;

    if (!novelTexts?.length) {
      return new Response(JSON.stringify({ error: '请上传至少一本小说' }), { status: 400 });
    }
    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }

    const { systemPrompt, userMessage } = previousReport
      ? buildSupplementMessages(novelTexts.join('\n\n'), previousReport)
      : buildAnalyzeMessages(novelTexts);

    const stream = chatCompletionStream(
      { apiKey, model: model || DEFAULT_MODEL, baseURL: baseURL || DEFAULT_BASE_URL },
      { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 4096 },
    );

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '分析失败';
    console.error('分析接口错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
