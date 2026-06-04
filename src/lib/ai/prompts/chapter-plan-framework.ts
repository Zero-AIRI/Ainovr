// ============================================
// Layer 5 框架: 每章计划 — 确定每章标题和模式
// ============================================

const SYSTEM_PROMPT = `/* PLACEHOLDER: 每章计划框架提示词待设计 */

你的任务是根据章节集合规划，为每章生成计划框架。

要求：
- 输出每章的标题、对应的小情节模式（如适用）、情节关键词
- 不要填充详细内容，仅输出框架列表
`;

export function buildChapterPlanFrameworkMessages(
  setContent: string,
  minorPlotPatterns: string,
) {
  const userMessage = `## 集合规划\n\n${setContent}\n\n---\n\n## 小情节模式库\n\n${minorPlotPatterns}`;
  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
