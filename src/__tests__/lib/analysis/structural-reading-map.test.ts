import { describe, expect, it } from "vitest";
import { buildStructuralReadingMap } from "@/lib/analysis/structural-reading-map";

describe("结构化 ReadingMap", () => {
  it("只从冻结的单元与 span 元数据派生全局结构，不携带原文正文", () => {
    const map = buildStructuralReadingMap({
      analysisProjectId: "analysis_001",
      sourceEditionId: "edition_001",
      segmentationId: "segmentation_001",
      sourceHash: "a".repeat(64),
      createdAt: 1_700_000_000_000,
      units: [
        {
          analysisUnitId: "unit_001", ordinal: 1, startByte: 0, endByte: 42,
          spans: [
            { spanId: "sp00001", kind: "chapter_heading", startByte: 0, endByte: 12 },
            { spanId: "sp00002", kind: "paragraph", startByte: 13, endByte: 42 },
          ],
        },
        {
          analysisUnitId: "unit_002", ordinal: 2, startByte: 42, endByte: 80,
          spans: [{ spanId: "sp00003", kind: "paragraph", startByte: 42, endByte: 80 }],
        },
      ],
    });

    expect(map).toEqual(expect.objectContaining({
      schema_version: 1,
      kind: "structural_reading_map",
      analysisProjectId: "analysis_001",
      sourceEditionId: "edition_001",
      sourceHash: "a".repeat(64),
      totalUnits: 2,
      totalSpans: 3,
      candidateStatus: "not_observed",
    }));
    expect(map.units).toEqual([
      expect.objectContaining({ analysisUnitId: "unit_001", spanCount: 2, spanKinds: { chapter_heading: 1, paragraph: 1 } }),
      expect.objectContaining({ analysisUnitId: "unit_002", spanCount: 1, spanKinds: { paragraph: 1 } }),
    ]);
    expect(JSON.stringify(map)).not.toContain("原文正文");
    expect(JSON.stringify(map)).not.toContain("text");
  });

  it("拒绝不连续单元、越界 span 或重复 span，避免把错误结构伪装成阅读地图", () => {
    expect(() => buildStructuralReadingMap({
      analysisProjectId: "analysis_001", sourceEditionId: "edition_001", segmentationId: "segmentation_001", sourceHash: "a".repeat(64), createdAt: 1,
      units: [{ analysisUnitId: "unit_001", ordinal: 2, startByte: 0, endByte: 10, spans: [{ spanId: "sp00001", kind: "paragraph", startByte: 0, endByte: 11 }] }],
    })).toThrow(/ordinal|范围/);
  });
});
