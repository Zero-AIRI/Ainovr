// ============================================
// 源小说处理全局 Store — 后台处理，跨页面存活
// v2: 统一 7 步管线（替代旧 basic + dao 双管线）
// ============================================

import { create } from 'zustand';
import { runUnifiedPipeline } from '@/lib/source-processing/unified-pipeline';
import { TOTAL_PIPELINE_STEPS } from '@/lib/source-processing/pipeline-types';
import type { PipelineCheckpoint, UnifiedPipelineCallbacks } from '@/lib/source-processing/pipeline-types';
import { createStreamFetcher, type AIConfig } from '@/lib/stream-fetcher';
import { useSourceLibraryStore } from './source-library';
import { useSettingsStore } from './settings';

function createFilledArray<T>(length: number, value: T): T[] {
  return Array.from({ length }, () => value);
}

export interface SourceProcessingState {
  /** 当前正在处理的小说 ID */
  processingNovelId: string | null;

  /** 7 个步骤的流式内容 */
  streamContents: string[];
  /** 7 个步骤的流式状态 */
  isStreaming: boolean[];
  /** 7 个步骤的错误信息 */
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

  // ── 旧版道/气管线状态（保留兼容） ──
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
  streamContents: createFilledArray(TOTAL_PIPELINE_STEPS, ''),
  isStreaming: createFilledArray(TOTAL_PIPELINE_STEPS, false),
  streamErrors: createFilledArray(TOTAL_PIPELINE_STEPS, null),
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

  /** 从头开始处理 */
  startProcessing: (novelId, rawText, aiConfig) => {
    if (get().isRunningAll) return;
    runUnifiedPipelineInternal(novelId, rawText, aiConfig, null, set, get);
  },

  /** 从断点恢复处理（加载已保存的中间产物） */
  resumeProcessing: async (novelId) => {
    if (get().isRunningAll) return;

    const aiConfig = useSettingsStore.getState().getAIConfig();
    const novel = useSourceLibraryStore.getState().sourceNovels.find((n) => n.id === novelId);

    if (novel?.status === 'ready') return;

    // 从服务端加载已保存的中间产物
    const completedSteps: number[] = [];
    let smallSlices: PipelineCheckpoint['smallSlices'] = null;
    let sliceExtractions: PipelineCheckpoint['sliceExtractions'] = null;
    let eventGraph: PipelineCheckpoint['eventGraph'] = null;
    let largeSlices: PipelineCheckpoint['largeSlices'] = null;
    let sliceAnalyses: PipelineCheckpoint['sliceAnalyses'] = null;
    let summaryReport: PipelineCheckpoint['summaryReport'] = null;

    try {
      const res = await fetch(`/api/library/get?id=${novelId}`);
      if (res.ok) {
        const data = await res.json();

        if (data.smallSlices) { smallSlices = data.smallSlices; completedSteps.push(0); }
        if (data.sliceExtractions) { sliceExtractions = data.sliceExtractions; completedSteps.push(1); }
        if (data.eventGraph) { eventGraph = data.eventGraph; completedSteps.push(2); }
        if (data.largeSlices) { largeSlices = data.largeSlices; completedSteps.push(3); }
        if (data.sliceAnalyses) { sliceAnalyses = data.sliceAnalyses; completedSteps.push(4); }
        if (data.summaryReport) { summaryReport = data.summaryReport; completedSteps.push(5); }
        if (data.generationRulesDna) { completedSteps.push(6); }
      }
    } catch (err) {
      console.error('加载断点数据失败，将从头开始:', err);
    }

    const checkpoint: PipelineCheckpoint = {
      novelId,
      currentStep: completedSteps.length,
      completedSteps,
      smallSlices,
      largeSlices,
      sliceExtractions,
      eventGraph,
      sliceAnalyses,
      summaryReport,
    };

    runUnifiedPipelineInternal(novelId, null, aiConfig, checkpoint, set, get);
  },

  /** 道/气分析 — 统一管线已包含，此方法保留兼容但提示已集成 */
  startDaoAnalysis: (novelId: string) => {
    set({ daoError: '道/气分析已集成到统一管线，请使用"一键分析"' });
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
      isStreaming: createFilledArray(TOTAL_PIPELINE_STEPS, false),
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
      streamContents: createFilledArray(TOTAL_PIPELINE_STEPS, ''),
      isStreaming: createFilledArray(TOTAL_PIPELINE_STEPS, false),
      streamErrors: createFilledArray(TOTAL_PIPELINE_STEPS, null),
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

// ---- 内部统一管线执行 ----

function runUnifiedPipelineInternal(
  novelId: string,
  rawText: string | null,
  aiConfig: AIConfig,
  checkpoint: PipelineCheckpoint | null,
  set: (partial: Partial<SourceProcessingState> | ((s: SourceProcessingState) => Partial<SourceProcessingState>)) => void,
  get: () => SourceProcessingState,
) {
  set({
    processingNovelId: novelId,
    streamContents: createFilledArray(TOTAL_PIPELINE_STEPS, ''),
    isStreaming: createFilledArray(TOTAL_PIPELINE_STEPS, false),
    streamErrors: createFilledArray(TOTAL_PIPELINE_STEPS, null),
    currentStep: -1,
    completedSteps: [],
    errorStep: null,
    errorMessage: null,
    progress: 0,
    isRunningAll: true,
  });

  const callbacks: UnifiedPipelineCallbacks = {
    onStepStart: (step, message) => {
      set({ currentStep: step });
      get()._updateStreamContent(step, message);
      get()._updateIsStreaming(step, true);
    },
    onStepComplete: (step) => {
      set((s) => {
        const completed = [...s.completedSteps];
        if (!completed.includes(step)) completed.push(step);
        return { completedSteps: completed };
      });
      get()._updateIsStreaming(step, false);
    },
    onStreamUpdate: (step, content) => {
      get()._updateStreamContent(step, content);
    },
    onStreamError: (step, error) => {
      get()._updateStreamError(step, error);
      get()._updateIsStreaming(step, false);
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
        }
        // 更新源小说状态
        const updates: Record<string, unknown> = {};
        if (step === 6 && data.dna) {
          updates.generationRulesDna = data.dna;
          updates.status = 'ready';
          updates.processedAt = new Date().toISOString();
        }
        if (step === 5 && data.summaryReport) {
          updates.unifiedSummaryReport = data.summaryReport;
        }
        if (Object.keys(updates).length > 0) {
          useSourceLibraryStore.getState().updateSourceNovel(novelId, updates);
        }
      } catch (err) {
        console.error(`保存步骤 ${step} 失败:`, err);
      }
    },
    onUpdateNovel: (updates) => {
      useSourceLibraryStore.getState().updateSourceNovel(novelId, updates);
    },
  };

  (async () => {
    try {
      if (!rawText) {
        // 恢复模式：需要加载原文
        const novel = useSourceLibraryStore.getState().sourceNovels.find(n => n.id === novelId);
        if (!novel) throw new Error('找不到小说数据');
        const res = await fetch(`/api/library/get?id=${novelId}`);
        const data = await res.json();
        rawText = data.rawText;
        if (!rawText) throw new Error('无法加载原文');
      }

      await runUnifiedPipeline(novelId, rawText, aiConfig, checkpoint, callbacks, streamFetcher);
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
