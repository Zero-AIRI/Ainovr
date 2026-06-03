// ============================================
// Zustand 全局状态管理
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedNovel, AIProviderType, AppState, ActiveView, CustomProvider, ChatMessage } from '@/types';

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // 视图
      activeView: 'welcome' as ActiveView,

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

      // DeepSeek 思考模式
      thinkingMode: false,
      thinkingEffort: 'high' as const,

      // 自定义供应商列表
      customProviders: [] as CustomProvider[],

      // 聊天记录
      chatMessages: [] as ChatMessage[],

      // 文件同步状态
      syncStatus: 'no-folder' as const,
      syncError: null,
      folderName: null,

      // Actions
      setActiveView: (view: ActiveView) => set({ activeView: view }),

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

      setAISettings: (settings) => set(settings),

      setCustomProviders: (providers: CustomProvider[]) =>
        set({ customProviders: providers }),

      // 聊天记录
      setChatMessages: (messages: ChatMessage[]) =>
        set({ chatMessages: messages }),

      addChatMessage: (message: ChatMessage) =>
        set((state) => ({ chatMessages: [...state.chatMessages, message] })),

      clearChatMessages: () => set({ chatMessages: [] }),

      // 文件同步
      setSyncStatus: (status) => set({ syncStatus: status }),
      setSyncError: (error) => set({ syncError: error }),
      setFolderName: (name) => set({ folderName: name }),
    }),
    {
      name: 'ainovr-storage',
      version: 1,
      migrate: (persisted, version) => {
        if (version === 0) {
          // v0 → v1: 新增 thinkingMode, thinkingEffort, customProviders
          const state = persisted as Record<string, unknown>;
          return {
            ...state,
            thinkingMode: (state as Record<string, unknown>).thinkingMode ?? false,
            thinkingEffort: (state as Record<string, unknown>).thinkingEffort ?? 'high',
            customProviders: (state as Record<string, unknown>).customProviders ?? [],
          };
        }
        return persisted as Record<string, unknown>;
      },
      partialize: (state) => ({
        providerType: state.providerType,
        apiKey: state.apiKey,
        model: state.model,
        baseURL: state.baseURL,
        thinkingMode: state.thinkingMode,
        thinkingEffort: state.thinkingEffort,
        customProviders: state.customProviders,
      }),
    }
  )
);
