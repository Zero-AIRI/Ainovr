// ============================================
// AI 后端提供商 — DeepSeek + 自定义 OpenAI 兼容接口
// ============================================

import { createOpenAI } from '@ai-sdk/openai';
import type { AIProviderType, CustomProvider, ThinkingEffort } from '@/types';
import { isCustomProvider, getCustomId } from '@/types';

interface ProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  customProviders: CustomProvider[];
}

/**
 * 根据提供商类型创建对应的 AI 模型实例
 * 支持: 'deepseek' | 'custom:xxx'
 */
export function createAIModel(provider: AIProviderType, options: ProviderOptions) {
  // 自定义供应商
  if (isCustomProvider(provider)) {
    const id = getCustomId(provider);
    const cp = options.customProviders.find((p) => p.id === id);
    if (!cp) throw new Error(`自定义供应商不存在: ${id}`);
    return createOpenAI({
      apiKey: options.apiKey || undefined,
      baseURL: cp.baseURL,
    })(options.model);
  }

  // DeepSeek
  return createOpenAI({
    apiKey: options.apiKey,
    baseURL: 'https://api.deepseek.com/v1',
  })(options.model);
}

/** 获取预设提供商默认模型名 */
export function getDefaultModel(): string {
  return 'deepseek-chat';
}

/** 构建 DeepSeek 思考模式的 providerOptions */
export function buildThinkingOptions(
  provider: AIProviderType,
  thinkingMode: boolean,
  thinkingEffort: ThinkingEffort,
): { openai: { reasoning_effort: string } } | undefined {
  if (provider !== 'deepseek' || !thinkingMode) return undefined;

  return {
    openai: {
      reasoning_effort: thinkingEffort,
    },
  };
}
