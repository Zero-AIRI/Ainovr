import { describe, expect, it } from "vitest";
import {
  createNormalizedSourceView,
  mapNormalizedRangeToOriginal,
} from "@/lib/analysis/normalization";

describe("createNormalizedSourceView", () => {
  it("只做可逆的 BOM/换行规范化，并保留每个边界到原文的映射", () => {
    const original = "\uFEFF甲\r\n乙\r丙\n";
    const view = createNormalizedSourceView(original);

    expect(view.text).toBe("甲\n乙\n丙\n");
    expect(view.originalLength).toBe(original.length);
    expect(view.originalOffsetByNormalizedBoundary).toHaveLength(
      view.text.length + 1,
    );
    expect(mapNormalizedRangeToOriginal(view, 0, 1)).toEqual({
      startOffset: 1,
      endOffset: 2,
    });
    expect(mapNormalizedRangeToOriginal(view, 1, 2)).toEqual({
      startOffset: 2,
      endOffset: 4,
    });
    expect(mapNormalizedRangeToOriginal(view, 2, 4)).toEqual({
      startOffset: 4,
      endOffset: 6,
    });
    expect(view.transformations.map((item) => item.kind)).toEqual([
      "remove_bom",
      "normalize_crlf",
      "normalize_cr",
    ]);
  });

  it("拒绝越界或反向范围，不能静默猜测证据位置", () => {
    const view = createNormalizedSourceView("甲乙");

    expect(() => mapNormalizedRangeToOriginal(view, -1, 1)).toThrow();
    expect(() => mapNormalizedRangeToOriginal(view, 2, 1)).toThrow();
    expect(() => mapNormalizedRangeToOriginal(view, 0, 3)).toThrow();
  });
});
