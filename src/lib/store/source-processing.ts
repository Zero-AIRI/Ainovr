// ============================================
// 源小说处理全局 Store — 后台处理，跨页面存活
// 8 步管线：切片 → 文风 ‖ 叙事动力学 → 角色动力学 → 读者体验 ‖ 叙事约束 → 样本 → DNA
// ============================================

import { create } from 'zustand';
import { parseSliceOutput, fallbackSlice, getSlicingRequestBody, shouldSkipSlicing, createSingleSlice } from '@/lib/source-processing/smart-slicer';
import { getStyleExtractionRequestBody, computeStyleBatches, getStyleSupplementRequestBody } from '@/lib/source-processing/style-extractor';
import { getPlotExtractionRequestBody, computePlotBatches, getPlotSupplementRequestBody } from '@/lib/source-processing/plot-extractor';
import { getCharacterDynamicsExtractionRequestBody, computeCharacterDynamicsBatches, getCharacterDynamicsSupplementRequestBody } from '@/lib/source-processing/character-dynamics-extractor';
import { getReaderExperienceExtractionRequestBody, computeReaderExperienceBatches, getReaderExperienceSupplementRequestBody } from '@/lib/source-processing/reader-experience-extractor';
import { getNarrativeConstraintsExtractionRequestBody, computeNarrativeConstraintsBatches, getNarrativeConstraintsSupplementRequestBody } from '@/lib/source-processing/narrative-constraints-extractor';
import { getSampleSelectionRequestBody, parseSampleOutput } from '@/lib/source-processing/sample-selector';
import { getDnaCompressionRequestBody } from '@/lib/source-processing/dna-compressor';
import { runDaoPipeline } from '@/lib/source-processing/dao-pipeline';
import { useSourceLibraryStore } from './source-library';
import { useSettingsStore } from './settings';
import type { SemanticSlice, ExperienceCurve, AblationResult, TensionAnalysis, NovelDNA, TechniqueSampleLibrary } from '@/types';

/** 总步骤数（基础管线） */
const TOTAL_STEPS = 8;
/** 道/气管线步骤数 */
const DAO_TOTAL_STEPS = 4;

