// ============================================
// Step 0: 智能切片 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你的任务是分析小说文本，按叙事弧线进行智能切片。

要求：
- 以情节完整性为最高优先级（不在高潮中间切断）
- 以章节边界为自然切割点
- 每个切片包含一个相对完整的叙事单元
- 为每个切片标注：序号、标题、语义标签、情节弧线、情绪基调
- 每个切片的目标字数：{targetSliceSize} 字（允许 ±30% 浮动，情节完整性优先于字数约束）

切片粒度说明：
- 2000字以下：精细切片，适合短篇分析或需要逐场景拆解
- 5000字左右（默认）：标准切片，平衡语义完整性和分析效率
- 10000字以上：粗粒度切片，适合快速浏览长篇小说的整体结构
- 30000字以上：按卷/大弧线切片，每个切片对应一个完整的叙事大段落

输出格式（Markdown）：

## 切片 {序号}: {标题}
- 语义标签: {标签1}, {标签2}
- 情节弧线: {弧线名称}
- 情绪基调: {基调}
- 字数: {字数}

{切片正文}

---
`;

export function buildSlicingMessages(novelText: string, targetSliceSize: number = 5000) {
  const systemPrompt = getPrompt('source-slicing', DEFAULT_SYSTEM_PROMPT)
    .replace('{targetSliceSize}', String(targetSliceSize));
  return { systemPrompt, userMessage: novelText };
}
