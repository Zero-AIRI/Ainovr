import { describe, expect, it } from "vitest";
import { createSourceDocument } from "@/lib/analysis/source-document";

const SAMPLE = `第一章 起航\n\n他把旧钥匙放进口袋。\n\n※※※\n\n草原\n\n风从山口吹来，她忽然说想看一次日落。`;

describe("createSourceDocument", () => {
  it("保留原文并生成可回查的稳定 span", async () => {
    const first = await createSourceDocument({
      sourceId: "sample",
      title: "测试短篇",
      text: SAMPLE,
      boundary: "complete",
    });
    const second = await createSourceDocument({
      sourceId: "sample",
      title: "测试短篇",
      text: SAMPLE,
      boundary: "complete",
    });

    expect(first.originalText).toBe(SAMPLE);
    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.spans.length).toBeGreaterThanOrEqual(5);
    expect(first.spans.map((span) => span.id)).toEqual(
      second.spans.map((span) => span.id),
    );
    expect(new Set(first.spans.map((span) => span.id)).size).toBe(
      first.spans.length,
    );
    expect(first.spans.every((span) => /^sp\d{5}$/.test(span.id))).toBe(true);

    for (const span of first.spans) {
      expect(SAMPLE.slice(span.startOffset, span.endOffset)).toBe(span.text);
    }
  });

  it("识别章节、分隔符和节标题，但不把它们伪装成完整叙事弧", async () => {
    const document = await createSourceDocument({
      sourceId: "sample",
      title: "测试短篇",
      text: SAMPLE,
      boundary: "complete",
    });

    expect(document.spans.some((span) => span.kind === "chapter_heading")).toBe(true);
    expect(document.spans.some((span) => span.kind === "separator")).toBe(true);
    expect(document.spans.some((span) => span.kind === "section_heading" && span.text === "草原")).toBe(true);
    expect(document.spans.every((span) => !("plotArc" in span))).toBe(true);
  });

  it("作品边界进入版本契约，完结与片段不能复用同一分析版本", async () => {
    const complete = await createSourceDocument({
      sourceId: "sample",
      title: "测试短篇",
      text: SAMPLE,
      boundary: "complete",
    });
    const fragment = await createSourceDocument({
      sourceId: "sample",
      title: "测试短篇",
      text: SAMPLE,
      boundary: "fragment",
    });

    expect(complete.boundary).toBe("complete");
    expect(fragment.boundary).toBe("fragment");
    expect(complete.analysisVersion).not.toBe(fragment.analysisVersion);
  });
});
