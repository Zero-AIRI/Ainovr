// ============================================
// 章节自动审查 — 系统提示词（5维度）
// ============================================

import { getPrompt } from './helpers';

const DEFAULT_SYSTEM_PROMPT = `你的任务是对生成的章节正文进行 5 维度审查。

审查维度：
1. style_consistency（文风一致性）：是否与目标文风档案一致
2. plot_coherence（情节逻辑）：与层级大纲是否一致，逻辑是否通顺
3. pacing（节奏）：是否符合章节计划的节奏指令
4. pattern_execution（小情节模式执行度）：是否正确执行了指定的小情节模式结构
5. foreshadow_execution（伏笔/铺垫执行度）：是否执行了章节计划中的伏笔操作

对每个维度：
- 打分（1-10）
- 列出问题（如有）
- 给出修正建议（如有）

输出格式（JSON）：
[
  {"dimension": "style_consistency", "score": 8, "issues": [], "suggestions": []},
  ...
]
`;

export function buildChapterReviewMessages(
  chapterContent: string,
  styleGuide: string,
  chapterTask: string,
) {
  const userMessage = `## 文风参考\n\n${styleGuide}\n\n---\n\n## 章节计划\n\n${chapterTask}\n\n---\n\n## 待审查的章节正文\n\n${chapterContent}`;
  return { systemPrompt: getPrompt('chapter-review', DEFAULT_SYSTEM_PROMPT), userMessage };
}
