import type { LocalModelCaller, LocalModelCompletionRequest } from "@/application/local-creation-service";
import { createLocalModelCaller } from "@/runtime/local-model-caller";
import type { SecretStore } from "@/runtime/secret-store";
import type { ModelWireProtocol } from "@/application/model-resolver";

export interface CreateRoutedModelCallerOptions { secrets: SecretStore; fetch?: typeof globalThis.fetch; local?: LocalModelCaller; }

/** Chooses loopback or OpenAI-compatible cloud execution. Secret material stays
 * exclusively in this runtime seam and never enters task inputs or SQLite. */
export function createRoutedModelCaller(options: CreateRoutedModelCallerOptions): LocalModelCaller {
  const fetcher = options.fetch ?? globalThis.fetch;
  const local = options.local ?? createLocalModelCaller({ fetch: fetcher });
  return { async complete(input, signal) {
    if (isLoopback(input.baseURL) && input.protocol !== "responses") return local.complete(input, signal);
    if (!input.providerProfileId) throw new Error("云端模型调用缺少 Provider 标识。 ");
    const key = await options.secrets.get(input.providerProfileId);
    if (!key) throw new Error(`云端 Provider ${input.providerProfileId} 未配置运行时 Secret。`);
    const protocol = input.protocol ?? "chat_completions";
    const request = protocol === "responses" ? responsesRequest(input) : chatCompletionsRequest(input);
    const response = await fetcher(cloudEndpoint(input.baseURL, protocol), { method: "POST", redirect: "error", signal, headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(request) });
    if (!response.ok) throw new Error(`云端模型服务返回 HTTP ${response.status}。`);
    const choice = protocol === "responses" ? responseText(await response.json()) : choiceText(await response.json());
    if (!choice) throw new Error(protocol === "responses" ? "Responses 模型响应缺少 output_text。" : "云端模型响应缺少 choices[0]。 ");
    return { text: input.outputMode === "creative_text" ? choice.text.replace(/\s*<AINOVR_END>\s*$/, "") : choice.text, finishReason: choice.finishReason };
  } };
}

function isLoopback(baseURL: string): boolean { try { const host = new URL(baseURL).hostname.toLowerCase(); return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"; } catch { throw new Error("Provider baseURL 无效。 "); } }
function cloudEndpoint(baseURL: string, protocol: ModelWireProtocol): string { const url = new URL(baseURL); if (protocol === "ollama_native") throw new Error("远程 Provider 不支持 Ollama 原生协议。 "); if (url.protocol !== "https:") throw new Error("远程 Provider 必须使用 HTTPS URL。 "); if (url.username || url.password || url.search || url.hash) throw new Error("Provider baseURL 不得包含凭据或查询参数。 "); const path = url.pathname.replace(/\/+$/, ""); if (protocol === "responses") { url.pathname = `${path === "" || path === "/" ? "/v1" : path.endsWith("/v1") ? path : `${path}/v1`}/responses`; } else { url.pathname = `${path === "" || path === "/" ? "/v1" : path}/chat/completions`; } return url.toString(); }
function messages(input: LocalModelCompletionRequest): Array<{ role: "system" | "user"; content: string }> { return [{ role: "system", content: input.outputMode === "structured_json" ? "你是 Ainovr 的结构化创作角色。只输出契约要求的 JSON。" : "你是 Ainovr 的原创写作角色。只输出原创正文。" }, { role: "user", content: input.prompt }]; }
function choiceText(value: unknown): { text: string; finishReason: string } | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const choices = (value as { choices?: unknown }).choices; if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null; const choice = choices[0] as { message?: { content?: unknown }; finish_reason?: unknown }; return typeof choice.message?.content === "string" && typeof choice.finish_reason === "string" ? { text: choice.message.content, finishReason: choice.finish_reason } : null; }
function chatCompletionsRequest(input: LocalModelCompletionRequest): Record<string, unknown> { return { model: input.model, messages: messages(input), temperature: input.outputMode === "structured_json" ? 0.2 : 0.7, max_tokens: input.maxTokens, ...(input.outputMode === "structured_json" ? { response_format: { type: "json_object" } } : { stop: ["<AINOVR_END>"] }), stream: false }; }
function responsesRequest(input: LocalModelCompletionRequest): Record<string, unknown> { return { model: input.model, instructions: input.outputMode === "structured_json" ? "你是 Ainovr 的结构化创作角色。只输出契约要求的 JSON。" : "你是 Ainovr 的原创写作角色。只输出原创正文。", input: input.prompt, max_output_tokens: input.maxTokens, temperature: input.outputMode === "structured_json" ? 0.2 : 0.7, ...(input.outputMode === "structured_json" ? { text: { format: { type: "json_object" } } } : {}) }; }
function responseText(value: unknown): { text: string; finishReason: string } | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const record = value as Record<string, unknown>; if (typeof record.output_text === "string") return { text: record.output_text, finishReason: typeof record.status === "string" && record.status === "incomplete" ? "length" : "stop" }; const output = record.output; if (!Array.isArray(output)) return null; const text = output.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && Array.isArray((item as Record<string, unknown>).content) ? ((item as Record<string, unknown>).content as unknown[]) : []).map((item) => item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).text : null).find((item): item is string => typeof item === "string"); return text ? { text, finishReason: "stop" } : null; }
