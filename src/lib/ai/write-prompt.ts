// ============================================
// 仿写创作 — 系统提示词模板
// ============================================

import type { WriteLength } from '@/types';

const LENGTH_GUIDE: Record<WriteLength, string> = {
  fragment: '写一个精彩的片段（约500-1000字），展示场景或对话',
  chapter: '写一个完整的章节（约2000-4000字），包含完整的起承转合',
  short: '写一篇短篇小说（约3000-8000字），有完整的故事线',
};

/**
 * 构建仿写创作的系统提示和用户消息
 */
export function buildWriteMessages(
  analysisReport: string,
  genre: string,
  length: WriteLength,
  synopsis: string,
  extraRequirements?: string,
) {
  const systemPrompt = `你是一位天才小说创作者，能够精准模仿任何写作风格进行创作。

你的核心能力是根据给定的风格特征分析报告，创作出在文风、叙事节奏、人物对话、修辞手法等方面高度还原目标风格的新作品。

## 创作原则

1. **风格还原优先**：严格模仿分析报告中的句式、节奏、修辞、口吻
2. **不是抄袭**：创作全新的故事和内容，只在风格层面模仿
3. **人物对话个性化**：每个角色的说话方式要有区分度，符合目标风格的对话特点
4. **叙事节奏一致**：按照目标风格的节奏规律安排情节推进
5. **修辞手法复现**：使用目标风格偏好的修辞技巧和环境描写方式

## 篇幅要求

${LENGTH_GUIDE[length]}

## 类型：${genre}`;

  let userMessage = `## 目标风格分析

${analysisReport}

## 创作任务

- 故事类型：${genre}
- 篇幅：${LENGTH_GUIDE[length]}
- 故事梗概：${synopsis}`;

  if (extraRequirements?.trim()) {
    userMessage += `\n- 额外要求：${extraRequirements}`;
  }

  userMessage += `\n\n请严格按照目标风格分析中描述的风格特征进行仿写创作。现在开始：`;

  return { systemPrompt, userMessage };
}

/**
 * 构建续写的消息
 */
export function buildContinueMessages(
  analysisReport: string,
  existingText: string,
  extraHint?: string,
) {
  const systemPrompt = `你是一位天才小说创作者，正在续写一篇小说。

请严格保持前文的写作风格（参考风格分析报告），继续往下写。

要求：
- 风格与前文完全一致
- 情节自然衔接，不要重复已有内容
- 续写约 500-1000 字
- 保持叙事节奏和修辞手法的一致性`;

  let userMessage = `## 风格参考

${analysisReport}

## 前文内容

${existingText}`;

  if (extraHint?.trim()) {
    userMessage += `\n\n## 续写方向提示\n${extraHint}`;
  }

  userMessage += '\n\n请续写：';

  return { systemPrompt, userMessage };
}
