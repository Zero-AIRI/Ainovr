// ============================================
// 源小说处理全局 Store — 后台处理，跨页面存活
// 薄封装：状态管理 + 调用管线函数 + 持久化结果
// ============================================

import { create } from 'zustand';
import { runBasicPipeline, determineResumeStep, TOTAL_STEPS, type BasicPipelineCallbacks } from '@/lib/source-processing/basic-pipeline';
import { runDaoPipeline } from '@/lib/source-processing/dao-pipeline';
import { createStreamFetcher, type AIConfig } from '@/lib/stream-fetcher';
import { useSourceLibraryStore } from './source-library';
import { useSettingsStore } from './settings';
import type { ExperienceCurve, AblationResult, TensionAnalysis, NovelDNA, TechniqueSampleLibrary } from '@/types';

/** 道/气管线步骤数 */
const DAO_TOTAL_STEPS = 4;

function createFilledArray<T>(length: number, value: T): T[] {
  return Array.from({ length }, () => value);
}

export interface SourceProcessingState {
  /** 当前正在处理的小说 ID */
  processingNovelId: string | null;

  /** 8 个步骤的流式内容 */
  streamContents: string[];
  /** 8 个步骤的流式状态 */
  isStreaming: boolean[];
  /** 8 个步骤的错误信息 */
  streamErrors: (string | null)[];

  /** 当前步骤（-1 = idle） */
  currentStep: number;
  /** 已完成的步骤 */
  completedSteps: number[];
  /** 出错的步骤 */
  errorStep: number | null;
  /** 错误信息 */
  errorMessage: string | null;

  /** 总进度 0-100 */
  progress: number;

  /** 是否正在运行一键处理 */
  isRunningAll: boolean;

  // ── 道/气管线状态 ──
  isRunningDao: boolean;
  daoProgress: number;
  daoCurrentStep: string;
  daoError: string | null;

  // Actions
  startProcessing: (novelId: string, rawText: string, aiConfig: AIConfig) => void;
  resumeProcessing: (novelId: string) => void;
  startDaoAnalysis: (novelId: string) => void;
  cancelProcessing: () => void;
  resetProcessing: () => void;

  // 内部更新
  _updateStreamContent: (step: number, content: string) => void;
  _updateIsStreaming: (step: number, streaming: boolean) => void;
  _updateStreamError: (step: number, error: string | null) => void;
  _setProgress: (progress: number) => void;
}

// 模块级 fetcher 用于 abort
const streamFetcher = createStreamFetcher();

