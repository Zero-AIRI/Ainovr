import { describe, expect, it } from "vitest";
import { utf8ByteOffsetsByUtf16Boundary, utf8RangeAtCharacterBoundaries } from "@/lib/analysis/utf8-byte-boundaries";

describe("UTF-8 字节边界", () => {
  it("把规范化文本的 UTF-16 定位转换为稳定 UTF-8 半开字节区间", () => {
    expect(utf8ByteOffsetsByUtf16Boundary("a中🙂")).toEqual([0, 1, 4, null, 8]);
    expect(utf8RangeAtCharacterBoundaries("a中🙂", 1, 4)).toEqual({ startByte: 1, endByte: 8 });
  });

  it("拒绝 surrogate 中间位置作为可引用字节边界", () => {
    expect(() => utf8RangeAtCharacterBoundaries("🙂", 1, 2)).toThrow(/字符边界/);
  });
});
