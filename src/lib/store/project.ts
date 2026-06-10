// ============================================
// 写作项目 Store — 服务端为主，浏览器缓存
// ============================================

import { create } from 'zustand';
import type {
  WritingProject,
  BookOutline,
  Phase,
  Volume,
  ChapterSet,
  ChapterPlan,
  GeneratedChapter,
} from '@/types';

export interface ProjectState {
  /** 浏览器内存缓存 */
  projects: WritingProject[];
  /** 当前活跃项目 ID */
  activeProjectId: string | null;

  // 数据加载
  loadProjects: () => Promise<void>;

  // 导航
  setActiveProjectId: (id: string | null) => void;

  // 项目 CRUD
  addProject: (project: WritingProject) => void;
  removeProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<WritingProject>) => void;

  // 五层产出设置
  setOutline: (projectId: string, outline: BookOutline) => void;
  setPhases: (projectId: string, phases: Phase[]) => void;
  setVolumes: (projectId: string, volumes: Volume[]) => void;
  setChapterSets: (projectId: string, sets: ChapterSet[]) => void;
  setChapterPlans: (projectId: string, plans: ChapterPlan[]) => void;

  // 章节生成
  addGeneratedChapter: (projectId: string, chapter: GeneratedChapter) => void;
  updateGeneratedChapter: (projectId: string, chapterId: string, updates: Partial<GeneratedChapter>) => void;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  activeProjectId: null,

  loadProjects: async () => {
    try {
      const res = await fetch('/api/project/list');
      if (!res.ok) return;
      const data = await res.json();
      set({ projects: data.projects ?? [] });
    } catch (err) {
      console.error('加载项目列表失败:', err);
    }
  },

  setActiveProjectId: (id) => set({ activeProjectId: id }),

  addProject: (project) => {
    set((state) => ({ projects: [...state.projects, project] }));
  },

  removeProject: (id) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
    }));
  },

  updateProject: (id, updates) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      ),
    }));
  },

  setOutline: (projectId, outline) => {
    get().updateProject(projectId, { outline, currentLayer: 1 });
  },

  setPhases: (projectId, phases) => {
    get().updateProject(projectId, { phases, currentLayer: 2 });
  },

  setVolumes: (projectId, volumes) => {
    get().updateProject(projectId, { volumes, currentLayer: 3 });
  },

  setChapterSets: (projectId, chapterSets) => {
    get().updateProject(projectId, { chapterSets, currentLayer: 4 });
  },

  setChapterPlans: (projectId, chapterPlans) => {
    get().updateProject(projectId, { chapterPlans, currentLayer: 5 });
  },

  addGeneratedChapter: (projectId, chapter) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, chapters: [...p.chapters, chapter], updatedAt: new Date().toISOString() }
          : p
      ),
    }));
  },

  updateGeneratedChapter: (projectId, chapterId, updates) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              chapters: p.chapters.map((c) =>
                c.id === chapterId ? { ...c, ...updates } : c
              ),
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
    }));
  },
}));
