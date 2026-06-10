// ============================================
// Layer 1: 全书大纲 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你的任务是根据大情节框架、道/气上下文和用户的创作想法，生成一份全书大纲。

要求：
- 约 200 字
- 包含：大情节框架节点映射、5 个关键转折（不可变锚点）、主角弧线、结局方向
- 严格遵循大情节框架的结构
- 大纲的整体情绪基调必须与道/气上下文中的主情绪场一致
`;

export function buildOutlineGenerationMessages(
  styleGuide: string,
  plotGuide: string,
  userConcept: string,
  daoContext?: string,
  rhythmPrescription?: string,
) {
  const daoSection = daoContext ? `\n\n---\n\n## 道/气上下文（核心吸引力）\n\n${daoContext}` : '';
  const rhythmSection = rhythmPrescription ? `\n\n---\n\n## 节奏处方\n\n${rhythmPrescription}` : '';
  const userMessage = `## 文风参考\n\n${styleGuide}\n\n---\n\n## 情节规律参考（大情节框架）\n\n${plotGuide}${daoSection}${rhythmSection}\n\n---\n\n## 我的创作想法\n\n${userConcept}`;
  return { systemPrompt: getPrompt('outline', DEFAULT_SYSTEM_PROMPT), userMessage };
}