export const useSourceProcessingStore = create<SourceProcessingState>()((set, get) => ({
  processingNovelId: null,
  streamContents: createFilledArray(TOTAL_STEPS, ''),
  isStreaming: createFilledArray(TOTAL_STEPS, false),
  streamErrors: createFilledArray(TOTAL_STEPS, null),
  currentStep: -1,
  completedSteps: [],
  errorStep: null,
  errorMessage: null,
  progress: 0,
  isRunningAll: false,
  isRunningDao: false,
  daoProgress: 0,
  daoCurrentStep: '',
  daoError: null,

  _updateStreamContent: (step, content) => {
    set((s) => {
      const arr = [...s.streamContents];
      arr[step] = content;
      return { streamContents: arr };
    });
  },

  _updateIsStreaming: (step, streaming) => {
    set((s) => {
      const arr = [...s.isStreaming];
      arr[step] = streaming;
      return { isStreaming: arr };
    });
  },

  _updateStreamError: (step, error) => {
    set((s) => {
      const arr = [...s.streamErrors];
      arr[step] = error;
      return { streamErrors: arr, errorMessage: error };
    });
  },

  _setProgress: (progress) => {
    set({ progress: Math.min(100, Math.max(0, Math.round(progress))) });
  },

  /** 从头开始处理（始终从 Step 0 开始） */
  startProcessing: (novelId, rawText, aiConfig) => {
    if (get().isRunningAll) return;
    runPipelineInternal(novelId, rawText, aiConfig, null, set, get);
  },

  /** 从断点恢复处理（自动跳过已完成步骤） */
  resumeProcessing: (novelId) => {
    if (get().isRunningAll) return;

    const aiConfig = useSettingsStore.getState().getAIConfig();

    const novel = useSourceLibraryStore.getState().sourceNovels.find((n) => n.id === novelId);
    const resumeStep = determineResumeStep(novel ?? null);
    if (resumeStep >= 7 && novel?.status === 'ready') return; // 已完成

    runPipelineInternal(novelId, null, aiConfig, novel ?? null, set, get);
  },

  /** 道/气深度分析 — 在基础 8 步管线完成后运行 */
  startDaoAnalysis: (novelId: string) => {
    if (get().isRunningDao) return;

    const aiConfig = useSettingsStore.getState().getAIConfig();

    const libraryStore = useSourceLibraryStore.getState();
    const novel = libraryStore.sourceNovels.find((n) => n.id === novelId);
    if (!novel || !novel.slices) {
      set({ daoError: '缺少切片数据，请先完成基础分析' });
      return;
    }

    set({
      isRunningDao: true,
      daoProgress: 0,
      daoCurrentStep: '准备中...',
      daoError: null,
    });

    (async () => {
      try {
        const result = await runDaoPipeline(novel, aiConfig, {
          onStepStart: (_step, message) => {
            set({ daoCurrentStep: message });
          },
          onStepComplete: () => {
            const stepProgress = Math.round(100 / DAO_TOTAL_STEPS);
            set({ daoProgress: Math.min(100, get().daoProgress + stepProgress) });
          },
          onStepError: (step, error) => {
            set({ daoError: `${step}: ${error}` });
          },
          onProgress: (progress) => {
            set({ daoProgress: progress });
          },
        }, streamFetcher);

        // 保存结果
        const updates: Record<string, unknown> = {};
        if (result.experienceCurve.length > 0) updates.experienceCurve = result.experienceCurve;
        if (result.ablationResults.length > 0) updates.ablationResults = result.ablationResults;
        if (result.tensionAnalysis) updates.tensionAnalysis = result.tensionAnalysis;
        if (result.novelDnaV2) updates.novelDnaV2 = result.novelDnaV2;
        if (result.techniqueSamples) updates.techniqueSamples = result.techniqueSamples;

        libraryStore.updateSourceNovel(novelId, updates);

        try {
          const res = await fetch('/api/library/save-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: novelId, step: 8, data: updates }),
          });
          if (!res.ok) {
            console.error('保存道/气分析结果失败:', res.status);
            set({ daoError: `保存失败: HTTP ${res.status}` });
          }
        } catch (err) {
          console.error('保存道/气分析结果失败:', err);
          set({ daoError: `保存失败: ${err instanceof Error ? err.message : '网络错误'}` });
        }

        set({ isRunningDao: false, daoProgress: 100, daoCurrentStep: '完成' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '道/气分析异常';
        console.error('道/气分析异常:', err);
        set({ isRunningDao: false, daoError: msg, daoCurrentStep: '失败' });
      }
    })();
  },

  cancelProcessing: () => {
    streamFetcher.abort();
    const novelId = get().processingNovelId;
    if (novelId) {
      useSourceLibraryStore.getState().updateSourceNovel(novelId, { status: 'error' });
    }
    set({
      processingNovelId: null,
      isRunningAll: false,
      currentStep: -1,
      isStreaming: createFilledArray(TOTAL_STEPS, false),
      progress: 0,
      errorMessage: null,
      isRunningDao: false,
      daoProgress: 0,
      daoCurrentStep: '',
      daoError: null,
    });
  },

  resetProcessing: () => {
    streamFetcher.abort();
    set({
      processingNovelId: null,
      streamContents: createFilledArray(TOTAL_STEPS, ''),
      isStreaming: createFilledArray(TOTAL_STEPS, false),
      streamErrors: createFilledArray(TOTAL_STEPS, null),
      currentStep: -1,
      completedSteps: [],
      errorStep: null,
      errorMessage: null,
      isRunningAll: false,
      progress: 0,
      isRunningDao: false,
      daoProgress: 0,
      daoCurrentStep: '',
      daoError: null,
    });
  },
}));

// ---- 内部管线执行 ----

function runPipelineInternal(
  novelId: string,
  rawText: string | null,
  aiConfig: AIConfig,
  novel: import('@/types').SourceNovel | null,
  set: (partial: Partial<SourceProcessingState> | ((s: SourceProcessingState) => Partial<SourceProcessingState>)) => void,
  get: () => SourceProcessingState,
) {
  const resumeStep = determineResumeStep(novel);

  set({
    processingNovelId: novelId,
    streamContents: createFilledArray(TOTAL_STEPS, ''),
    isStreaming: createFilledArray(TOTAL_STEPS, false),
    streamErrors: createFilledArray(TOTAL_STEPS, null),
    currentStep: -1,
    completedSteps: resumeStep > 0 ? Array.from({ length: resumeStep }, (_, i) => i) : [],
    errorStep: null,
    errorMessage: null,
    progress: Math.round(resumeStep * 100 / TOTAL_STEPS),
    isRunningAll: true,
  });

  const callbacks: BasicPipelineCallbacks = {
    onStepStart: (step, _message) => {
      set({ currentStep: step });
    },
    onStepComplete: (step) => {
      set((s) => {
        const completed = [...s.completedSteps];
        if (!completed.includes(step)) completed.push(step);
        return { completedSteps: completed };
      });
    },
    onStreamUpdate: (step, content) => {
      get()._updateStreamContent(step, content);
    },
    onStreamError: (step, error) => {
      get()._updateStreamError(step, error);
    },
    onProgress: (progress) => {
      get()._setProgress(progress);
    },
    onSaveStep: async (step, data) => {
      try {
        const res = await fetch('/api/library/save-step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: novelId, step, data }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          console.error(`保存步骤 ${step} 失败:`, err);
          get()._updateStreamError(step, `保存失败: ${err.error || res.status}`);
        }
      } catch (err) {
        console.error(`保存步骤 ${step} 失败:`, err);
        get()._updateStreamError(step, `保存失败: ${err instanceof Error ? err.message : '网络错误'}`);
      }
    },
    onUpdateNovel: (updates) => {
      useSourceLibraryStore.getState().updateSourceNovel(novelId, updates);
    },
  };

  (async () => {
    try {
      await runBasicPipeline(novelId, rawText, aiConfig, novel, callbacks, streamFetcher);
      set({ isRunningAll: false, currentStep: -1, progress: 100, processingNovelId: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '处理管线异常';
      console.error('处理管线异常:', err);
      const step = get().currentStep;
      set({
        errorStep: Math.max(step, 0),
        errorMessage: msg,
        isRunningAll: false,
        currentStep: -1,
        processingNovelId: null,
      });
      useSourceLibraryStore.getState().updateSourceNovel(novelId, { status: 'error' });
    }
  })();
}
