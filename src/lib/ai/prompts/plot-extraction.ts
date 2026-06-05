// ============================================
// Step 2b: 情节规律提取 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

const DEFAULT_SYSTEM_PROMPT = `你的任务是分析小说文本，提取情节规律，分为大情节和小情节两个层级。

## 提取内容

### 一、大情节框架
- 识别小说的整体结构类型（如退婚流、废柴逆袭、重生流等）
- 提取大情节的核心节点和典型章节位置
- 提取关键词标签

### 二、小情节模式库（10-20个）
- 识别反复出现的情节模式（如装逼打脸、奇遇、拍卖会等）
- 对每个模式：命名、拆解结构、统计频率、标注典型章节、提取关键词

### 三、伏笔手法
- 提前量、回收方式、密度、关键伏笔示例

### 四、节奏规律
- 小爽点间隔、大高潮间隔、战斗/过渡/日常占比

输出为 Markdown 格式的情节规律报告（plot_report.md）。
`;

const DEFAULT_SUPPLEMENT_PROMPT = `你之前已经分析了该作者的部分作品并生成了一份情节规律报告。
现在你收到了更多文本。请结合新文本，对情节规律报告进行补充和修正。
输出完整的更新后的情节规律报告。
`;

export function buildPlotExtractionMessages(slicesText: string, styleProfile: string) {
  const userMessage = `## 文风档案（参考）\n\n${styleProfile}\n\n---\n\n## 小说文本\n\n${slicesText}`;
  return { systemPrompt: getPrompt('source-plot', DEFAULT_SYSTEM_PROMPT), userMessage };
}

export function buildPlotSupplementMessages(newChunk: string, previousReport: string, styleProfile: string) {
  const userMessage = `## 之前的情节规律报告\n\n${previousReport}\n\n---\n\n## 文风档案（参考）\n\n${styleProfile}\n\n---\n\n## 新的文本片段\n\n${newChunk}\n\n---\n\n请基于以上全部信息，输出完整的、更新后的情节规律报告。`;
  return { systemPrompt: getPrompt('source-plot-supplement', DEFAULT_SUPPLEMENT_PROMPT), userMessage };
}
