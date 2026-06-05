// ============================================
// 源小说处理全局 Store — 后台处理，跨页面存活
// ============================================

import { create } from 'zustand';
import { parseSliceOutput, fallbackSlice, getSlicingRequestBody } from '@/lib/source-processing/smart-slicer';
import { getStyleExtractionRequestBody, computeStyleBatches, getStyleSupplementRequestBody } from '@/lib/source-processing/style-extractor';
import { getPlotExtractionRequestBody, computePlotBatches, getPlotSupplementRequestBody } from '@/lib/source-processing/plot-extractor';
import { getSampleSelectionRequestBody, parseSampleOutput } from '@/lib/source-processing/sample-selector';
import { useSourceLibraryStore } from './source-library';
import type { SemanticSlice } from '@/types';

// ---- 流式 fetch 工具（独立于组件，用于 store 中） ----

interface StreamState {
  content: string;
  isStreaming: boolean;
  error: string | null;
}

function createStreamFetcher() {
  let abortController: AbortController | null = null;

  return {
    abort() {
      abortController?.abort();
      abortController = null;
    },

    async fetch(url: string, body: object): Promise<{ result: string | null; state: StreamState }> {
      this.abort();

      const controller = new AbortController();
      abortController = controller;

      const state: StreamState = { content: '', isStreaming: true, error: null };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: '请求失败' }));
          throw new Error(err.error || `${response.status} 请求失败`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法读取响应流');

        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          state.content = fullText;
        }

        if (!fullText.trim()) {
          throw new Error('模型返回了空响应，请检查 API Key 或模型配置');
        }

        state.isStreaming = false;
        return { result: fullText, state };
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          state.isStreaming = false;
          return { result: null, state };
        }
        const message = err instanceof Error ? err.message : '未知错误';
        state.error = message;
        state.isStreaming = false;
        return { result: null, state };
      } finally {
        if (abortController === controller) {
          abortController = null;
        }
      }
    },
  };
}

// ---- Store 定义 ----

interface AIConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  maxContextTokens: number;
}

export interface SourceProcessingState {
  /** 当前正在处理的小说 ID */
  processingNovelId: string | null;

  /** 4 个步骤的流式内容 */
  streamContents: [string, string, string, string];
  /** 4 个步骤的流式状态 */
  isStreaming: [boolean, boolean, boolean, boolean];
  /** 4 个步骤的错误信息 */
  streamErrors: [string | null, string | null, string | null, string | null];

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

  // Actions
  startProcessing: (novelId: string, rawText: string, aiConfig: AIConfig) => void;
  cancelProcessing: () => void;
  resetProcessing: () => void;

  // 内部更新
  _updateStreamContent: (step: number, content: string) => void;
  _updateIsStreaming: (step: number, streaming: boolean) => void;
  _updateStreamError: (step: number, error: string | null) => void;
  _setProgress: (progress: number) => void;
}

const streamFetcher = createStreamFetcher();

