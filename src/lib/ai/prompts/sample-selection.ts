// ============================================
// Step 3: 代表性切片选取 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你的任务是从全部切片中精选 3-5 个代表性切片。

要求：
- 每个对应一种典型的写作场景（战斗/日常/高潮/对话/描写/高潮蓄能/情绪转换/异常结构）
- 最能体现该作者的文风特征和叙事特征
- 优先选取被读者体验分析和叙事约束分析标记为关键的场景
- 附上选取理由

输出格式（Markdown）：

## 样本 {序号}: {标题}
- 场景类型: {战斗/日常/高潮/对话/描写/高潮蓄能/情绪转换/异常结构}
- 选取理由: {一句话说明为什么这个切片最能代表该场景的文风和叙事特征}

{切片正文}

---
`;

export function buildSampleSelectionMessages(
  slicesSummary: string,
  styleProfile: string,
  plotReport: string,
  readerExperience?: string,
  narrativeConstraints?: string,
) {
  const sections = [
    `## 文风档案\n\n${styleProfile}`,
    `## 叙事动力学报告\n\n${plotReport}`,
    readerExperience ? `## 读者体验报告\n\n${readerExperience}` : '',
    narrativeConstraints ? `## 叙事约束报告\n\n${narrativeConstraints}` : '',
    `## 切片列表\n\n${slicesSummary}`,
  ].filter(Boolean).join('\n\n---\n\n');

  return { systemPrompt: getPrompt('source-samples', DEFAULT_SYSTEM_PROMPT), userMessage: sections };
}
