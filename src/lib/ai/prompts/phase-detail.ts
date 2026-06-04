// ============================================
// Layer 2 填充: 单个阶段详细规划
// ============================================

const SYSTEM_PROMPT = `/* PLACEHOLDER: 阶段规划详细提示词待设计 */

你的任务是为指定阶段生成详细规划。

要求：
- 约 500 字
- 包含：阶段主题、关键事件（3-5个）、伏笔计划、节奏安排（小爽点位置+大高潮位置）、缓冲空间
- 严格遵循上级大纲的约束
`;

export function buildPhaseDetailMessages(
  outline: string,
  phaseFramework: string,
  phaseIndex: number,
  plotGuide: string,
) {
  const userMessage = `## 全书大纲\n\n${outline}\n\n---\n\n## 阶段框架\n\n${phaseFramework}\n\n---\n\n## 节奏与伏笔规则\n\n${plotGuide}\n\n---\n\n请为第 ${phaseIndex + 1} 个阶段生成详细规划。`;
  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
