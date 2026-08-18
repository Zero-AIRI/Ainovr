import { describe, expect, it } from "vitest";
import { splitDraftAtUtf8Range } from "@/components/workbench/chapter-draft-anchor";

describe("splitDraftAtUtf8Range", () => {
  it("按 UTF-8 半开字节范围切分中文、emoji 与混合换行，而不是按 JS 字符下标", () => {
    const text = "开场\r\n林霁🙂说：\n门开了。";
    const bytes = new TextEncoder().encode(text);
    const quote = "🙂说：\n门";
    const startByte = bytes.indexOf(new TextEncoder().encode(quote)[0]!);
    const exactStartByte = new TextEncoder().encode("开场\r\n林霁").byteLength;
    const endByte = exactStartByte + new TextEncoder().encode(quote).byteLength;

    expect(startByte).toBeGreaterThanOrEqual(0);
    expect(splitDraftAtUtf8Range(text, { startByte: exactStartByte, endByte })).toEqual({
      before: "开场\r\n林霁",
      highlighted: quote,
      after: "开了。",
    });
  });

  it("拒绝不在 UTF-8 字符边界上的范围", () => {
    expect(splitDraftAtUtf8Range("林霁🙂", { startByte: 1, endByte: 4 })).toBeNull();
  });
});
