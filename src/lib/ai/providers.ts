// ============================================
// AI 模型调用 — 原生 fetch 实现，无 SDK 封装
// ============================================

import type { ThinkingEffort } from '@/types';

interface ModelOptions {
  apiKey: string;
  model: string;
  baseURL: string;
}

interface ChatParams {
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  system?: string;
  maxTokens?: number;
  thinkingMode?: boolean;
  thinkingEffort?: ThinkingEffort;
}

/** 非流式调用 */
export async function chatCompletion(options: ModelOptions, params: ChatParams): Promise<string> {
  const messages = params.system
    ? [{ role: 'system' as const, content: params.system }, ...params.messages]
    : params.messages;

  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    max_tokens: params.maxTokens ?? 4096,
    stream: false,
  };

  // 思考模式（DeepSeek 兼容）
  if (params.thinkingMode) {
    body.reasoning_effort = params.thinkingEffort ?? 'high';
    body.thinking = { type: 'enabled' };
  }

  const url = `${options.baseURL.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(`API 调用失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** 流式调用，返回 ReadableStream */
export function chatCompletionStream(options: ModelOptions, params: ChatParams): ReadableStream<Uint8Array> {
  const messages = params.system
    ? [{ role: 'system' as const, content: params.system }, ...params.messages]
    : params.messages;

  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    max_tokens: params.maxTokens ?? 4096,
    stream: true,
  };

  // 思考模式
  if (params.thinkingMode) {
    body.reasoning_effort = params.thinkingEffort ?? 'high';
    body.thinking = { type: 'enabled' };
  }

  const url = `${options.baseURL.replace(/\/$/, '')}/chat/completions`;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => 'Unknown error');
          controller.error(new Error(`API 调用失败 (${response.status}): ${errText}`));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.error(new Error('无法读取响应流'));
          return;
        }

        let reasoningOpen = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          // 解析 SSE 格式: data: {"choices":[{"delta":{"content":"...","reasoning_content":"..."}}]}
          const lines = text.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              // 推理内容（思考过程）
              const reasoning = delta.reasoning_content;
              if (reasoning) {
                if (!reasoningOpen) {
                  reasoningOpen = true;
                  controller.enqueue(encoder.encode('\n\n---\n💭 **思考过程**\n\n'));
                }
                controller.enqueue(encoder.encode(reasoning));
              }

              // 正文内容
              const content = delta.content;
              if (content) {
                if (reasoningOpen) {
                  reasoningOpen = false;
                  controller.enqueue(encoder.encode('\n\n---\n📝 **回答**\n\n'));
                }
                controller.enqueue(encoder.encode(content));
              }
            } catch {
              // 跳过解析失败的行
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
