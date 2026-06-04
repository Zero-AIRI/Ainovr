// ============================================
// Step 2a: 文风提取 — 系统提示词
// ============================================

const SYSTEM_PROMPT = `/* PLACEHOLDER: 文风提取提示词待设计 */

你的任务是深入分析小说文本，提取 6 个维度的写作风格特征。

分析维度：
1. 句式特征（长短句比例、排比/对仗使用）
2. 修辞偏好（比喻、拟人、夸张等手法的使用频率和方式）
3. 词汇特征（文言/白话、口语/书面语、特定词汇频率）
4. 叙事视角（人称、全知/有限视角、语言调性）
5. 对话风格（对话长度、节奏、个性化程度）
6. 描写手法（环境描写、动作描写、心理描写的偏好和方式）

输出为 Markdown 格式的文风档案（style_profile.md）。
`;

const SUPPLEMENT_PROMPT = `/* PLACEHOLDER: 文风补充分析提示词待设计 */

你之前已经分析了该作者的部分作品并生成了一份文风档案。
现在你收到了更多文本。请结合新文本，对文风档案进行补充和修正。
输出完整的更新后的文风档案（不是增量，而是完整版本）。
`;

export function buildStyleExtractionMessages(slicesText: string) {
  return { systemPrompt: SYSTEM_PROMPT, userMessage: slicesText };
}

export function buildStyleSupplementMessages(newChunk: string, previousProfile: string) {
  const userMessage = `## 之前的文风档案\n\n${previousProfile}\n\n---\n\n## 新的文本片段\n\n${newChunk}\n\n---\n\n请基于以上全部信息，输出完整的、更新后的文风档案。`;
  return { systemPrompt: SUPPLEMENT_PROMPT, userMessage };
}
