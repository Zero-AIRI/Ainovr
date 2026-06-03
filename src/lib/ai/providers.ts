// ============================================
// AI 多后端提供商注册
// ============================================

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { AIProviderType, CustomProvider, ThinkingEffort, PresetProviderType } from '@/types';
import { isCustomProvider, getCustomId } from '@/types';

interface ProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  customProviders: CustomProvider[];
}

/**
 * 根据提供商类型创建对应的 AI 模型实例
 * providerType 格式: 'deepseek' | 'moonshot' | ... | 'custom:abc123'
 */
export function createAIModel(provider: AIProviderType, options: ProviderOptions) {
  // 自定义供应商
  if (isCustomProvider(provider)) {
    const id = getCustomId(provider);
    const cp = options.customProviders.find((p) => p.id === id);
    if (!cp) throw new Error(`自定义供应商不存在: ${id}`);
    return createOpenAI({
      apiKey: options.apiKey || 'no-key',
      baseURL: cp.baseURL,
    })(options.model);
  }

  const preset = provider as PresetProviderType;

  switch (preset) {
    case 'deepseek':
      return createOpenAI({
        apiKey: options.apiKey,
        baseURL: 'https://api.deepseek.com',
      })(options.model);

    case 'moonshot':
      return createOpenAI({
        apiKey: options.apiKey,
        baseURL: 'https://api.moonshot.cn/v1',
      })(options.model);

    case 'openai':
      return createOpenAI({
        apiKey: options.apiKey,
      })(options.model);

    case 'anthropic':
      return createAnthropic({
        apiKey: options.apiKey,
      })(options.model);

    case 'ollama':
      return createOpenAI({
        baseURL: `${options.baseURL || 'http://localhost:11434'}/v1`,
      })(options.model);

    default:
      throw new Error(`不支持的 AI 提供商: ${provider}`);
  }
}

/** 获取预设提供商默认模型名 */
export function getDefaultModel(provider: PresetProviderType): string {
  switch (provider) {
    case 'deepseek': return 'deepseek-chat';
    case 'moonshot': return 'moonshot-v1-128k';
    case 'openai': return 'gpt-4o';
    case 'anthropic': return 'claude-sonnet-4-6';
    case 'ollama': return 'qwen2.5:14b';
    default: return '';
  }
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
