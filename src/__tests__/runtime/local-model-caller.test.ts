import { describe, expect, it, vi } from "vitest";
import { createLocalModelCaller } from "@/runtime/local-model-caller";

describe("本地模型调用器", () => {
  it("对非 Ollama 的回环服务请求 OpenAI 兼容 chat completions，并携带原创草稿约束", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "港口起雾了。" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const caller = createLocalModelCaller({ fetch });

    await expect(caller.complete({
      baseURL: "http://127.0.0.1:1234/v1",
      model: "qwen3.5:9b",
      prompt: "写原创开场。",
      maxTokens: 2048,
    }, new AbortController().signal)).resolves.toEqual({ text: "港口起雾了。", finishReason: "stop" });

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:1234/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as { messages: Array<{ content: string }>; model: string; think: boolean; stop: string[] };
    expect(body.model).toBe("qwen3.5:9b");
    expect(body.think).toBe(false);
    expect(body.stop).toEqual(["<AINOVR_END>"]);
    expect(body.messages[0]?.content).toContain("原创");
    expect(body.messages[0]?.content).toContain("不得复述或模仿");
    expect(body.messages[0]?.content).toContain("<AINOVR_END>");
  });

  it("拒绝远程地址，且不发出网络请求", async () => {
    const fetch = vi.fn();
    const caller = createLocalModelCaller({ fetch });

    await expect(caller.complete({
      baseURL: "https://api.example.com/v1",
      model: "remote-model",
      prompt: "写作",
      maxTokens: 2048,
    }, new AbortController().signal)).rejects.toThrow(/本机回环/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("对标准 Ollama 端口使用原生 chat 接口，关闭思考并移除结束标记", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { role: "assistant", content: "雨水敲在钟楼的窗上。\n<AINOVR_END>" },
      done: true,
      done_reason: "stop",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const caller = createLocalModelCaller({ fetch });

    await expect(caller.complete({
      baseURL: "http://localhost:11434/v1",
      model: "qwen3:8b",
      prompt: "写原创开场。",
      maxTokens: 2048,
    }, new AbortController().signal)).resolves.toEqual({ text: "雨水敲在钟楼的窗上。", finishReason: "stop" });

    expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as { think: boolean; options: { num_predict: number }; messages: Array<{ content: string }> };
    expect(body.think).toBe(false);
    expect(body.options.num_predict).toBe(2048);
    expect(body.messages[0]?.content).toContain("原创");
  });

  it("结构化 Reader/Reviewer 调用使用 JSON 模式，不继承正文和结束标记约束", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { role: "assistant", content: '{"issues":[]}' },
      done: true,
      done_reason: "stop",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const caller = createLocalModelCaller({ fetch });

    await caller.complete({
      baseURL: "http://localhost:11434/v1",
      model: "qwen3:8b",
      prompt: "输出严格 JSON。",
      maxTokens: 1024,
      outputMode: "structured_json",
    }, new AbortController().signal);

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as { format?: string; stop?: string[]; messages: Array<{ content: string }> };
    expect(body.format).toBe("json");
    expect(body.stop).toBeUndefined();
    expect(body.messages[0]?.content).toContain("JSON");
    expect(body.messages[0]?.content).not.toContain("<AINOVR_END>");
    expect(body.messages[0]?.content).not.toContain("只输出正文");
  });

  it("显式 Ollama 原生协议允许无 /v1 的本机根地址", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "完成" }, done_reason: "stop" }), { status: 200 }));
    const caller = createLocalModelCaller({ fetch });
    await expect(caller.complete({ baseURL: "http://localhost:11434", protocol: "ollama_native", model: "qwen3:8b", prompt: "提取", maxTokens: 1024 }, new AbortController().signal)).resolves.toEqual({ text: "完成", finishReason: "stop" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.anything());
  });

  it("本地服务在 2xx 响应中返回错误字段时保留可行动摘要，而非伪报缺少 choices", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "requested tokens exceed context window" }), { status: 200, headers: { "content-type": "application/json" } }));
    const caller = createLocalModelCaller({ fetch });

    await expect(caller.complete({
      baseURL: "http://localhost:11434/v1",
      model: "qwen3.5:9b",
      prompt: "输出 JSON。",
      maxTokens: 1024,
      outputMode: "structured_json",
    }, new AbortController().signal)).rejects.toThrow(/context window/);
  });
});
