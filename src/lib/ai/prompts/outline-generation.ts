// ============================================
// Layer 1: 全书大纲 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

const DEFAULT_SYSTEM_PROMPT = `你的任务是根据大情节框架和用户的创作想法，生成一份全书大纲。

要求：
- 约 200 字
- 包含：大情节框架节点映射、5 个关键转折（不可变锚点）、主角弧线、结局方向
- 严格遵循大情节框架的结构
`;

export function buildOutlineGenerationMessages(
  styleGuide: string,
  plotGuide: string,
  userConcept: string,
) {
  const userMessage = `## 文风参考\n\n${styleGuide}\n\n---\n\n## 情节规律参考（大情节框架）\n\n${plotGuide}\n\n---\n\n## 我的创作想法\n\n${userConcept}`;
  return { systemPrompt: getPrompt('outline', DEFAULT_SYSTEM_PROMPT), userMessage };
}
