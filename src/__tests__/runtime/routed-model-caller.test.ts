import { describe, expect, it, vi } from "vitest";
import { createRoutedModelCaller } from "@/runtime/routed-model-caller";

describe("routed model caller", () => {
  it("只在运行时从 SecretStore 取得云端凭据，且不会把它写入请求体", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "云端正文<AINOVR_END>" }, finish_reason: "stop" }] }), { status: 200 }));
    const secrets = { get: vi.fn().mockResolvedValue("sk-test-secret-value") };
    const caller = createRoutedModelCaller({ fetch, secrets });
    await expect(caller.complete({ providerProfileId: "cloud-main", baseURL: "https://api.example.test/v1", model: "writer", prompt: "原创提示", maxTokens: 256, outputMode: "creative_text" }, new AbortController().signal)).resolves.toEqual({ text: "云端正文", finishReason: "stop" });
    expect(secrets.get).toHaveBeenCalledWith("cloud-main");
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual(expect.objectContaining({ authorization: "Bearer sk-test-secret-value" }));
    expect(String(init.body)).not.toContain("sk-test-secret-value");
  });

  it("云端调用显式拒绝 HTTP 重定向，避免把受核对端点扩展为未知目标", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "正文" }, finish_reason: "stop" }] }), { status: 200 }));
    const caller = createRoutedModelCaller({ fetch, secrets: { get: vi.fn().mockResolvedValue("test-secret") } });
    await caller.complete({ providerProfileId: "cloud-main", baseURL: "https://api.example.test/v1", model: "writer", prompt: "原创提示", maxTokens: 256 }, new AbortController().signal);
    expect(fetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ redirect: "error" }));
  });

  it("缺失 Provider Secret 时 fail closed，且不触发网络请求", async () => {
    const fetch = vi.fn();
    const caller = createRoutedModelCaller({ fetch, secrets: { get: vi.fn().mockResolvedValue(null) } });
    await expect(caller.complete({ providerProfileId: "cloud-main", baseURL: "https://api.example.test/v1", model: "writer", prompt: "提示", maxTokens: 256 }, new AbortController().signal)).rejects.toThrow(/Secret/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("拒绝旧数据库遗留的明文远程 Provider，且不触发网络请求", async () => {
    const fetch = vi.fn();
    const caller = createRoutedModelCaller({ fetch, secrets: { get: vi.fn().mockResolvedValue("test-secret") } });
    await expect(caller.complete({ providerProfileId: "legacy-cloud", baseURL: "http://api.example.test/v1", model: "writer", prompt: "提示", maxTokens: 256 }, new AbortController().signal)).rejects.toThrow(/HTTPS/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("拒绝旧数据库遗留的远程 Ollama 原生协议，避免降级成 Chat Completions", async () => {
    const fetch = vi.fn();
    const caller = createRoutedModelCaller({ fetch, secrets: { get: vi.fn().mockResolvedValue("test-secret") } });
    await expect(caller.complete({ providerProfileId: "legacy-ollama", baseURL: "https://ollama.example.test", protocol: "ollama_native", model: "qwen3", prompt: "提示", maxTokens: 256 }, new AbortController().signal)).rejects.toThrow(/Ollama.*协议/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("按 Provider 的 responses 协议调用 /v1/responses，并使用 max_output_tokens", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "结构化结果", status: "completed" }), { status: 200 }));
    const caller = createRoutedModelCaller({ fetch, secrets: { get: vi.fn().mockResolvedValue("zeus-secret") } });
    await expect(caller.complete({ providerProfileId: "zeus", baseURL: "https://zeus.zwnorz.com", protocol: "responses", model: "gpt-5.6-luna", prompt: "提取事实", maxTokens: 8000, outputMode: "structured_json" }, new AbortController().signal)).resolves.toEqual({ text: "结构化结果", finishReason: "stop" });
    expect(fetch).toHaveBeenCalledWith("https://zeus.zwnorz.com/v1/responses", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.max_output_tokens).toBe(8000);
    expect(body).not.toHaveProperty("messages");
  });
});
