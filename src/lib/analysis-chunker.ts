// ============================================
// 分批分析辅助 — 文本分批与大小计算
// ============================================

/** 中文文本的保守 token/char 比率 */
const CHARS_PER_TOKEN = 1.5;

/** 系统提示词 + 上一轮报告 + 输出预留的字符开销 */
const PROMPT_OVERHEAD = 8000;

/**
 * 根据模型最大上下文 Token 数计算每批最大字符数
 */
export function computeMaxCharsPerBatch(maxContextTokens: number): number {
  return Math.max(10000, Math.floor(maxContextTokens * CHARS_PER_TOKEN) - PROMPT_OVERHEAD);
}

/**
 * 将长文本按段落边界分割为多个批次
 * 优先在 \n\n（段落边界）处分割，避免截断句子
 */
export function splitIntoBatches(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const batches: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      batches.push(remaining);
      break;
    }

    // 在 maxChars 范围内找最后一个段落分割点
    let splitAt = remaining.lastIndexOf('\n\n', maxChars);

    // 没找到段落分割点，找最后一个换行
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf('\n', maxChars);
    }

    // 仍然没找到，找最后一个句号
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf('。', maxChars);
    }

    // 都没有，硬切
    if (splitAt <= 0) {
      splitAt = maxChars;
    }

    batches.push(remaining.slice(0, splitAt).trimStart());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return batches;
}
