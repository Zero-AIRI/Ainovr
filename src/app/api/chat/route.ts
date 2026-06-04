// ============================================
// POST /api/chat — 小说问答流式接口
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { buildChatMessages } from '@/lib/ai/chat-prompt';
import type { ThinkingEffort, ChatMessage } from '@/types';

const MAX_CHAT_CHARS = 100_000;

interface ChunkInput {
  id: string;
  novelId: string;
  novelTitle: string;
  index: number;
  title: string;
  content: string;
  charCount: number;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      chunks,
      history,
      question,
      apiKey,
      model,
      baseURL,
      thinkingMode,
      thinkingEffort,
    }: {
      chunks: ChunkInput[];
      history: ChatMessage[];
      question: string;
      apiKey: string;
      model: string;
      baseURL: string;
      thinkingMode?: boolean;
      thinkingEffort?: ThinkingEffort;
    } = body;

    if (!question?.trim()) {
      return new Response(JSON.stringify({ error: '请输入问题' }), { status: 400 });
    }
    if (!chunks?.length) {
      return new Response(JSON.stringify({ error: '请先选择至少一本小说' }), { status: 400 });
    }
    if (!apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }

    const sortedChunks = [...chunks].sort((a, b) => {
      if (a.novelId !== b.novelId) return a.novelId.localeCompare(b.novelId);
      return a.index - b.index;
    });

    let totalChars = 0;
    const selectedChunks: ChunkInput[] = [];
    for (const chunk of sortedChunks) {
      if (totalChars + chunk.charCount > MAX_CHAT_CHARS) break;
      selectedChunks.push(chunk);
      totalChars += chunk.charCount;
    }

    const { systemPrompt, messages } = buildChatMessages(selectedChunks, history || [], question);

    const stream = chatCompletionStream(
      { apiKey, model: model || 'deepseek-v4-flash', baseURL: baseURL || 'https://api.deepseek.com' },
      { system: systemPrompt, messages, maxTokens: 4096, thinkingMode, thinkingEffort },
    );

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '问答失败';
    console.error('问答接口错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
