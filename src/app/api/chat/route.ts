// ============================================
// POST /api/chat — 小说问答流式接口
// ============================================

import { streamText } from 'ai';
import { createAIModel, buildThinkingOptions } from '@/lib/ai/providers';
import { buildChatMessages } from '@/lib/ai/chat-prompt';
import type { AIProviderType, CustomProvider, ThinkingEffort, ChatMessage } from '@/types';
import { needsApiKey } from '@/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      novelTexts,
      novelTitles,
      history,
      question,
      provider,
      apiKey,
      model,
      baseURL,
      thinkingMode,
      thinkingEffort,
      customProviders,
    }: {
      novelTexts: string[];
      novelTitles: string[];
      history: ChatMessage[];
      question: string;
      provider: AIProviderType;
      apiKey: string;
      model: string;
      baseURL?: string;
      thinkingMode?: boolean;
      thinkingEffort?: ThinkingEffort;
      customProviders?: CustomProvider[];
    } = body;

    if (!question?.trim()) {
      return new Response(JSON.stringify({ error: '请输入问题' }), { status: 400 });
    }

    if (!novelTexts?.length) {
      return new Response(JSON.stringify({ error: '请先上传至少一本小说' }), { status: 400 });
    }

    if (needsApiKey(provider) && !apiKey) {
      return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
    }

    const aiModel = createAIModel(provider, { apiKey, model, baseURL, customProviders: customProviders || [] });
    const { systemPrompt, messages } = buildChatMessages(
      novelTexts,
      novelTitles,
      history || [],
      question,
    );

    const providerOptions = buildThinkingOptions(
      provider,
      thinkingMode ?? false,
      thinkingEffort ?? 'high',
    );

    const result = streamText({
      model: aiModel,
      system: systemPrompt,
      messages,
      maxOutputTokens: 4096,
      ...(providerOptions && { providerOptions }),
    });

    return result.toTextStreamResponse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '问答失败';
    console.error('问答接口错误:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
