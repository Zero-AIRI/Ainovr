// ============================================
// 提示词覆盖辅助 — 运行时从 store 读取自定义覆盖
// ============================================

import { usePromptStore } from '@/lib/store/prompts';

/**
 * 获取提示词内容：优先使用自定义覆盖，否则使用默认值。
 * 在 prompt builder 函数内部调用，确保每次构建时都能拿到最新版本。
 */
export function getPrompt(key: string, defaultValue: string): string {
  try {
    return usePromptStore.getState().getPrompt(key) || defaultValue;
  } catch {
    // store 未初始化时 fallback
    return defaultValue;
  }
}
