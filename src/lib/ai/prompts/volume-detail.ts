// ============================================
// Layer 3 填充: 单卷详细规划
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你的任务是为指定卷生成详细规划。

要求：
- 约 300 字
- 包含：卷主题、核心冲突、主要事件列表+匹配的小情节模式、人物出场安排
- 弹性约束：可调整事件顺序和形式
`;

export function buildVolumeDetailMessages(
  outline: string,
  phaseContent: string,
  volumeFramework: string,
  volumeIndex: number,
  minorPlotPatterns: string,
) {
  const userMessage = `## 全书大纲\n\n${outline}\n\n---\n\n## 阶段规划\n\n${phaseContent}\n\n---\n\n## 分卷框架\n\n${volumeFramework}\n\n---\n\n## 小情节模式库\n\n${minorPlotPatterns}\n\n---\n\n请为第 ${volumeIndex + 1} 卷生成详细规划。`;
  return { systemPrompt: getPrompt('volume-detail', DEFAULT_SYSTEM_PROMPT), userMessage };
}
