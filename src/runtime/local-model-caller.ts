import type { LocalCreationOutputMode, LocalModelCaller } from "@/application/local-creation-service";

export interface CreateLocalModelCallerOptions {
  fetch?: typeof globalThis.fetch;
}

/**
 * 本地创作专用的最小 OpenAI 兼容调用器。它刻意拒绝非回环地址，不读取 API Key，
 * 因而不会因“本地创作”而意外把正文发送到云端。
 */
export function createLocalModelCaller(options: CreateLocalModelCallerOptions = {}): LocalModelCaller {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    async complete(input, signal) {
      const endpoint = localCompletionEndpoint(input.baseURL);
      const response = await fetcher(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify(endpoint.kind === "ollama"
          ? ollamaRequestBody(input)
          : openAiCompatibleRequestBody(input)),
      });
      if (!response.ok) throw new Error(`本地模型服务返回 HTTP ${response.status}。`);
      const payload: unknown = await response.json();
      const serviceError = localServiceError(payload);
      if (serviceError) throw new Error(`本地模型服务返回错误：${serviceError}`);
      const choice = endpoint.kind === "ollama" ? firstOllamaChoice(payload) : firstOpenAiChoice(payload);
      if (!choice) throw new Error("本地模型响应缺少 choices[0]。");
      return { text: removeEndMarker(choice.text), finishReason: choice.finishReason };
    },
  };
}

type LocalEndpoint = { kind: "ollama" | "openai_compatible"; url: string };

function localCompletionEndpoint(baseURL: string): LocalEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(baseURL.trim());
  } catch {
    throw new Error("本地模型 baseURL 无效。");
  }
  if (parsed.protocol !== "http:" || !isLoopbackHost(parsed.hostname)) {
    throw new Error("本地创作只允许请求本机回环 HTTP 地址。");
  }
  const normalized = parsed.toString().replace(/\/+$/, "");
  if (!new URL(normalized).pathname.endsWith("/v1")) throw new Error("本地模型 baseURL 必须以 /v1 结尾。");
  // Ollama 的 OpenAI 兼容层在部分 Qwen 模型上不会透传 think:false，
  // 会把整个输出预算花在 reasoning。标准端口走原生接口才可可靠禁用思考。
  if (parsed.port === "11434") return { kind: "ollama", url: new URL("/api/chat", parsed.origin).toString() };
  return { kind: "openai_compatible", url: `${normalized}/chat/completions` };
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function openAiCompatibleRequestBody(input: { model: string; prompt: string; maxTokens: number; outputMode?: LocalCreationOutputMode }): Record<string, unknown> {
  const structured = input.outputMode === "structured_json";
  return {
    model: input.model,
    messages: writingMessages(input.prompt, input.outputMode),
    temperature: structured ? 0.2 : 0.7,
    max_tokens: input.maxTokens,
    ...(structured ? { response_format: { type: "json_object" } } : { stop: ["<AINOVR_END>"] }),
    think: false,
    stream: false,
  };
}

function ollamaRequestBody(input: { model: string; prompt: string; maxTokens: number; outputMode?: LocalCreationOutputMode }): Record<string, unknown> {
  const structured = input.outputMode === "structured_json";
  return {
    model: input.model,
    messages: writingMessages(input.prompt, input.outputMode),
    options: structured ? { temperature: 0.2, num_predict: input.maxTokens } : { temperature: 0.7, num_predict: input.maxTokens, stop: ["<AINOVR_END>"] },
    ...(structured ? { format: "json" } : {}),
    think: false,
    stream: false,
  };
}

function writingMessages(prompt: string, outputMode: LocalCreationOutputMode = "creative_text"): Array<{ role: "system" | "user"; content: string }> {
  const system = outputMode === "structured_json"
    ? [
      "你是 Ainovr 的本地结构化评审模型。",
      "严格遵循本次用户消息中的 JSON 契约，只输出一个 JSON 对象，不要 Markdown、代码围栏、解释、评分或额外字段。",
      "不得引用任何未提供的作品、原文、人物、情节或专名。",
    ].join("\n")
    : [
      "你是 Ainovr 的原创草稿写作模型。",
      "只依据本次用户给出的原创创作要求输出正文。",
      "不得复述或模仿任何既有作品的原文、人物、情节、专名或句式。",
      "只输出正文，不要标题、解释、Markdown 或代码围栏。",
      "完成正文后紧接着输出 <AINOVR_END>；该结束标记会在保存草稿前由运行时移除。",
    ].join("\n");
  return [
    {
      role: "system",
      content: system,
    },
    { role: "user", content: prompt },
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
  if (typeof text !== "string" || typeof finishReason !== "string") return null;
  return { text, finishReason };
}

function firstOllamaChoice(value: unknown): { text: string; finishReason: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const message = record.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const text = (message as Record<string, unknown>).content;
  const finishReason = record.done_reason;
  if (typeof text !== "string" || typeof finishReason !== "string") return null;
  return { text, finishReason };
}

function removeEndMarker(text: string): string {
  return text.replace(/\s*<AINOVR_END>\s*$/, "");
}

function localServiceError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  const message = typeof error === "string"
    ? error
    : error && typeof error === "object" && !Array.isArray(error) && typeof (error as Record<string, unknown>).message === "string"
      ? (error as Record<string, unknown>).message as string
      : null;
  return message ? message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-****").slice(0, 500) : null;
}
