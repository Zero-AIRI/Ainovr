import { describe, expect, it } from "vitest";
import { createSourceDocument } from "@/lib/analysis/source-document";
import type { SourceDocument, SourceSpan } from "@/lib/analysis/types";
import {
  buildHierarchicalSegmentation,
  type SegmentationPolicy,
} from "@/lib/analysis/hierarchical-segmentation";

const roomyPolicy: SegmentationPolicy = {
  hierarchy: ["volume", "chapter", "scene", "chunk"],
  contextWindowTokens: 32_000,
  reservedOutputTokens: 4_000,
  safetyMarginRatio: 0.1,
  overlapSpanCount: 1,
};

describe("层级自适应切片", () => {
  it("短篇在 token 预算内保持一个主单元，但不跳过事实提取", async () => {
    const document = await createSourceDocument({
      sourceId: "short", title: "短篇", boundary: "complete",
      text: "门开了。\n灯没有亮。",
    });
    const result = buildHierarchicalSegmentation(document, roomyPolicy);

    expect(result.computeUnits).toHaveLength(1);
    expect(result.computeUnits[0]).toEqual(expect.objectContaining({
      structuralLevel: "book",
      requiresExtraction: true,
      primarySpanIds: document.spans.map((span) => span.id),
    }));
    expect(result.trace.tokenCountMode).toBe("estimated");
    expect(result.trace.inputBudgetTokens).toBe(25_200);
  });

  it("长篇优先保留卷、章、场景边界，物理 chunk 不冒充叙事弧", async () => {
    const text = [
      "第一卷 起点", "第一章 雨", "甲".repeat(80), "***", "乙".repeat(80),
      "第二章 门", "丙".repeat(80), "第二卷 回声", "第一章 夜", "丁".repeat(80),
    ].join("\n");
    const document = await createSourceDocument({
      sourceId: "long", title: "长篇", boundary: "complete", text,
    });
    const result = buildHierarchicalSegmentation(document, {
      ...roomyPolicy,
      contextWindowTokens: 120,
      reservedOutputTokens: 20,
      safetyMarginRatio: 0,
    });

    expect(result.structure.filter((node) => node.level === "volume")).toHaveLength(2);
    expect(result.structure.filter((node) => node.level === "chapter")).toHaveLength(3);
    expect(result.structure.some((node) => node.level === "scene")).toBe(true);
    expect(result.computeUnits.length).toBeGreaterThan(1);
    expect(result.computeUnits.every((unit) => unit.kind === "compute_container")).toBe(true);
    expect(result.computeUnits.every((unit) => !("narrativeArc" in unit))).toBe(true);
    expect(result.computeUnits.flatMap((unit) => unit.primarySpanIds)).toEqual(
      document.spans.map((span) => span.id),
    );
  });

  it("识别系列名·卷名与罗马数字卷名，不要求作者必须写第一卷", async () => {
    const document = await createSourceDocument({
      sourceId: "series", title: "系列", boundary: "complete",
      text: ["星海·起源", "第一章 门", "正文。", "星海Ⅱ·归途", "第一章 雨", "正文。", "星海II·归途", "后记文字。"].join("\n"),
    });
    const result = buildHierarchicalSegmentation(document, { ...roomyPolicy, volumeTitlePrefixes: ["星海"] });
    expect(result.structure.filter((node) => node.level === "volume").map((node) => node.title)).toEqual(["星海·起源", "星海Ⅱ·归途"]);
  });

  it("超长场景只在必要时降级为 chunk，并记录估算溢出而不静默丢 span", async () => {
    const document = await createSourceDocument({
      sourceId: "scene", title: "长场景", boundary: "fragment",
      text: ["第一章", ...Array.from({ length: 8 }, (_, index) => `${index}` + "甲".repeat(45))].join("\n"),
    });
    const result = buildHierarchicalSegmentation(document, {
      ...roomyPolicy,
      contextWindowTokens: 100,
      reservedOutputTokens: 20,
      safetyMarginRatio: 0,
      overlapSpanCount: 2,
    });

    expect(result.computeUnits.length).toBeGreaterThan(1);
    expect(result.computeUnits.every((unit) => unit.structuralLevel === "chunk")).toBe(true);
    expect(result.computeUnits[1].contextBeforeSpanIds).toHaveLength(2);
    expect(new Set(result.computeUnits.flatMap((unit) => unit.primarySpanIds)).size)
      .toBe(document.spans.length);
    expect(result.trace.overflowUnitIds).toEqual(expect.any(Array));
  });

  it("按约一个 token 估算 CJK/全角字符，不能因低估把中文段落塞过输入预算", async () => {
    const document = await createSourceDocument({
      sourceId: "cjk-budget", title: "中文预算", boundary: "fragment",
      text: ["第一章", "甲".repeat(70), "乙".repeat(70)].join("\n"),
    });
    const result = buildHierarchicalSegmentation(document, {
      ...roomyPolicy,
      contextWindowTokens: 100,
      reservedOutputTokens: 0,
      safetyMarginRatio: 0,
      overlapSpanCount: 0,
    });

    expect(result.computeUnits).toHaveLength(2);
    expect(result.computeUnits.every((unit) => unit.estimatedInputTokens <= 100)).toBe(true);
    expect(result.computeUnits.flatMap((unit) => unit.primarySpanIds)).toEqual(document.spans.map((span) => span.id));
  });

  it("非法窗口、输出预留或安全余量直接拒绝，不猜模型能力", async () => {
    const document = await createSourceDocument({ sourceId: "x", title: "x", boundary: "fragment", text: "正文" });
    expect(() => buildHierarchicalSegmentation(document, {
      ...roomyPolicy,
      contextWindowTokens: 100,
      reservedOutputTokens: 100,
    })).toThrow(/reservedOutputTokens|预算/);
    expect(() => buildHierarchicalSegmentation(document, {
      ...roomyPolicy,
      safetyMarginRatio: 1,
    })).toThrow(/safetyMarginRatio/);
  });

  it("长文本含大量场景边界时在线性时间内保持 span 覆盖与结构归属", () => {
    const document = denseBoundaryDocument(20_000);
    const startedAt = performance.now();
    const result = buildHierarchicalSegmentation(document, {
      ...roomyPolicy,
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginRatio: 0,
      overlapSpanCount: 0,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result.computeUnits.flatMap((unit) => unit.primarySpanIds)).toEqual(document.spans.map((span) => span.id));
    expect(result.computeUnits.every((unit) => unit.structuralNodeId !== undefined)).toBe(true);
    // 回归门：真实第一册曾因每个 group 反复扫描整个结构而耗时数分钟。
    expect(elapsedMs).toBeLessThan(800);
  });
});

function denseBoundaryDocument(spanCount: number): SourceDocument {
  const spans: SourceSpan[] = [];
  let offset = 0;
  for (let index = 0; index < spanCount; index += 1) {
    const text = index % 2 === 0 ? "***" : "甲。";
    spans.push({
      id: `sp${String(index + 1).padStart(5, "0")}`,
      kind: index % 2 === 0 ? "separator" : "paragraph",
      text,
      startOffset: offset,
      endOffset: offset + text.length,
      position: index / spanCount,
      ordinal: index + 1,
    });
    offset += text.length + 1;
  }
  return {
    schemaVersion: 1,
    sourceId: "dense-boundary",
    title: "密集边界长文本",
    boundary: "complete",
    sourceHash: "0".repeat(64),
    normalizationVersion: "test",
    analysisVersion: "dense-boundary-analysis-version",
    originalText: "",
    spans,
  };
}
