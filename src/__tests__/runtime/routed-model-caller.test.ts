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

  it("缺失 Provider Secret 时 fail closed，且不触发网络请求", async () => {
    const fetch = vi.fn();
    const caller = createRoutedModelCaller({ fetch, secrets: { get: vi.fn().mockResolvedValue(null) } });
    await expect(caller.complete({ providerProfileId: "cloud-main", baseURL: "https://api.example.test/v1", model: "writer", prompt: "提示", maxTokens: 256 }, new AbortController().signal)).rejects.toThrow(/Secret/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
