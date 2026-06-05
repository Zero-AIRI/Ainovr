// ============================================
// Layer 4 填充: 单集合详细规划
// ============================================

import { getPrompt } from './helpers';

const DEFAULT_SYSTEM_PROMPT = `你的任务是为指定章节集合生成详细规划。

要求：
- 约 200 字
- 包含：集合主题、情节推进方向、小情节分配（哪章用哪个模式）、节奏安排（快/慢/中）、伏笔操作点、铺垫任务
- 弹性约束：小情节模式的选择可以灵活替换
`;

export function buildChapterSetDetailMessages(
  volumeContent: string,
  setFramework: string,
  setIndex: number,
  minorPlotPatterns: string,
) {
  const userMessage = `## 卷规划\n\n${volumeContent}\n\n---\n\n## 集合框架\n\n${setFramework}\n\n---\n\n## 小情节模式库\n\n${minorPlotPatterns}\n\n---\n\n请为第 ${setIndex + 1} 个集合生成详细规划。`;
  return { systemPrompt: getPrompt('chapter-set-detail', DEFAULT_SYSTEM_PROMPT), userMessage };
}
