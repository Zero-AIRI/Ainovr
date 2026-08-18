import { describe, expect, it } from "vitest";
import { calculateSourceInputBudget } from "@/lib/analysis/source-token-budget";

describe("V2 原文动态 token 预算", () => {
  it("先扣上下文安全余量，再扣输出、system、schema 和 envelope 预算", () => {
    expect(calculateSourceInputBudget({
      contextWindowTokens: 32_000,
      safetyMarginRatio: 0.2,
      reservedOutputTokens: 8_000,
      renderedSystemPromptTokens: 1_000,
      renderedSchemaTokens: 600,
      envelopeTokens: 400,
    })).toEqual({ usableContextTokens: 25_600, sourceInputBudgetTokens: 15_600 });
  });

  it("预算不足时直接拒绝，而不是按固定字数偷偷切块", () => {
    expect(() => calculateSourceInputBudget({
      contextWindowTokens: 1_000,
      safetyMarginRatio: 0.2,
      reservedOutputTokens: 700,
      renderedSystemPromptTokens: 100,
      renderedSchemaTokens: 100,
      envelopeTokens: 100,
    })).toThrow(/预算/);
  });
});
