// ============================================
// 章节修正 — 基于审查结果 + 人工反馈
// ============================================

import { getPrompt } from './helpers';

const DEFAULT_SYSTEM_PROMPT = `你的任务是根据审查结果和（可能的）人工反馈，修正章节正文。

要求：
- 只修正审查中指出的问题，保持其余部分不变
- 如果有人工反馈，优先处理人工反馈
- 修正后的正文必须仍然遵循文风档案和章节计划
- 输出完整的修正后章节正文（不是增量）
`;

export function buildChapterRevisionMessages(
  chapterContent: string,
  reviews: string,
  humanFeedback: string | null,
  styleGuide: string,
  chapterTask: string,
) {
  const feedbackSection = humanFeedback
    ? `\n\n---\n\n## 人工反馈\n\n${humanFeedback}`
    : '';

  const userMessage = `## 文风参考\n\n${styleGuide}\n\n---\n\n## 章节计划\n\n${chapterTask}\n\n---\n\n## 审查结果\n\n${reviews}\n\n---\n\n## 原始章节正文\n\n${chapterContent}${feedbackSection}\n\n---\n\n请输出修正后的完整章节正文。`;
  return { systemPrompt: getPrompt('chapter-revision', DEFAULT_SYSTEM_PROMPT), userMessage };
}
