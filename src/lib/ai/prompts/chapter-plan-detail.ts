// ============================================
// Layer 5 填充: 单章详细计划
// ============================================

const SYSTEM_PROMPT = `/* PLACEHOLDER: 单章详细计划提示词待设计 */

你的任务是为指定章节生成详细计划。

要求：
- 约 100 字
- 包含：3-5 个场景节拍、小情节模式结构（触发→发展→高潮→收尾）、情节关键词、节奏指令、伏笔操作、铺垫任务
- 最大自由度：集合只给方向和情节模式结构，具体场景自由发挥
`;

export function buildChapterPlanDetailMessages(
  setContent: string,
  planFramework: string,
  chapterIndex: number,
  minorPlotPatterns: string,
) {
  const userMessage = `## 集合规划\n\n${setContent}\n\n---\n\n## 章节计划框架\n\n${planFramework}\n\n---\n\n## 小情节模式库\n\n${minorPlotPatterns}\n\n---\n\n请为第 ${chapterIndex + 1} 章生成详细计划。`;
  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
