// ============================================
// Step 3: 代表性切片选取 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

const DEFAULT_SYSTEM_PROMPT = `你的任务是从全部切片中精选 3-5 个代表性切片。

要求：
- 每个对应一种典型的写作场景（战斗/日常/高潮/对话/描写）
- 最能体现该作者的文风特征
- 附上选取理由

输出格式（Markdown）：

## 样本 {序号}: {标题}
- 场景类型: {战斗/日常/高潮/对话/描写}
- 选取理由: {一句话说明为什么这个切片最能代表该场景的文风}

{切片正文}

---
`;

export function buildSampleSelectionMessages(
  slicesSummary: string,
  styleProfile: string,
  plotReport: string,
) {
  const userMessage = `## 文风档案\n\n${styleProfile}\n\n---\n\n## 情节规律报告\n\n${plotReport}\n\n---\n\n## 切片列表\n\n${slicesSummary}`;
  return { systemPrompt: getPrompt('source-samples', DEFAULT_SYSTEM_PROMPT), userMessage };
}
