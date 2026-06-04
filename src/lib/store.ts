// ============================================
// Zustand 全局状态管理
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedNovel, AppState, ActiveView, ChatMessage, ImportConfig } from '@/types';
import { saveNovel, loadAllNovels, removeNovel as idbRemoveNovel, clearAllNovels as idbClearNovels } from '@/lib/sync/idb-helpers';
import { cleanNovelText } from '@/lib/text-cleaner';
import { chunkText, DEFAULT_MAX_CHUNK_SIZE } from '@/lib/chunker';
import { DEFAULT_IMPORT_CONFIG, DEFAULT_CLEANING_CONFIG } from '@/lib/file-parser';
import { saveNovelToServer } from '@/lib/utils';

/** 深度克隆 ImportConfig，防止共享引用污染模块常量 */
function cloneImportConfig(config: ImportConfig): ImportConfig {
  return {
    cleaning: { ...config.cleaning, enabledSteps: [...config.cleaning.enabledSteps] },
    maxChunkSize: config.maxChunkSize,
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

      // API 设置
      apiKey: '',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com',

      // 思考模式
      thinkingMode: false,
      thinkingEffort: 'high' as const,

      // 聊天记录
      chatMessages: [] as ChatMessage[],

      // 文本处理配置（深克隆默认值，防止共享引用）
      importConfig: cloneImportConfig(DEFAULT_IMPORT_CONFIG),

      // 问答选中的书籍 ID
      selectedBookIds: [] as string[],

      // Actions
      setActiveView: (view: ActiveView) => set({ activeView: view }),

      addNovel: (novel: ParsedNovel) => {
        set((state) => ({
          novels: [...state.novels, novel],
          selectedBookIds: [...state.selectedBookIds, novel.id],
        }));
        saveNovel(novel).catch(console.error);
      },

      removeNovel: (id: string) => {
        set((state) => ({
          novels: state.novels.filter((n) => n.id !== id),
          selectedBookIds: state.selectedBookIds.filter((nid) => nid !== id),
        }));
        idbRemoveNovel(id).catch(console.error);
      },

      clearNovels: () => {
        set({ novels: [], analysisReport: null, selectedBookIds: [] });
        idbClearNovels().catch(console.error);
      },

      setAnalysisReport: (report: string | null) =>
        set({ analysisReport: report }),

      setIsAnalyzing: (v: boolean) => set({ isAnalyzing: v }),

      setWriteResult: (result: string | null) =>
        set({ writeResult: result }),

      setIsWriting: (v: boolean) => set({ isWriting: v }),

      setAISettings: (settings) => set(settings),

      // 文本处理
      updateImportConfig: (partial: Partial<ImportConfig>) => {
        set((state) => ({
          importConfig: {
            cleaning: { ...state.importConfig.cleaning, ...(partial.cleaning ?? {}) },
            maxChunkSize: partial.maxChunkSize ?? state.importConfig.maxChunkSize,
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
        const chunks = chunkText(novel.id, cleaned, state.importConfig.maxChunkSize);

        const updated: ParsedNovel = {
          ...novel,
          fullText: cleaned,
          chunks,
          totalChars: cleaned.length,
          importConfig: cloneImportConfig(state.importConfig),
        };

        // 先持久化到 IndexedDB，再更新内存状态
        await saveNovel(updated);

        set((s) => ({
          novels: s.novels.map((n) => (n.id === novelId ? updated : n)),
        }));

        // 持久化到本地 data/novels/
        await saveNovelToServer({ id: updated.id, title: updated.title, fullText: updated.fullText, chunks: updated.chunks });
      },

      reprocessAllNovels: async () => {
        const state = get();
        const novelsToReprocess = state.novels.filter((n) => n.rawText);
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

      // 书籍选择
      setSelectedBookIds: (ids: string[]) => set({ selectedBookIds: ids }),

      toggleSelectedBook: (novelId: string) => {
        set((state) => ({
          selectedBookIds: state.selectedBookIds.includes(novelId)
            ? state.selectedBookIds.filter((id) => id !== novelId)
            : [...state.selectedBookIds, novelId],
        }));
      },

      // 从 IndexedDB 恢复小说数据（启动时调用），同时迁移旧数据
      loadNovelsFromIDB: async () => {
        try {
          const novels = await loadAllNovels();
          const migrated = await Promise.all(novels.map(async (n) => {
            // 填充缺失的 rawText / importConfig 字段
            let updated = {
              ...n,
              rawText: n.rawText ?? null,
              importConfig: n.importConfig ?? null,
            };

            // 旧数据迁移：有 sampleText 但没有 chunks → 重新分块
            if ((!updated.chunks || updated.chunks.length === 0) && updated.fullText) {
              updated.chunks = chunkText(updated.id, updated.fullText, DEFAULT_MAX_CHUNK_SIZE);
              // 持久化迁移结果
              await saveNovel(updated);
            }

            return updated;
          }));

          // 自动选中所有书籍
          const allIds = migrated.map((n) => n.id);
          set({ novels: migrated, selectedBookIds: allIds });
        } catch (err) {
          console.error('从 IndexedDB 恢复小说失败:', err);
        }
      },
    }),
    {
      name: 'ainovr-storage',
      version: 4,
      migrate: (persisted, version) => {
        let state = persisted as Record<string, unknown>;
        if (version <= 2) {
          // 旧版本迁移：添加缺失字段
          if (!state.selectedBookIds) {
            state = { ...state, selectedBookIds: [] };
          }
          const ic = state.importConfig as Record<string, unknown> | undefined;
          if (ic) {
            if ('sampling' in ic) delete ic.sampling;
            if (!('maxChunkSize' in ic) || ic.maxChunkSize == null) {
              (ic as Record<string, unknown>).maxChunkSize = DEFAULT_MAX_CHUNK_SIZE;
            }
          } else {
            state = { ...state, importConfig: { cleaning: DEFAULT_CLEANING_CONFIG, maxChunkSize: DEFAULT_MAX_CHUNK_SIZE } };
          }
          // 设置默认 baseURL
          if (!state.baseURL) {
            state = { ...state, baseURL: 'https://api.deepseek.com', model: state.model || 'deepseek-v4-flash' };
          }
        }
        if (version <= 3) {
          // v3 → v4：移除 providerType / customProviders
          delete (state as Record<string, unknown>).providerType;
          delete (state as Record<string, unknown>).customProviders;
          if (!state.baseURL) {
            state = { ...state, baseURL: 'https://api.deepseek.com' };
          }
        }
        return state as Record<string, unknown>;
      },
      partialize: (state) => ({
        apiKey: state.apiKey,
        model: state.model,
        baseURL: state.baseURL,
        thinkingMode: state.thinkingMode,
        thinkingEffort: state.thinkingEffort,
        importConfig: state.importConfig,
        selectedBookIds: state.selectedBookIds,
      }),
    }
  )
);
