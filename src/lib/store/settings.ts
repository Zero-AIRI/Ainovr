// ============================================
// 设置 Store — API 配置，持久化到 localStorage
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';
import type { AIConfig } from '@/lib/stream-fetcher';

export interface SettingsState {
  apiKey: string;
  model: string;
  baseURL: string;
  maxContextTokens: number;
  thinkingMode: boolean;

  setAISettings: (settings: Partial<Pick<SettingsState, 'apiKey' | 'model' | 'baseURL' | 'maxContextTokens' | 'thinkingMode'>>) => void;
  getEffectiveApiKey: () => string;
  getAIConfig: () => AIConfig;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      apiKey: '',
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL,
      maxContextTokens: 1000000,
      thinkingMode: true,

      setAISettings: (settings) => set(settings),

      getEffectiveApiKey: () => {
        const stored = get().apiKey;
        if (stored.trim()) return stored;
        return process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY ?? '';
      },

      getAIConfig: () => ({
        apiKey: get().getEffectiveApiKey(),
        model: get().model,
        baseURL: get().baseURL,
        maxContextTokens: get().maxContextTokens,
        thinkingMode: get().thinkingMode,
      }),
    }),
    {
      name: 'ainovr-settings',
      version: 8,
      migrate: (persisted, version) => {
        let state = persisted as Record<string, unknown>;

        // v1-2: 添加 baseURL
        if (version <= 2) {
          if (!state.baseURL) {
            state = { ...state, baseURL: DEFAULT_BASE_URL, model: state.model || DEFAULT_MODEL };
          }
        }
        // v3: 清理废弃字段
        if (version <= 3) {
          delete state.providerType;
          delete state.customProviders;
          if (!state.baseURL) {
            state = { ...state, baseURL: DEFAULT_BASE_URL };
          }
        }
        // v4: 重置 apiKey
        if (version <= 4) {
          state = { ...state, apiKey: '' };
        }
        // v5-6: 清理废弃字段
        if (version <= 6) {
          delete state.thinkingMode;
          delete state.thinkingEffort;
          delete state.chatMessages;
          delete state.importConfig;
          delete state.selectedBookIds;
          delete state.novels;
          delete state.analysisReport;
          delete state.isAnalyzing;
          delete state.writeResult;
          delete state.isWriting;
          delete state.activeView;
          state = {
            ...state,
            maxContextTokens: (state.maxContextTokens as number) || 1000000,
          };
        }
        // v8: thinkingMode 重新引入（默认开启）
        if (version <= 7) {
          state = { ...state, thinkingMode: true };
        }
        return state;
      },
    }
  )
);
