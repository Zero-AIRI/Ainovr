import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/sha256";

describe("跨宿主 SHA-256", () => {
  it("与 Node 标准 SHA-256 对空文本、UTF-8 中文和大批 SourceSpan 内容一致", () => {
    const values = ["", "第一章\n雨落在海面。", "一二三四五六七八九十".repeat(20_000)];
    for (const value of values) {
      expect(sha256Hex(value)).toBe(createHash("sha256").update(value, "utf8").digest("hex"));
    }
  });
});
