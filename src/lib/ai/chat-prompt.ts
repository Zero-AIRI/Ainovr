// ============================================
// 小说问答 — 系统提示词 + 消息构建
// ============================================

import type { ChatMessage } from '@/types';

/**
 * 构建小说问答的系统提示和消息列表
 * 小说全文作为知识库注入 system prompt
 */
export function buildChatMessages(
  novelTexts: string[],
  novelTitles: string[],
  history: ChatMessage[],
  userQuestion: string,
) {
  const knowledgeBase = novelTexts.map((text, i) =>
    `## 《${novelTitles[i]}》\n\n${text}`
  ).join('\n\n---\n\n');

  const systemPrompt = `你是 Ainovr 小助手的问答 AI。你的知识库是用户上传的小说原文，你的任务是基于这些小说内容回答用户的问题。

## 规则

1. **基于原文回答**：优先从小说原文中寻找依据，引用原文内容佐证你的回答。
2. **不知道就说不知道**：如果问题超出小说原文的范围，坦诚告知，不要编造内容。
3. **可以分析、可以创作**：用户可能问你人物性格、剧情走向、写作手法、或者让你模仿原文风格写一段。都可以，但必须基于原文。
4. **多部小说时**：区分不同作品的内容，引用时标注出自哪部作品。
5. **简洁明了**：回答要直击要点，不要啰嗦。

## 知识库（小说原文）

${knowledgeBase}`;

  // 只允许 user/assistant 角色通过，防止注入 system 消息
  const messages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  // 追加当前用户问题
  messages.push({ role: 'user', content: userQuestion });

  return { systemPrompt, messages };
}
