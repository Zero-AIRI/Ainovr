// ============================================
// 章节正文生成 — 系统提示词
// ============================================

const SYSTEM_PROMPT = `/* PLACEHOLDER: 章节正文生成提示词待设计 */

你的任务是根据章节计划和上下文，生成章节正文。

生成前上下文包含：
1. 风格指导（文风档案 + 情节规律报告）
2. 层级上下文（大纲/阶段/卷/集合）
3. 本章任务（章节计划 + 小情节模式结构 + 关键词 + 节奏指令 + 伏笔操作）
4. 前文状态（前情提要 + 伏笔清单 + 上文续写）

请严格遵循文风档案的风格特征，按照章节计划的场景节拍展开。
`;

export function buildChapterWritingMessages(
  styleGuide: string,
  hierarchyContext: string,
  chapterTask: string,
  previousState: string,
) {
  const userMessage = `## 风格指导\n\n${styleGuide}\n\n---\n\n## 层级上下文\n\n${hierarchyContext}\n\n---\n\n## 本章任务\n\n${chapterTask}\n\n---\n\n## 前文状态\n\n${previousState}`;
  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
