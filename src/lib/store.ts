// ============================================
// Zustand 全局状态管理
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedNovel, AIProviderType, AppState, ActiveView, CustomProvider, ChatMessage, ImportConfig } from '@/types';
import { saveNovel, loadAllNovels, removeNovel as idbRemoveNovel, clearAllNovels as idbClearNovels } from '@/lib/sync/idb-helpers';
import { cleanNovelText } from '@/lib/text-cleaner';
import { smartSample, DEFAULT_IMPORT_CONFIG } from '@/lib/file-parser';
import { saveNovelToServer } from '@/lib/utils';

/** 深度克隆 ImportConfig，防止共享引用污染模块常量 */
function cloneImportConfig(config: ImportConfig): ImportConfig {
  return {
    cleaning: { ...config.cleaning, enabledSteps: [...config.cleaning.enabledSteps] },
    sampling: {
      ...config.sampling,
      chapter: { ...config.sampling.chapter },
      fixedLength: { ...config.sampling.fixedLength },
    },
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
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

      // 文本处理配置（深克隆默认值，防止共享引用）
      importConfig: cloneImportConfig(DEFAULT_IMPORT_CONFIG),

      // 文件同步状态
      syncStatus: 'no-folder' as const,
      syncError: null,
      folderName: null,

      // Actions
      setActiveView: (view: ActiveView) => set({ activeView: view }),

      addNovel: (novel: ParsedNovel) => {
        set((state) => ({ novels: [...state.novels, novel] }));
        saveNovel(novel).catch(console.error);
      },

      removeNovel: (id: string) => {
        set((state) => ({ novels: state.novels.filter((n) => n.id !== id) }));
        idbRemoveNovel(id).catch(console.error);
      },

      clearNovels: () => {
        set({ novels: [], analysisReport: null });
        idbClearNovels().catch(console.error);
      },

      setAnalysisReport: (report: string | null) =>
        set({ analysisReport: report }),

      setIsAnalyzing: (v: boolean) => set({ isAnalyzing: v }),

      setWriteResult: (result: string | null) =>
        set({ writeResult: result }),

      setIsWriting: (v: boolean) => set({ isWriting: v }),

      setAISettings: (settings) => set(settings),

      setCustomProviders: (providers: CustomProvider[]) =>
        set({ customProviders: providers }),

      // 文本处理
      updateImportConfig: (partial: Partial<ImportConfig>) => {
        set((state) => ({
          importConfig: {
            cleaning: { ...state.importConfig.cleaning, ...(partial.cleaning ?? {}) },
            sampling: { ...state.importConfig.sampling, ...(partial.sampling ?? {}) },
          },
        }));
      },

      reprocessNovel: async (novelId: string) => {
        const state = get();
        const novel = state.novels.find((n) => n.id === novelId);
        if (!novel) return;
        if (!novel.rawText) {
          throw new Error(`小说"${novel.title}"缺少原始文本，无法重新处理。请重新导入该小说。`);
        }

        const cleaned = cleanNovelText(novel.rawText, state.importConfig.cleaning);
        const sampleText = smartSample(cleaned, state.importConfig.sampling);

        const updated: ParsedNovel = {
          ...novel,
          fullText: cleaned,
          sampleText,
          totalChars: cleaned.length,
          importConfig: cloneImportConfig(state.importConfig),
        };

        // 先持久化到 IndexedDB，再更新内存状态
        await saveNovel(updated);

        set((s) => ({
          novels: s.novels.map((n) => (n.id === novelId ? updated : n)),
        }));

        // 持久化到本地 data/novels/
        await saveNovelToServer({ id: updated.id, title: updated.title, fullText: updated.fullText });
      },

      reprocessAllNovels: async () => {
        const state = get();
        const novelsToReprocess = state.novels.filter((n) => n.rawText);
        // 并行处理独立的小说
        await Promise.allSettled(
          novelsToReprocess.map((n) => get().reprocessNovel(n.id)),
        );
      },

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

      // 从 IndexedDB 恢复小说数据（启动时调用），同时迁移旧数据
      loadNovelsFromIDB: async () => {
        try {
          const novels = await loadAllNovels();
          // 旧数据迁移：填充缺失的 rawText / importConfig 字段
          const migrated = novels.map((n) => ({
            ...n,
            rawText: n.rawText ?? null,
            importConfig: n.importConfig ?? null,
          }));
          set({ novels: migrated });
        } catch (err) {
          console.error('从 IndexedDB 恢复小说失败:', err);
        }
      },
    }),
    {
      name: 'ainovr-storage',
      version: 2,
      migrate: (persisted, version) => {
        if (version <= 1) {
          const state = persisted as Record<string, unknown>;
          return {
            ...state,
            thinkingMode: (state as Record<string, unknown>).thinkingMode ?? false,
            thinkingEffort: (state as Record<string, unknown>).thinkingEffort ?? 'high',
            customProviders: (state as Record<string, unknown>).customProviders ?? [],
            importConfig: (state as Record<string, unknown>).importConfig ?? undefined,
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
        importConfig: state.importConfig,
      }),
    }
  )
);