export const useSourceProcessingStore = create<SourceProcessingState>()((set, get) => ({
  processingNovelId: null,
  streamContents: ['', '', '', ''],
  isStreaming: [false, false, false, false],
  streamErrors: [null, null, null, null],
  currentStep: -1,
  completedSteps: [],
  errorStep: null,
  errorMessage: null,
  progress: 0,
  isRunningAll: false,

  _updateStreamContent: (step, content) => {
    set((s) => {
      const arr = [...s.streamContents] as [string, string, string, string];
      arr[step] = content;
      return { streamContents: arr };
    });
  },

  _updateIsStreaming: (step, streaming) => {
    set((s) => {
      const arr = [...s.isStreaming] as [boolean, boolean, boolean, boolean];
      arr[step] = streaming;
      return { isStreaming: arr };
    });
  },

  _updateStreamError: (step, error) => {
    set((s) => {
      const arr = [...s.streamErrors] as [string | null, string | null, string | null, string | null];
      arr[step] = error;
      return { streamErrors: arr, errorMessage: error };
    });
  },

  _setProgress: (progress) => {
    set({ progress: Math.min(100, Math.max(0, Math.round(progress))) });
  },

  startProcessing: (novelId, rawText, aiConfig) => {
    // 如果已在处理，忽略
    if (get().isRunningAll) return;

    set({
      processingNovelId: novelId,
      streamContents: ['', '', '', ''],
      isStreaming: [false, false, false, false],
      streamErrors: [null, null, null, null],
      currentStep: -1,
      completedSteps: [],
      errorStep: null,
      errorMessage: null,
      progress: 0,
      isRunningAll: true,
    });

    const updateNovel = (updates: Record<string, unknown>) => {
      useSourceLibraryStore.getState().updateSourceNovel(novelId, updates);
    };

    const saveStep = async (step: number, data: Record<string, unknown>) => {
      try {
        await fetch('/api/library/save-step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: novelId, step, data }),
        });
      } catch (err) {
        console.error(`保存步骤 ${step} 失败:`, err);
      }
    };

    // ---- 进度平滑推进计时器 ----
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    const startProgressSimulation = (stepIndex: number) => {
      const base = stepIndex * 25;  // 每步起始: 0, 25, 50, 75
      const target = base + 24;     // 每步目标: 24, 49, 74, 99（完成时跳到下一档）
      const state = get();
      if (state.progress < base) get()._setProgress(base);
      progressTimer = setInterval(() => {
        const cur = get().progress;
        if (cur < target) get()._setProgress(cur + 1);
      }, 2000); // 每 2 秒推 1%
    };
    const stopProgressSimulation = () => {
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    };

    // 即时报错辅助
    const reportError = (step: number, message: string) => {
      stopProgressSimulation();
      set({ errorStep: step, errorMessage: message, isRunningAll: false, currentStep: -1, processingNovelId: null });
      updateNovel({ status: 'error' });
    };

    // 异步执行 4 步管线
    (async () => {
      try {
        // ── Step 0: 智能切片 ──
        set({ currentStep: 0 });
        get()._setProgress(0);
        updateNovel({ status: 'slicing' });
        startProgressSimulation(0);

        const sliceBody = getSlicingRequestBody(rawText, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL);
        const sliceResult = await streamFetcher.fetch('/api/source/process/slice', sliceBody);

        stopProgressSimulation();

        if (!sliceResult.result) {
          const errMsg = sliceResult.state.error || '智能切片失败，请检查 API 配置';
          get()._updateStreamError(0, errMsg);
          reportError(0, errMsg);
          return;
        }

        get()._updateStreamContent(0, sliceResult.state.content);
        get()._updateIsStreaming(0, false);

        let slices = parseSliceOutput(sliceResult.result, novelId);
        if (slices.length === 0) {
          slices = fallbackSlice(novelId, rawText);
        }
        updateNovel({ slices });
        set((s) => ({ completedSteps: [...s.completedSteps, 0] }));
        get()._setProgress(25);

        await saveStep(0, { slices });

        // ── Step 1: 文风提取 ──
        set({ currentStep: 1 });
        updateNovel({ status: 'extracting' });
        startProgressSimulation(1);

        const styleBatchInfo = computeStyleBatches(slices, aiConfig.maxContextTokens);
        let profile = '';

        if (!styleBatchInfo.needsBatch) {
          const body = getStyleExtractionRequestBody(slices, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL, aiConfig.maxContextTokens);
          const res = await streamFetcher.fetch('/api/source/process/style', body);
          if (res.result) {
            profile = res.result;
            get()._updateStreamContent(1, res.state.content);
          }
        } else {
          for (let i = 0; i < styleBatchInfo.batches.length; i++) {
            const body = i === 0
              ? getStyleExtractionRequestBody(slices, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL, aiConfig.maxContextTokens)
              : getStyleSupplementRequestBody(styleBatchInfo.batches[i], profile, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL);
            const res = await streamFetcher.fetch('/api/source/process/style', body);
            if (res.result) {
              profile = res.result;
              get()._updateStreamContent(1, res.state.content);
            } else break;
          }
        }

        stopProgressSimulation();
        get()._updateIsStreaming(1, false);

        if (!profile) {
          const errMsg = get().streamErrors[1] || '文风提取失败，请检查 API 配置';
          reportError(1, errMsg);
          return;
        }

        updateNovel({ styleProfile: profile });
        set((s) => ({ completedSteps: [...s.completedSteps, 1] }));
        get()._setProgress(50);
        await saveStep(1, { styleProfile: profile });

        // ── Step 2: 情节提取 ──
        set({ currentStep: 2 });
        startProgressSimulation(2);

        const plotBatchInfo = computePlotBatches(slices, aiConfig.maxContextTokens);
        let report = '';

        if (!plotBatchInfo.needsBatch) {
          const body = getPlotExtractionRequestBody(slices, profile, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL);
          const res = await streamFetcher.fetch('/api/source/process/plot', body);
          if (res.result) {
            report = res.result;
            get()._updateStreamContent(2, res.state.content);
          }
        } else {
          for (let i = 0; i < plotBatchInfo.batches.length; i++) {
            const body = i === 0
              ? getPlotExtractionRequestBody(slices, profile, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL)
              : getPlotSupplementRequestBody(plotBatchInfo.batches[i], report, profile, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL);
            const res = await streamFetcher.fetch('/api/source/process/plot', body);
            if (res.result) {
              report = res.result;
              get()._updateStreamContent(2, res.state.content);
            } else break;
          }
        }

        stopProgressSimulation();
        get()._updateIsStreaming(2, false);

        if (!report) {
          const errMsg = get().streamErrors[2] || '情节提取失败，请检查 API 配置';
          reportError(2, errMsg);
          return;
        }

        updateNovel({ plotReport: report });
        set((s) => ({ completedSteps: [...s.completedSteps, 2] }));
        get()._setProgress(75);
        await saveStep(2, { plotReport: report });

        // ── Step 3: 样本选取 ──
        set({ currentStep: 3 });
        updateNovel({ status: 'selecting' });
        startProgressSimulation(3);

        const sampleBody = getSampleSelectionRequestBody(slices, profile, report, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL);
        const sampleResult = await streamFetcher.fetch('/api/source/process/samples', sampleBody);

        stopProgressSimulation();
        get()._updateIsStreaming(3, false);

        if (!sampleResult.result) {
          const errMsg = get().streamErrors[3] || '样本选取失败，请检查 API 配置';
          reportError(3, errMsg);
          return;
        }

        get()._updateStreamContent(3, sampleResult.state.content);

        const samples = parseSampleOutput(sampleResult.result);
        const now = new Date().toISOString();
        updateNovel({ representativeSamples: samples, status: 'ready', processedAt: now });
        set((s) => ({ completedSteps: [...s.completedSteps, 3] }));
        get()._setProgress(100);
        await saveStep(3, { representativeSamples: samples, status: 'ready', processedAt: now });

        // 全部完成
        set({ isRunningAll: false, currentStep: -1, progress: 100, processingNovelId: null });
      } catch (err) {
        stopProgressSimulation();
        const msg = err instanceof Error ? err.message : '处理管线异常';
        console.error('处理管线异常:', err);
        const step = get().currentStep;
        reportError(Math.max(step, 0), msg);
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
      isStreaming: [false, false, false, false],
      progress: 0,
      errorMessage: null,
    });
  },

  resetProcessing: () => {
    streamFetcher.abort();
    set({
      processingNovelId: null,
      streamContents: ['', '', '', ''],
      isStreaming: [false, false, false, false],
      streamErrors: [null, null, null, null],
      currentStep: -1,
      completedSteps: [],
      errorStep: null,
      errorMessage: null,
      isRunningAll: false,
      progress: 0,
    });
  },
}));
