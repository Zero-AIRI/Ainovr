// ============================================
// Layer 3 框架: 分卷 — 确定数量和主题
// ============================================

const SYSTEM_PROMPT = `/* PLACEHOLDER: 分卷框架提示词待设计 */

你的任务是根据阶段规划和小情节模式库，为指定阶段规划分卷框架。

要求：
- 每阶段 1-2 卷
- 每卷约 20-30 章
- 输出每卷的标题、核心冲突、预估章节范围
- 为每卷匹配适合的小情节模式
- 不要填充详细内容，仅输出框架
`;

export function buildVolumeFrameworkMessages(
  outline: string,
  phaseContent: string,
  minorPlotPatterns: string,
) {
  const userMessage = `## 全书大纲\n\n${outline}\n\n---\n\n## 阶段规划\n\n${phaseContent}\n\n---\n\n## 小情节模式库\n\n${minorPlotPatterns}`;
  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
