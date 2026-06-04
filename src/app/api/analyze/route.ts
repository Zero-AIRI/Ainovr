// ============================================
// POST /api/analyze — 流式风格分析接口
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { buildAnalyzeMessages } from '@/lib/ai/analyze-prompt';
import type { ThinkingEffort } from '@/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      novelTexts,
      apiKey,
      model,
      baseURL,
      thinkingMode,
      thinkingEffort,
    }: {
      novelTexts: string[];
      apiKey: string;
      model: string;
      baseURL: string;
      thinkingMode?: boolean;
      thinkingEffort?: ThinkingEffort;
    } = body;

    if (!novelTexts?.length) {
      return new Response(JSON.stringify({ error: '请上传至少一本小说' }), { status: 400 });
    }
    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }

    const { systemPrompt, userMessage } = buildAnalyzeMessages(novelTexts);
    const stream = chatCompletionStream(
      { apiKey, model: model || 'deepseek-v4-flash', baseURL: baseURL || 'https://api.deepseek.com' },
      { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: 4096, thinkingMode, thinkingEffort },
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
