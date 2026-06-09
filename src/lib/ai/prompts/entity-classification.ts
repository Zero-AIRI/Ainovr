// ============================================
// Step -1A AI补充：实体分类 — 系统提示词
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你是小说实体分类器。你会收到一批候选实体名称，以及小说标题作为上下文。

你的任务：对每个实体判断其类型。

类型定义：
- character（角色）：人物、角色名、代称、称号。注意有些看似普通名词的词在特定小说中是角色名（如《诡秘之主》中"太阳"是角色代号）
- location（地点）：城市、国家、地区、建筑、地理区域
- organization（组织/势力）：门派、组织、势力、团队、种族
- artifact（物品/能力）：武器、法宝、特殊物品、超凡能力名称
- concept（概念/其他）：不属于以上四类的词汇

输出格式（每行一个，严格按 YAML）：
实体名: 类型

示例：
克莱恩: character
廷根: location
值夜者: organization
灰雾之上: concept
阿蒙: character
`;

export function buildEntityClassificationMessages(
  novelTitle: string,
  entityNames: string[],
) {
  const userMessage = `小说标题：《${novelTitle}》\n\n候选实体列表：\n${entityNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
  return { systemPrompt: getPrompt('entity-classification', DEFAULT_SYSTEM_PROMPT), userMessage };
}
