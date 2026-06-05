// ============================================
// Step 1: 智能切片 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

const DEFAULT_SYSTEM_PROMPT = `你的任务是分析小说文本，按叙事弧线进行智能切片。

要求：
- 以情节完整性为最高优先级（不在高潮中间切断）
- 以章节边界为自然切割点
- 每个切片包含一个相对完整的叙事单元
- 为每个切片标注：序号、标题、语义标签、情节弧线、情绪基调

输出格式（Markdown）：

## 切片 {序号}: {标题}
- 语义标签: {标签1}, {标签2}
- 情节弧线: {弧线名称}
- 情绪基调: {基调}
- 字数: {字数}

{切片正文}

---
`;

export function buildSlicingMessages(novelText: string) {
  return { systemPrompt: getPrompt('source-slicing', DEFAULT_SYSTEM_PROMPT), userMessage: novelText };
}
