// ============================================
// AI 多后端提供商注册
// ============================================

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { AIProviderType } from '@/types';

interface ProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
}

/**
 * 根据提供商类型创建对应的 AI 模型实例
 * DeepSeek / Moonshot / Ollama 都兼容 OpenAI API 格式
 */
export function createAIModel(provider: AIProviderType, options: ProviderOptions) {
  switch (provider) {
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

/** 获取提供商默认模型名 */
export function getDefaultModel(provider: AIProviderType): string {
  switch (provider) {
    case 'deepseek': return 'deepseek-chat';
    case 'moonshot': return 'moonshot-v1-128k';
    case 'openai': return 'gpt-4o';
    case 'anthropic': return 'claude-sonnet-4-6';
    case 'ollama': return 'qwen2.5:14b';
    default: return '';
  }
}
