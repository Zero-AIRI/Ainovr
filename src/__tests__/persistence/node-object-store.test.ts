import { access, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import type { ObjectStore } from "@/persistence/object-store";

describe("Node ObjectStore 契约", () => {
  let workspacePath: string;
  let store: ObjectStore;

  beforeEach(async () => {
    workspacePath = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(tmpdir(), "ainovr-object-store-")));
    store = await createNodeObjectStore({ workspacePath });
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("以 SHA-256 内容寻址写入对象，并在 rename 后清空临时目录", async () => {
    const content = new TextEncoder().encode("可验证的正文对象");
    const expectedHash = createHash("sha256").update(content).digest("hex");

    const object = await store.put({ content, mediaType: "text/plain; charset=utf-8" });

    expect(object).toEqual({ sha256: expectedHash, byteLength: content.byteLength, mediaType: "text/plain; charset=utf-8" });
    await expect(readFile(path.join(workspacePath, "data", "objects", expectedHash))).resolves.toEqual(Buffer.from(content));
    await expect(access(path.join(workspacePath, "data", "objects", ".tmp"))).resolves.toBeUndefined();
  });

  it("相同内容去重，读取时重新校验 Hash 并拒绝损坏对象", async () => {
    const content = new TextEncoder().encode("相同内容只保存一次");
    const first = await store.put({ content, mediaType: "text/plain" });
    const second = await store.put({ content, mediaType: "text/plain" });

    expect(second.sha256).toBe(first.sha256);
    await expect(store.read(first.sha256)).resolves.toEqual(content);

    await writeFile(path.join(workspacePath, "data", "objects", first.sha256), "已损坏");
    await expect(store.read(first.sha256)).rejects.toThrow(/hash mismatch/i);
  });
});
