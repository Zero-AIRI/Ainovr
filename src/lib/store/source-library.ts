// ============================================
// 素材库 Store — 服务端为主，浏览器缓存
// ============================================

import { create } from 'zustand';
import type { SourceNovel, SourceNovelStatus, PipelineTask } from '@/types';

/** 处理中的过渡态 — 页面刷新后不应残留 */
const TRANSIENT_STATUSES: SourceNovelStatus[] = [
  'indexing', 'segmenting', 'slicing', 'extracting',
  'character_dynamics', 'deep_analyzing', 'selecting',
  'evolution_modeling', 'compressing',
];

export interface SourceLibraryState {
  /** 浏览器内存缓存 */
  sourceNovels: SourceNovel[];
  /** 当前正在查看/处理的源小说 ID */
  activeSourceId: string | null;
  /** 当前管线任务 */
  activeTask: PipelineTask | null;

  // 数据加载
  loadSourceNovels: () => Promise<void>;

  // 增删改
  addSourceNovel: (novel: SourceNovel) => void;
  removeSourceNovel: (id: string) => void;
  updateSourceNovel: (id: string, updates: Partial<SourceNovel>) => void;

  // 导航
  setActiveSourceId: (id: string | null) => void;
  setActiveTask: (task: PipelineTask | null) => void;
}

export const useSourceLibraryStore = create<SourceLibraryState>()((set) => ({
  sourceNovels: [],
  activeSourceId: null,
  activeTask: null,

  loadSourceNovels: async () => {
    try {
      const res = await fetch('/api/library/list');
      if (!res.ok) return;
      const data = await res.json();
      const novels: SourceNovel[] = (data.novels ?? []).map((n: SourceNovel) =>
        TRANSIENT_STATUSES.includes(n.status)
          ? { ...n, status: 'error' as SourceNovelStatus }
          : n,
      );
      set({ sourceNovels: novels });
    } catch (err) {
      console.error('加载素材库失败:', err);
    }
  },

  addSourceNovel: (novel) => {
    set((state) => ({ sourceNovels: [...state.sourceNovels, novel] }));
  },

  removeSourceNovel: (id) => {
    set((state) => ({
      sourceNovels: state.sourceNovels.filter((n) => n.id !== id),
      activeSourceId: state.activeSourceId === id ? null : state.activeSourceId,
    }));
  },

  updateSourceNovel: (id, updates) => {
    set((state) => ({
      sourceNovels: state.sourceNovels.map((n) =>
        n.id === id ? { ...n, ...updates } : n
      ),
    }));
  },

  setActiveSourceId: (id) => set({ activeSourceId: id }),
  setActiveTask: (task) => set({ activeTask: task }),
}));
