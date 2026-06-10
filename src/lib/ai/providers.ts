// ============================================
// AI 模型调用 — 原生 fetch 实现，无 SDK 封装
// ============================================

import { ALLOWED_API_PROTOCOLS } from '@/lib/constants';

/** 验证 baseURL 协议，防止 SSRF */
function validateBaseURL(baseURL: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error(`无效的 Base URL: ${baseURL}`);
  }
  if (!(ALLOWED_API_PROTOCOLS as readonly string[]).includes(parsed.protocol)) {
    throw new Error(`不支持的协议: ${parsed.protocol}，仅允许 ${ALLOWED_API_PROTOCOLS.join(', ')}`);
  }
  // 禁止指向内网地址
  const hostname = parsed.hostname;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    hostname.startsWith('192.168.')
  ) {
    throw new Error(`不允许访问内网地址: ${hostname}`);
  }
  return baseURL;
}

interface ModelOptions {
  apiKey: string;
  model: string;
  baseURL: string;
  thinkingMode?: boolean;
}

interface ChatParams {
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  system?: string;
  maxTokens?: number;
}

/** 流式调用，返回 ReadableStream */
export function chatCompletionStream(options: ModelOptions, params: ChatParams): ReadableStream<Uint8Array> {
  validateBaseURL(options.baseURL);
  const messages = params.system
    ? [{ role: 'system' as const, content: params.system }, ...params.messages]
    : params.messages;

  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    max_tokens: params.maxTokens ?? 4096,
    stream: true,
  };

  // DeepSeek 思考模式
  if (options.thinkingMode) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = 'high';
  } else {
    body.thinking = { type: 'disabled' };
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
          // 用文本编码错误（controller.error 不跨 HTTP 传播）
          controller.enqueue(encoder.encode(`[STREAM_ERROR] API 调用失败 (${response.status}): ${errText}`));
          controller.close();
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode('[STREAM_ERROR] 无法读取响应流'));
          controller.close();
          return;
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          // 解析 SSE 格式: data: {"choices":[{"delta":{"content":"..."}}]}
          const lines = text.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              // 正文内容
              const content = delta.content;
              if (content) {
                controller.enqueue(encoder.encode(content));
              }
            } catch {
              // 跳过解析失败的行
            }
          }
        }
        controller.close();
      } catch (err) {
        // 用文本编码错误（controller.error 不跨 HTTP 传播）
        const msg = err instanceof Error ? err.message : '未知错误';
        controller.enqueue(encoder.encode(`[STREAM_ERROR] ${msg}`));
        controller.close();
      }
    },
  });
}
