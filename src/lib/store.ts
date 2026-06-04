// ============================================
// Zustand 全局状态管理
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedNovel, AppState, ActiveView } from '@/types';
import { saveNovel, loadAllNovels, removeNovel as idbRemoveNovel, clearAllNovels as idbClearNovels } from '@/lib/sync/idb-helpers';
import { chunkText, DEFAULT_MAX_CHUNK_SIZE } from '@/lib/chunker';
import { saveNovelToServer } from '@/lib/utils';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // 视图
      activeView: 'analyze' as ActiveView,

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
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL,

      // 最大上下文 Token 数
      maxContextTokens: 1000000,

      // Actions
      setActiveView: (view: ActiveView) => set({ activeView: view }),

      addNovel: (novel: ParsedNovel) => {
        set((state) => ({
          novels: [...state.novels, novel],
        }));
        saveNovel(novel).catch(console.error);
      },

      removeNovel: (id: string) => {
        set((state) => ({
          novels: state.novels.filter((n) => n.id !== id),
        }));
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

      // 从 IndexedDB 恢复小说数据（启动时调用）
      loadNovelsFromIDB: async () => {
        try {
          const novels = await loadAllNovels();
          const migrated = await Promise.all(novels.map(async (n) => {
            let updated = {
              ...n,
              rawText: n.rawText ?? null,
              importConfig: n.importConfig ?? null,
            };

            // 旧数据迁移：有 sampleText 但没有 chunks → 重新分块
            if ((!updated.chunks || updated.chunks.length === 0) && updated.fullText) {
              updated.chunks = chunkText(updated.id, updated.fullText, DEFAULT_MAX_CHUNK_SIZE);
              await saveNovel(updated);
            }

            return updated;
          }));

          set({ novels: migrated });
        } catch (err) {
          console.error('从 IndexedDB 恢复小说失败:', err);
        }
      },

      // 运行时解析 API Key：用户配置优先，环境变量兜底
      getEffectiveApiKey: () => {
        const stored = get().apiKey;
        if (stored.trim()) return stored;
        return process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY ?? '';
      },
    }),
    {
      name: 'ainovr-storage',
      version: 6,
      migrate: (persisted, version) => {
        let state = persisted as Record<string, unknown>;

        if (version <= 2) {
          if (!state.baseURL) {
            state = { ...state, baseURL: DEFAULT_BASE_URL, model: state.model || DEFAULT_MODEL };
          }
        }
        if (version <= 3) {
          delete state.providerType;
          delete state.customProviders;
          if (!state.baseURL) {
            state = { ...state, baseURL: DEFAULT_BASE_URL };
          }
        }
        if (version <= 4) {
          state = { ...state, apiKey: '' };
        }
        if (version <= 5) {
          // v5 → v6：删除已废弃的字段，添加新字段
          delete state.thinkingMode;
          delete state.thinkingEffort;
          delete state.chatMessages;
          delete state.importConfig;
          delete state.selectedBookIds;
          state = {
            ...state,
            activeView: 'analyze',
            maxContextTokens: 1000000,
          };
        }
        return state;
      },
      partialize: (state) => ({
        apiKey: state.apiKey,
        model: state.model,
        baseURL: state.baseURL,
        maxContextTokens: state.maxContextTokens,
      }),
    }
  )
);
