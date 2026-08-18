import type { LocalFactExtractionCaller } from "@/application/local-fact-extraction-service";
import { FACT_EXTRACTION_JSON_SCHEMA } from "@/lib/analysis/analysis-json-schemas";

export interface CreateLocalFactExtractionCallerOptions {
  fetch?: typeof globalThis.fetch;
}

/**
 * 参考分析专用本地调用器。它和原创 Writer 严格分离：允许传递已导入的 SourceSpan，
 * 但仅请求本机回环端点，也不读取或发送任何 API Key。
 */
export function createLocalFactExtractionCaller(options: CreateLocalFactExtractionCallerOptions = {}): LocalFactExtractionCaller {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    async complete(input, signal) {
      const endpoint = localFactExtractionEndpoint(input.baseURL);
      const response = await fetcher(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify(endpoint.kind === "ollama" ? ollamaRequestBody(input) : openAiCompatibleRequestBody(input)),
      });
      if (!response.ok) throw new Error(`本地模型服务返回 HTTP ${response.status}。`);
      const payload: unknown = await response.json();
      const choice = endpoint.kind === "ollama" ? firstOllamaChoice(payload) : firstOpenAiChoice(payload);
      if (!choice) throw new Error(endpoint.kind === "ollama" ? "本地模型响应缺少 message 或 done_reason。" : "本地模型响应缺少 choices[0]。 ");
      return choice;
    },
  };
}

type LocalEndpoint = { kind: "ollama" | "openai_compatible"; url: string };

function localFactExtractionEndpoint(baseURL: string): LocalEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(baseURL.trim());
  } catch {
    throw new Error("本地模型 baseURL 无效。 ");
  }
  if (parsed.protocol !== "http:" || !isLoopbackHost(parsed.hostname)) throw new Error("本地 FactExtractor 只允许请求本机回环 HTTP 地址。 ");
  const normalized = parsed.toString().replace(/\/+$/, "");
  if (!new URL(normalized).pathname.endsWith("/v1")) throw new Error("本地模型 baseURL 必须以 /v1 结尾。 ");
  // Ollama 的 OpenAI 兼容层在部分 Qwen 模型上不会稳定透传 think:false；
  // 结构化事实抽取也必须走原生端点，避免推理内容吞掉 JSON 输出预算。
  if (parsed.port === "11434") return { kind: "ollama", url: new URL("/api/chat", parsed.origin).toString() };
  return { kind: "openai_compatible", url: `${normalized}/chat/completions` };
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function openAiCompatibleRequestBody(input: { model: string; systemPrompt: string; prompt: string; maxTokens: number }): Record<string, unknown> {
  return {
    model: input.model,
    messages: messages(input),
    temperature: 0,
    max_tokens: input.maxTokens,
    response_format: { type: "json_object" },
    think: false,
    stream: false,
  };
}

function ollamaRequestBody(input: { model: string; systemPrompt: string; prompt: string; maxTokens: number }): Record<string, unknown> {
  return {
    model: input.model,
    messages: messages(input),
    options: { temperature: 0, num_predict: input.maxTokens },
    format: FACT_EXTRACTION_JSON_SCHEMA,
    think: false,
    stream: false,
  };
}

function messages(input: { systemPrompt: string; prompt: string }): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.prompt },
  ];
}

function firstOpenAiChoice(value: unknown): { text: string; finishReason: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const choice = choices[0] as Record<string, unknown>;
  const message = choice.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const text = (message as Record<string, unknown>).content;
  const finishReason = choice.finish_reason;
  return typeof text === "string" && typeof finishReason === "string" ? { text, finishReason } : null;
}

function firstOllamaChoice(value: unknown): { text: string; finishReason: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const message = record.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const text = (message as Record<string, unknown>).content;
  const finishReason = record.done_reason;
  return typeof text === "string" && typeof finishReason === "string" ? { text, finishReason } : null;
}
