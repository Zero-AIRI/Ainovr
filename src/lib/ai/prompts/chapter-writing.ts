// ============================================
// 章节正文生成 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你的任务是根据章节计划和上下文，生成章节正文。

生成前上下文包含：
1. 风格指导（文风档案 + 情节规律报告）
2. 道/气上下文（核心吸引力 + 阅读状态维持方法）
3. 节奏处方（势能模式 + 骨肉填充比例 + 避坑指南）
4. 层级上下文（大纲/阶段/卷/集合）
5. 本章任务（章节计划 + 小情节模式结构 + 关键词）
6. 前文状态（前情提要 + 上文续写）

## 核心原则

**文风一致性**：严格遵循风格指导的句式、修辞、词汇特征。
**道/气维持**：每个场景必须服务于道/气上下文中的主情绪场。生成时自问：这个场景是否在维持读者应有的阅读状态？
**节奏处方**：遵循节奏处方中的势能模式。在呼吸段落保持松弛感；在推进段落保持紧张度。
**填充物处理**：体验填充(filler_a)必须保留对应比例以维持"气"；机械填充(filler_b)应替换为有意义的呼吸内容。

生成正文时，优先保证"气"的一致性，其次才是文笔模仿。
`;

export function buildChapterWritingMessages(
  styleGuide: string,
  hierarchyContext: string,
  chapterTask: string,
  previousState: string,
  daoContext?: string,
  rhythmPrescription?: string,
) {
  const daoSection = daoContext ? `\n\n## 道/气上下文\n\n${daoContext}` : '';
  const rhythmSection = rhythmPrescription ? `\n\n## 节奏处方\n\n${rhythmPrescription}` : '';
  const userMessage = `## 风格指导\n\n${styleGuide}${daoSection}${rhythmSection}\n\n---\n\n## 层级上下文\n\n${hierarchyContext}\n\n---\n\n## 本章任务\n\n${chapterTask}\n\n---\n\n## 前文状态\n\n${previousState}`;
  return { systemPrompt: getPrompt('chapter-writing', DEFAULT_SYSTEM_PROMPT), userMessage };
}