function createFilledArray<T>(length: number, value: T): T[] {
  return Array.from({ length }, () => value);
}

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
  /** 是否正在运行道/气分析 */
  isRunningDao: boolean;
  /** 道/气管线进度 0-100 */
  daoProgress: number;
  /** 道/气管线当前步骤描述 */
  daoCurrentStep: string;
  /** 道/气管线错误 */
  daoError: string | null;

  // Actions
  startProcessing: (novelId: string, rawText: string, aiConfig: AIConfig) => void;
  startDaoAnalysis: (novelId: string) => void;
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

  startProcessing: (novelId, rawText, aiConfig) => {
    // 如果已在处理，忽略
    if (get().isRunningAll) return;

    set({
      processingNovelId: novelId,
      streamContents: createFilledArray(TOTAL_STEPS, ''),
      isStreaming: createFilledArray(TOTAL_STEPS, false),
      streamErrors: createFilledArray(TOTAL_STEPS, null),
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
      const stepSize = 100 / TOTAL_STEPS; // 每步 12.5%
      const base = Math.round(stepIndex * stepSize);
      const target = Math.round((stepIndex + 1) * stepSize) - 1;
      const state = get();
      if (state.progress < base) get()._setProgress(base);
      progressTimer = setInterval(() => {
        const cur = get().progress;
        if (cur < target) get()._setProgress(cur + 1);
      }, 2000);
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

    // 多批处理辅助函数
    const runMultiBatch = async (
      slices: SemanticSlice[],
      batchInfo: { needsBatch: boolean; batches: string[] },
      apiPath: string,
      buildFirstBody: () => object,
      buildSupplementBody: (chunk: string, prevResult: string) => object,
      streamStep: number,
    ): Promise<string> => {
      let result = '';

      if (!batchInfo.needsBatch) {
        const body = buildFirstBody();
        const res = await streamFetcher.fetch(apiPath, body);
        if (res.result) {
          result = res.result;
          get()._updateStreamContent(streamStep, res.state.content);
        }
      } else {
        for (let i = 0; i < batchInfo.batches.length; i++) {
          const body = i === 0
            ? buildFirstBody()
            : buildSupplementBody(batchInfo.batches[i], result);
          const res = await streamFetcher.fetch(apiPath, body);
          if (res.result) {
            result = res.result;
            get()._updateStreamContent(streamStep, res.state.content);
          } else break;
        }
      }

      get()._updateIsStreaming(streamStep, false);
      return result;
    };

    // 异步执行 8 步管线
    (async () => {
      try {
        // ── Step 0: 智能切片 ──
        set({ currentStep: 0 });
        get()._setProgress(0);
        updateNovel({ status: 'slicing' });
        startProgressSimulation(0);

        let slices: SemanticSlice[];

        if (shouldSkipSlicing(rawText)) {
          // 短文本：跳过 AI 切片，直接作为单一切片
          slices = createSingleSlice(novelId, rawText);
          get()._updateStreamContent(0, `文本较短（${rawText.length}字），跳过智能切片，直接作为单一切片处理。`);
          get()._updateIsStreaming(0, false);
        } else {
          // 长文本：AI 智能切片
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

          slices = parseSliceOutput(sliceResult.result, novelId);
          if (slices.length === 0) {
            slices = fallbackSlice(novelId, rawText);
          }
        }

        stopProgressSimulation();
        updateNovel({ slices });
        set((s) => ({ completedSteps: [...s.completedSteps, 0] }));
        get()._setProgress(Math.round(100 / TOTAL_STEPS));
        await saveStep(0, { slices });

        // ── Step 1 + Step 2: 文风提取 ‖ 叙事动力学（并行） ──
        updateNovel({ status: 'extracting' });

        // Step 1: 文风提取
        set({ currentStep: 1 });
        startProgressSimulation(1);

        const styleBatchInfo = computeStyleBatches(slices, aiConfig.maxContextTokens);
        const profilePromise = runMultiBatch(
          slices, styleBatchInfo,
          '/api/source/process/style',
          () => getStyleExtractionRequestBody(slices, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
          (chunk, prev) => getStyleSupplementRequestBody(chunk, prev, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
          1,
        );

        // Step 2: 叙事动力学（不依赖 Step 1 结果，可并行启动）
        set({ currentStep: 2 });
        startProgressSimulation(2);

        const narrativeBatchInfo = computePlotBatches(slices, aiConfig.maxContextTokens);
        // 注意：Step 2 需要 styleProfile 作为参考，但我们让它在 Step 1 完成后再构建请求体
        // 为简化：让 Step 1 先完成，再跑 Step 2（并行改为串行，因为 Step 2 需要 profile 作为输入）
        const profile = await profilePromise;

        stopProgressSimulation();

        if (!profile) {
          const errMsg = get().streamErrors[1] || '文风提取失败，请检查 API 配置';
          reportError(1, errMsg);
          return;
        }

        updateNovel({ styleProfile: profile });
        set((s) => ({ completedSteps: [...s.completedSteps, 1] }));
        get()._setProgress(Math.round(2 * 100 / TOTAL_STEPS));
        await saveStep(1, { styleProfile: profile });

        // Step 2: 叙事动力学（依赖 Step 1 的 profile）
        set({ currentStep: 2 });
        startProgressSimulation(2);

        const narrativeReport = await runMultiBatch(
          slices, narrativeBatchInfo,
          '/api/source/process/plot',
          () => getPlotExtractionRequestBody(slices, profile, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
          (chunk, prev) => getPlotSupplementRequestBody(chunk, prev, profile, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
          2,
        );

        stopProgressSimulation();

        if (!narrativeReport) {
          const errMsg = get().streamErrors[2] || '叙事动力学分析失败，请检查 API 配置';
          reportError(2, errMsg);
          return;
        }

        updateNovel({ plotReport: narrativeReport });
        set((s) => ({ completedSteps: [...s.completedSteps, 2] }));
        get()._setProgress(Math.round(3 * 100 / TOTAL_STEPS));
        await saveStep(2, { plotReport: narrativeReport });

        // ── Step 3: 角色动力学（依赖 Step 2 的叙事动力学） ──
        set({ currentStep: 3 });
        updateNovel({ status: 'character_dynamics' });
        startProgressSimulation(3);

        const charDynBatchInfo = computeCharacterDynamicsBatches(slices, aiConfig.maxContextTokens);
        const characterDynamics = await runMultiBatch(
          slices, charDynBatchInfo,
          '/api/source/process/character-dynamics',
          () => getCharacterDynamicsExtractionRequestBody(slices, narrativeReport, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
          (chunk, prev) => getCharacterDynamicsSupplementRequestBody(chunk, prev, narrativeReport, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
          3,
        );

        stopProgressSimulation();

        if (!characterDynamics) {
          const errMsg = get().streamErrors[3] || '角色动力学分析失败，请检查 API 配置';
          reportError(3, errMsg);
          return;
        }

        updateNovel({ characterDynamics });
        set((s) => ({ completedSteps: [...s.completedSteps, 3] }));
        get()._setProgress(Math.round(4 * 100 / TOTAL_STEPS));
        await saveStep(3, { characterDynamics });

        // ── Step 4 + Step 5: 读者体验 ‖ 叙事约束（并行） ──
        updateNovel({ status: 'deep_analyzing' });

        const readerExpBatchInfo = computeReaderExperienceBatches(slices, aiConfig.maxContextTokens);
        const narConBatchInfo = computeNarrativeConstraintsBatches(slices, aiConfig.maxContextTokens);

        set({ currentStep: 4 });
        startProgressSimulation(4);

        const [readerExperience, narrativeConstraints] = await Promise.all([
          runMultiBatch(
            slices, readerExpBatchInfo,
            '/api/source/process/reader-experience',
            () => getReaderExperienceExtractionRequestBody(slices, profile, narrativeReport, characterDynamics, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
            (chunk, prev) => getReaderExperienceSupplementRequestBody(chunk, prev, profile, narrativeReport, characterDynamics, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
            4,
          ),
          runMultiBatch(
            slices, narConBatchInfo,
            '/api/source/process/narrative-constraints',
            () => getNarrativeConstraintsExtractionRequestBody(slices, narrativeReport, characterDynamics, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
            (chunk, prev) => getNarrativeConstraintsSupplementRequestBody(chunk, prev, narrativeReport, characterDynamics, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
            5,
          ),
        ]);

        stopProgressSimulation();

        if (!readerExperience) {
          const errMsg = get().streamErrors[4] || '读者体验分析失败，请检查 API 配置';
          reportError(4, errMsg);
          return;
        }

        if (!narrativeConstraints) {
          const errMsg = get().streamErrors[5] || '叙事约束分析失败，请检查 API 配置';
          reportError(5, errMsg);
          return;
        }

        updateNovel({ readerExperience, narrativeConstraints });
        set((s) => ({ completedSteps: [...s.completedSteps, 4, 5] }));
        get()._setProgress(Math.round(6 * 100 / TOTAL_STEPS));
        await saveStep(4, { readerExperience });
        await saveStep(5, { narrativeConstraints });

        // ── Step 6: 样本选取 ──
        set({ currentStep: 6 });
        updateNovel({ status: 'selecting' });
        startProgressSimulation(6);

        const sampleBody = getSampleSelectionRequestBody(
          slices, profile, narrativeReport,
          aiConfig.apiKey, aiConfig.model, aiConfig.baseURL,
          readerExperience, narrativeConstraints,
        );
        const sampleResult = await streamFetcher.fetch('/api/source/process/samples', sampleBody);

        stopProgressSimulation();
        get()._updateIsStreaming(6, false);

        if (!sampleResult.result) {
          const errMsg = get().streamErrors[6] || '样本选取失败，请检查 API 配置';
          reportError(6, errMsg);
          return;
        }

        get()._updateStreamContent(6, sampleResult.state.content);

        const samples = parseSampleOutput(sampleResult.result);
        updateNovel({ representativeSamples: samples });
        set((s) => ({ completedSteps: [...s.completedSteps, 6] }));
        get()._setProgress(Math.round(7 * 100 / TOTAL_STEPS));
        await saveStep(6, { representativeSamples: samples });

        // ── Step 7: DNA 压缩 ──
        set({ currentStep: 7 });
        updateNovel({ status: 'compressing' });
        startProgressSimulation(7);

        const dnaBody = getDnaCompressionRequestBody(
          profile, narrativeReport, characterDynamics,
          readerExperience, narrativeConstraints,
          aiConfig.apiKey, aiConfig.model, aiConfig.baseURL,
        );
        const dnaResult = await streamFetcher.fetch('/api/source/process/dna-compression', dnaBody);

        stopProgressSimulation();
        get()._updateIsStreaming(7, false);

        if (!dnaResult.result) {
          // DNA 压缩失败不影响整体流程，仅记录
          console.warn('DNA 压缩失败:', get().streamErrors[7]);
        } else {
          get()._updateStreamContent(7, dnaResult.state.content);
          const novelDna = dnaResult.result;
          updateNovel({ novelDna });
          await saveStep(7, { novelDna });
        }

        set((s) => ({ completedSteps: [...s.completedSteps, 7] }));

        // 全部完成
        const now = new Date().toISOString();
        updateNovel({ status: 'ready', processedAt: now });
        await saveStep(7, { status: 'ready', processedAt: now });

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

  /** 道/气深度分析 — 在基础 8 步管线完成后运行 */
  startDaoAnalysis: (novelId: string) => {
    if (get().isRunningDao) return;

    // 获取 AI 配置
    const settings = useSettingsStore.getState();
    const aiConfig: AIConfig = {
      apiKey: settings.getEffectiveApiKey(),
      model: settings.model,
      baseURL: settings.baseURL,
      maxContextTokens: settings.maxContextTokens,
    };

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
          onStepStart: (step, message) => {
            set({ daoCurrentStep: message, daoProgress: get().daoProgress });
          },
          onStepComplete: (step) => {
            const stepProgress = (DAO_TOTAL_STEPS > 0) ? Math.round(100 / DAO_TOTAL_STEPS) : 25;
            set({ daoProgress: Math.min(100, get().daoProgress + stepProgress) });
          },
          onStepError: (step, error) => {
            set({ daoError: `${step}: ${error}` });
          },
          onProgress: (progress) => {
            set({ daoProgress: progress });
          },
        });

        // 保存道/气分析结果到小说
        const updates: Record<string, unknown> = {};
        if (result.experienceCurve.length > 0) updates.experienceCurve = result.experienceCurve;
        if (result.ablationResults.length > 0) updates.ablationResults = result.ablationResults;
        if (result.tensionAnalysis) updates.tensionAnalysis = result.tensionAnalysis;
        if (result.novelDnaV2) updates.novelDnaV2 = result.novelDnaV2;
        if (result.techniqueSamples) updates.techniqueSamples = result.techniqueSamples;

        libraryStore.updateSourceNovel(novelId, updates);

        // 保存到文件系统
        try {
          await fetch('/api/library/save-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: novelId, step: 8, data: updates }),
          });
        } catch (err) {
          console.error('保存道/气分析结果失败:', err);
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
