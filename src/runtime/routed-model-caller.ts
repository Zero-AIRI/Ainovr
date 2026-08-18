import type { LocalModelCaller, LocalModelCompletionRequest } from "@/application/local-creation-service";
import { createLocalModelCaller } from "@/runtime/local-model-caller";
import type { SecretStore } from "@/runtime/secret-store";

export interface CreateRoutedModelCallerOptions { secrets: SecretStore; fetch?: typeof globalThis.fetch; local?: LocalModelCaller; }

/** Chooses loopback or OpenAI-compatible cloud execution. Secret material stays
 * exclusively in this runtime seam and never enters task inputs or SQLite. */
export function createRoutedModelCaller(options: CreateRoutedModelCallerOptions): LocalModelCaller {
  const fetcher = options.fetch ?? globalThis.fetch;
  const local = options.local ?? createLocalModelCaller({ fetch: fetcher });
  return { async complete(input, signal) {
    if (isLoopback(input.baseURL)) return local.complete(input, signal);
    if (!input.providerProfileId) throw new Error("云端模型调用缺少 Provider 标识。 ");
    const key = await options.secrets.get(input.providerProfileId);
    if (!key) throw new Error(`云端 Provider ${input.providerProfileId} 未配置运行时 Secret。`);
    const response = await fetcher(cloudEndpoint(input.baseURL), { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: input.model, messages: messages(input), temperature: input.outputMode === "structured_json" ? 0.2 : 0.7, max_tokens: input.maxTokens, ...(input.outputMode === "structured_json" ? { response_format: { type: "json_object" } } : { stop: ["<AINOVR_END>"] }), stream: false }) });
    if (!response.ok) throw new Error(`云端模型服务返回 HTTP ${response.status}。`);
    const choice = choiceText(await response.json());
    if (!choice) throw new Error("云端模型响应缺少 choices[0]。 ");
    return { text: input.outputMode === "creative_text" ? choice.text.replace(/\s*<AINOVR_END>\s*$/, "") : choice.text, finishReason: choice.finishReason };
  } };
}

function isLoopback(baseURL: string): boolean { try { const host = new URL(baseURL).hostname.toLowerCase(); return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"; } catch { throw new Error("Provider baseURL 无效。 "); } }
function cloudEndpoint(baseURL: string): string { const url = new URL(baseURL); if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("云端 Provider 必须使用 http(s) URL。 "); if (url.username || url.password || url.search || url.hash || !url.pathname.replace(/\/$/, "").endsWith("/v1")) throw new Error("云端 Provider baseURL 必须是无凭据的 /v1 URL。 "); return `${url.toString().replace(/\/+$/, "")}/chat/completions`; }
function messages(input: LocalModelCompletionRequest): Array<{ role: "system" | "user"; content: string }> { return [{ role: "system", content: input.outputMode === "structured_json" ? "你是 Ainovr 的结构化创作角色。只输出契约要求的 JSON。" : "你是 Ainovr 的原创写作角色。只输出原创正文。" }, { role: "user", content: input.prompt }]; }
function choiceText(value: unknown): { text: string; finishReason: string } | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const choices = (value as { choices?: unknown }).choices; if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null; const choice = choices[0] as { message?: { content?: unknown }; finish_reason?: unknown }; return typeof choice.message?.content === "string" && typeof choice.finish_reason === "string" ? { text: choice.message.content, finishReason: choice.finish_reason } : null; }
