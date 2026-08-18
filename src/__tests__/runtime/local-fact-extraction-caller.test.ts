import { describe, expect, it, vi } from "vitest";
import { FACT_EXTRACTION_JSON_SCHEMA } from "@/lib/analysis/analysis-json-schemas";
import { createLocalFactExtractionCaller } from "@/runtime/local-fact-extraction-caller";

describe("本地 FactExtractor 调用器", () => {
  it("对标准 Ollama 端口使用原生 chat 接口，关闭推理并请求 JSON 输出", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { role: "assistant", content: "{\"facts\":[]}" },
      done: true,
      done_reason: "stop",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const caller = createLocalFactExtractionCaller({ fetch });

    await expect(caller.complete({
      baseURL: "http://localhost:11434/v1", model: "qwen3:8b", systemPrompt: "提取可观察事实", prompt: "SourceSpan：[]", maxTokens: 2048,
    }, new AbortController().signal)).resolves.toEqual({ text: "{\"facts\":[]}", finishReason: "stop" });

    expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as { think: boolean; options: { temperature: number; num_predict: number }; format: unknown; messages: Array<{ content: string }> };
    expect(body.think).toBe(false);
    expect(body.options).toEqual({ temperature: 0, num_predict: 2048 });
    expect(body.format).toEqual(FACT_EXTRACTION_JSON_SCHEMA);
    expect(body.messages[0]?.content).toBe("提取可观察事实");
  });

  it("对其他回环服务保持 OpenAI 兼容 JSON 对象请求", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"facts\":[]}" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const caller = createLocalFactExtractionCaller({ fetch });

    await expect(caller.complete({
      baseURL: "http://127.0.0.1:1234/v1", model: "qwen3:8b", systemPrompt: "提取可观察事实", prompt: "SourceSpan：[]", maxTokens: 2048,
    }, new AbortController().signal)).resolves.toEqual({ text: "{\"facts\":[]}", finishReason: "stop" });

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:1234/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as { think: boolean; temperature: number; response_format: { type: string } };
    expect(body.think).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("拒绝远程模型地址且不发送请求", async () => {
    const fetch = vi.fn();
    const caller = createLocalFactExtractionCaller({ fetch });
    await expect(caller.complete({
      baseURL: "https://api.example.com/v1", model: "remote", systemPrompt: "x", prompt: "x", maxTokens: 256,
    }, new AbortController().signal)).rejects.toThrow(/本机回环/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
