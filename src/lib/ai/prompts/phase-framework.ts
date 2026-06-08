// ============================================
// Layer 2 框架: 阶段规划 — 确定数量和主题
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你的任务是根据全书大纲和节奏/伏笔规则，规划阶段框架。

要求：
- 输出 4-6 个阶段的标题和预估章节范围
- 每个阶段对应大纲中的哪些大情节节点
- 标注大高潮位置和伏笔埋设计划
- 不要填充详细内容，仅输出框架

输出格式：
1. 阶段标题（第X-Y章）：对应大情节节点 / 预估字数
2. ...
`;

export function buildPhaseFrameworkMessages(
  outline: string,
  plotGuide: string,
) {
  const userMessage = `## 全书大纲\n\n${outline}\n\n---\n\n## 节奏与伏笔规则\n\n${plotGuide}`;
  return { systemPrompt: getPrompt('phase-framework', DEFAULT_SYSTEM_PROMPT), userMessage };
}
