export interface SourceTokenBudgetInput {
  contextWindowTokens: number;
  safetyMarginRatio: number;
  reservedOutputTokens: number;
  renderedSystemPromptTokens: number;
  renderedSchemaTokens: number;
  envelopeTokens: number;
}

export interface SourceTokenBudget {
  usableContextTokens: number;
  sourceInputBudgetTokens: number;
}

/**
 * V2 原文输入预算的唯一公式。它由实际模型窗口和已渲染 Prompt 组成，
 * 不再以固定字数阈值决定是否分块。
 */
export function calculateSourceInputBudget(input: SourceTokenBudgetInput): SourceTokenBudget {
  if (!Number.isInteger(input.contextWindowTokens) || input.contextWindowTokens <= 0) throw new Error("contextWindowTokens 必须是正整数。");
  if (!Number.isFinite(input.safetyMarginRatio) || input.safetyMarginRatio < 0 || input.safetyMarginRatio >= 1) throw new Error("safetyMarginRatio 必须在 [0, 1) 内。");
  for (const [key, value] of Object.entries({
    reservedOutputTokens: input.reservedOutputTokens,
    renderedSystemPromptTokens: input.renderedSystemPromptTokens,
    renderedSchemaTokens: input.renderedSchemaTokens,
    envelopeTokens: input.envelopeTokens,
  })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${key} 必须是非负整数。`);
  }
  const usableContextTokens = Math.floor(input.contextWindowTokens * (1 - input.safetyMarginRatio));
  const sourceInputBudgetTokens = usableContextTokens
    - input.reservedOutputTokens
    - input.renderedSystemPromptTokens
    - input.renderedSchemaTokens
    - input.envelopeTokens;
  if (sourceInputBudgetTokens <= 0) throw new Error("原文输入预算不足，无法安全执行分析。");
  return { usableContextTokens, sourceInputBudgetTokens };
}
