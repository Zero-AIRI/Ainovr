// ============================================
// Layer 4 框架: 章节集合 — 确定数量和主题
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你的任务是根据卷规划，为指定卷规划章节集合框架。

要求：
- 每卷 3-5 个集合
- 每个集合 5-8 章
- 输出每个集合的标题、情节推进方向、预估章节范围
- 安排小情节模式的出场顺序
- 不要填充详细内容，仅输出框架
`;

export function buildChapterSetFrameworkMessages(
  volumeContent: string,
  minorPlotPatterns: string,
) {
  const userMessage = `## 卷规划\n\n${volumeContent}\n\n---\n\n## 小情节模式库\n\n${minorPlotPatterns}`;
  return { systemPrompt: getPrompt('chapter-set-framework', DEFAULT_SYSTEM_PROMPT), userMessage };
}
