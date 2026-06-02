// ============================================
// Zustand 全局状态管理
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedNovel, AIProviderType, AppState } from '@/types';

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // 上传的小说
      novels: [],

      // 分析报告
      analysisReport: null,
      isAnalyzing: false,

      // 仿写
      writeResult: null,
      isWriting: false,

      // AI 设置
      providerType: 'deepseek' as AIProviderType,
      apiKey: '',
      model: 'deepseek-chat',
      baseURL: '',

      // Actions
      addNovel: (novel: ParsedNovel) =>
        set((state) => ({ novels: [...state.novels, novel] })),

      removeNovel: (id: string) =>
        set((state) => ({ novels: state.novels.filter((n) => n.id !== id) })),

      clearNovels: () => set({ novels: [], analysisReport: null }),

      setAnalysisReport: (report: string | null) =>
        set({ analysisReport: report }),

      setIsAnalyzing: (v: boolean) => set({ isAnalyzing: v }),

      setWriteResult: (result: string | null) =>
        set({ writeResult: result }),

      setIsWriting: (v: boolean) => set({ isWriting: v }),

      setAISettings: (settings) => set((state) => ({ ...state, ...settings })),
    }),
    {
      name: 'ainovr-storage',
      // 只持久化设置和小说元数据（不存 fullText，太大）
      partialize: (state) => ({
        providerType: state.providerType,
        apiKey: state.apiKey,
        model: state.model,
        baseURL: state.baseURL,
      }),
    }
  )
);
