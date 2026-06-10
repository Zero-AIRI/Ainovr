// ============================================
// 导航 Store — 视图路由，独立于项目数据
// ============================================

import { create } from 'zustand';
import type { ActiveView, PipelineTask } from '@/types';

export interface NavigationState {
  activeView: ActiveView;
  activeTask: PipelineTask | null;

  setActiveView: (view: ActiveView) => void;
  setActiveTask: (task: PipelineTask | null) => void;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  activeView: 'source-library',
  activeTask: null,

  setActiveView: (view) => set({ activeView: view }),
  setActiveTask: (task) => set({ activeTask: task }),
}));
