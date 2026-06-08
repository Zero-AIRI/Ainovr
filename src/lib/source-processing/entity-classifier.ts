// ============================================
// 实体分类 — AI 对候选实体列表分类
// ============================================

import { buildEntityClassificationMessages } from '@/lib/ai/prompts/entity-classification';
import type { EntityIndex, EntityType } from '@/types';

/**
 * 解析 AI 分类输出
 * 输入：每行 "实体名: 类型"
 */
export function parseClassificationOutput(raw: string): Map<string, EntityType> {
  const result = new Map<string, EntityType>();
  const validTypes: EntityType[] = ['character', 'location', 'organization', 'artifact', 'concept'];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 匹配 "实体名: 类型" 或 "实体名：类型"
    const match = trimmed.match(/^(.+?)\s*[:：]\s*(\w+)/);
    if (match) {
      const name = match[1].trim().replace(/^\d+\.\s*/, ''); // 去掉序号
      const type = match[2].trim().toLowerCase() as EntityType;
      if (name && validTypes.includes(type)) {
        result.set(name, type);
      }
    }
  }

  return result;
}

/**
 * 用 AI 分类结果更新 EntityIndex 的 type 字段
 */
export function applyClassificationToIndex(
  entityIndex: EntityIndex,
  classification: Map<string, EntityType>,
): EntityIndex {
  const updated = { ...entityIndex };

  for (const [name, type] of classification) {
    if (updated[name]) {
      updated[name] = { ...updated[name], type };
    }
  }

  return updated;
}

/**
 * 批量分类：将实体列表分批，每批发给 AI 分类
 * 每批约 50 个实体，控制 token 消耗
 */
export function batchEntityNames(
  entityNames: string[],
  batchSize: number = 50,
): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < entityNames.length; i += batchSize) {
    batches.push(entityNames.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * 获取实体分类的请求体
 */
export function getEntityClassificationRequestBody(
  novelTitle: string,
  entityNames: string[],
  apiKey: string,
  model: string,
  baseURL: string,
) {
  const { systemPrompt, userMessage } = buildEntityClassificationMessages(novelTitle, entityNames);
  return { systemPrompt, userMessage, apiKey, model, baseURL };
}
