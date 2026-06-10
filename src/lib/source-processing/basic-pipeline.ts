// ============================================
// 基础 8 步分析管线 — 独立编排器
// 切片 → 文风 → 叙事动力学 → 角色动力学 → 读者体验 ‖ 叙事约束 → 样本 → DNA
// 支持断点恢复：根据已有数据跳过已完成步骤
// ============================================

import { parseSliceOutput, fallbackSlice, getSlicingRequestBody, shouldSkipSlicing, createSingleSlice } from '@/lib/source-processing/smart-slicer';
import { getStyleExtractionRequestBody, computeStyleBatches, getStyleSupplementRequestBody } from '@/lib/source-processing/style-extractor';
import { getPlotExtractionRequestBody, computePlotBatches, getPlotSupplementRequestBody } from '@/lib/source-processing/plot-extractor';
import { getCharacterDynamicsExtractionRequestBody, computeCharacterDynamicsBatches, getCharacterDynamicsSupplementRequestBody } from '@/lib/source-processing/character-dynamics-extractor';
import { getReaderExperienceExtractionRequestBody, computeReaderExperienceBatches, getReaderExperienceSupplementRequestBody } from '@/lib/source-processing/reader-experience-extractor';
import { getNarrativeConstraintsExtractionRequestBody, computeNarrativeConstraintsBatches, getNarrativeConstraintsSupplementRequestBody } from '@/lib/source-processing/narrative-constraints-extractor';
import { getSampleSelectionRequestBody, parseSampleOutput } from '@/lib/source-processing/sample-selector';
import { getDnaCompressionRequestBody } from '@/lib/source-processing/dna-compressor';
import { createStreamFetcher, type AIConfig, type StreamState } from '@/lib/stream-fetcher';
import type { SemanticSlice, SourceNovel, RepresentativeSample } from '@/types';

// ---- 类型 ----

/** 步骤总数 */
export const TOTAL_STEPS = 8;

/** 回调接口 — store 通过此接口接收管线事件 */
export interface BasicPipelineCallbacks {
  onStepStart: (step: number, message: string) => void;
  onStepComplete: (step: number) => void;
  onStreamUpdate: (step: number, content: string) => void;
  onStreamError: (step: number, error: string | null) => void;
  onProgress: (progress: number) => void;
  /** 保存单步结果到磁盘，管线内部不直接 fetch */
  onSaveStep: (step: number, data: Record<string, unknown>) => Promise<void>;
  /** 更新源小说数据（内存 + 触发 UI 更新） */
  onUpdateNovel: (updates: Record<string, unknown>) => void;
}

/** 管线运行结果 */
export interface BasicPipelineResult {
  slices: SemanticSlice[];
  styleProfile: string;
  plotReport: string;
  characterDynamics: string;
  readerExperience: string;
  narrativeConstraints: string;
  representativeSamples: RepresentativeSample[];
  novelDna: string | null;
  /** 哪些步骤是从断点恢复跳过的 */
  skippedSteps: number[];
}

// ---- 断点检测 ----

/**
 * 根据已有数据判断应从哪一步开始
 * 返回第一个未完成步骤的索引，0 表示从头开始
 */
export function determineResumeStep(novel: SourceNovel | null): number {
  if (!novel) return 0;
  if (!novel.slices || novel.slices.length === 0) return 0;
  if (!novel.styleProfile) return 1;
  if (!novel.plotReport) return 2;
  if (!novel.characterDynamics) return 3;
  if (!novel.readerExperience) return 4;
  if (!novel.narrativeConstraints) return 5;
  if (!novel.representativeSamples) return 6;
  return 7;
}

// ---- 多批处理 ----

/** 流式 fetcher 类型（来自 stream-fetcher） */
interface StreamFetcher {
  abort(): void;
  fetch(url: string, body: object): Promise<{ result: string | null; state: StreamState }>;
}

/**
 * 多批处理辅助 — 自动分批调用 AI 接口
 * 用于 Step 1-5（文风、叙事、角色、读者体验、叙事约束）
 */
async function runMultiBatch(
  slices: SemanticSlice[],
  batchInfo: { needsBatch: boolean; batches: string[] },
  apiPath: string,
  buildFirstBody: () => object,
  buildSupplementBody: (chunk: string, prevResult: string) => object,
  streamStep: number,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<string> {
  let result = '';

  if (!batchInfo.needsBatch) {
    const body = buildFirstBody();
    const res = await fetcher.fetch(apiPath, body);
    if (res.result) {
      result = res.result;
      callbacks.onStreamUpdate(streamStep, res.state.content);
    }
  } else {
    for (let i = 0; i < batchInfo.batches.length; i++) {
      const body = i === 0
        ? buildFirstBody()
        : buildSupplementBody(batchInfo.batches[i], result);
      const res = await fetcher.fetch(apiPath, body);
      if (res.result) {
        result = res.result;
        callbacks.onStreamUpdate(streamStep, res.state.content);
      } else break;
    }
  }

  callbacks.onStreamError(streamStep, null);
  return result;
}

// ---- 单步函数 ----

/** Step 0: 智能切片 */
async function runStep0(
  rawText: string,
  novelId: string,
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<SemanticSlice[]> {
  callbacks.onStepStart(0, '智能切片中...');
  callbacks.onProgress(0);
  callbacks.onUpdateNovel({ status: 'slicing' });

  let slices: SemanticSlice[];

  if (shouldSkipSlicing(rawText)) {
    slices = createSingleSlice(novelId, rawText);
    callbacks.onStreamUpdate(0, `文本较短（${rawText.length}字），跳过智能切片，直接作为单一切片处理。`);
  } else {
    const sliceBody = getSlicingRequestBody(rawText, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL);
    const sliceResult = await fetcher.fetch('/api/source/process/slice', sliceBody);

    if (!sliceResult.result) {
      const errMsg = sliceResult.state.error || '智能切片失败，请检查 API 配置';
      callbacks.onStreamError(0, errMsg);
      throw new Error(errMsg);
    }

    callbacks.onStreamUpdate(0, sliceResult.state.content);
    slices = parseSliceOutput(sliceResult.result, novelId);
    if (slices.length === 0) {
      slices = fallbackSlice(novelId, rawText);
    }
  }

  callbacks.onUpdateNovel({ slices });
  await callbacks.onSaveStep(0, { slices });
  callbacks.onStepComplete(0);
  return slices;
}

/** Step 1: 文风提取 */
async function runStep1(
  slices: SemanticSlice[],
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<string> {
  callbacks.onStepStart(1, '文风提取中...');
  callbacks.onProgress(Math.round(100 / TOTAL_STEPS));
  callbacks.onUpdateNovel({ status: 'extracting' });

  const styleBatchInfo = computeStyleBatches(slices, aiConfig.maxContextTokens);
  const profile = await runMultiBatch(
    slices, styleBatchInfo,
    '/api/source/process/style',
    () => getStyleExtractionRequestBody(slices, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    (chunk, prev) => getStyleSupplementRequestBody(chunk, prev, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    1, fetcher, callbacks,
  );

  if (!profile) {
    throw new Error('文风提取失败，请检查 API 配置');
  }

  callbacks.onUpdateNovel({ styleProfile: profile });
  await callbacks.onSaveStep(1, { styleProfile: profile });
  callbacks.onStepComplete(1);
  return profile;
}

/** Step 2: 叙事动力学（依赖 profile） */
async function runStep2(
  slices: SemanticSlice[],
  profile: string,
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<string> {
  callbacks.onStepStart(2, '叙事动力学分析中...');

  const narrativeBatchInfo = computePlotBatches(slices, aiConfig.maxContextTokens);
  const narrativeReport = await runMultiBatch(
    slices, narrativeBatchInfo,
    '/api/source/process/plot',
    () => getPlotExtractionRequestBody(slices, profile, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    (chunk, prev) => getPlotSupplementRequestBody(chunk, prev, profile, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    2, fetcher, callbacks,
  );

  if (!narrativeReport) {
    throw new Error('叙事动力学分析失败，请检查 API 配置');
  }

  callbacks.onUpdateNovel({ plotReport: narrativeReport });
  await callbacks.onSaveStep(2, { plotReport: narrativeReport });
  callbacks.onStepComplete(2);
  return narrativeReport;
}

/** Step 3: 角色动力学（依赖 narrativeReport） */
async function runStep3(
  slices: SemanticSlice[],
  narrativeReport: string,
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<string> {
  callbacks.onStepStart(3, '角色动力学分析中...');
  callbacks.onProgress(Math.round(3 * 100 / TOTAL_STEPS));
  callbacks.onUpdateNovel({ status: 'character_dynamics' });

  const charDynBatchInfo = computeCharacterDynamicsBatches(slices, aiConfig.maxContextTokens);
  const characterDynamics = await runMultiBatch(
    slices, charDynBatchInfo,
    '/api/source/process/character-dynamics',
    () => getCharacterDynamicsExtractionRequestBody(slices, narrativeReport, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    (chunk, prev) => getCharacterDynamicsSupplementRequestBody(chunk, prev, narrativeReport, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    3, fetcher, callbacks,
  );

  if (!characterDynamics) {
    throw new Error('角色动力学分析失败，请检查 API 配置');
  }

  callbacks.onUpdateNovel({ characterDynamics });
  await callbacks.onSaveStep(3, { characterDynamics });
  callbacks.onStepComplete(3);
  return characterDynamics;
}

/** Step 4: 读者体验 */
async function runStep4(
  slices: SemanticSlice[],
  profile: string,
  narrativeReport: string,
  characterDynamics: string,
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<string> {
  const readerExpBatchInfo = computeReaderExperienceBatches(slices, aiConfig.maxContextTokens);
  const result = await runMultiBatch(
    slices, readerExpBatchInfo,
    '/api/source/process/reader-experience',
    () => getReaderExperienceExtractionRequestBody(slices, profile, narrativeReport, characterDynamics, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    (chunk, prev) => getReaderExperienceSupplementRequestBody(chunk, prev, profile, narrativeReport, characterDynamics, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    4, fetcher, callbacks,
  );

  if (!result) {
    throw new Error('读者体验分析失败，请检查 API 配置');
  }

  callbacks.onUpdateNovel({ readerExperience: result });
  await callbacks.onSaveStep(4, { readerExperience: result });
  return result;
}

/** Step 5: 叙事约束 */
async function runStep5(
  slices: SemanticSlice[],
  narrativeReport: string,
  characterDynamics: string,
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<string> {
  const narConBatchInfo = computeNarrativeConstraintsBatches(slices, aiConfig.maxContextTokens);
  const result = await runMultiBatch(
    slices, narConBatchInfo,
    '/api/source/process/narrative-constraints',
    () => getNarrativeConstraintsExtractionRequestBody(slices, narrativeReport, characterDynamics, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    (chunk, prev) => getNarrativeConstraintsSupplementRequestBody(chunk, prev, narrativeReport, characterDynamics, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL),
    5, fetcher, callbacks,
  );

  if (!result) {
    throw new Error('叙事约束分析失败，请检查 API 配置');
  }

  callbacks.onUpdateNovel({ narrativeConstraints: result });
  await callbacks.onSaveStep(5, { narrativeConstraints: result });
  return result;
}

/** Step 6: 样本选取 */
async function runStep6(
  slices: SemanticSlice[],
  profile: string,
  narrativeReport: string,
  readerExperience: string,
  narrativeConstraints: string,
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<RepresentativeSample[]> {
  callbacks.onStepStart(6, '样本选取中...');
  callbacks.onProgress(Math.round(6 * 100 / TOTAL_STEPS));
  callbacks.onUpdateNovel({ status: 'selecting' });

  const sampleBody = getSampleSelectionRequestBody(
    slices, profile, narrativeReport,
    aiConfig.apiKey, aiConfig.model, aiConfig.baseURL,
    readerExperience, narrativeConstraints,
  );
  const sampleResult = await fetcher.fetch('/api/source/process/samples', sampleBody);

  if (!sampleResult.result) {
    callbacks.onStreamError(6, sampleResult.state.error || '样本选取失败');
    throw new Error('样本选取失败，请检查 API 配置');
  }

  callbacks.onStreamUpdate(6, sampleResult.state.content);
  const samples = parseSampleOutput(sampleResult.result);

  callbacks.onUpdateNovel({ representativeSamples: samples });
  await callbacks.onSaveStep(6, { representativeSamples: samples });
  callbacks.onStepComplete(6);
  return samples;
}

/** Step 7: DNA 压缩（失败不中止管线） */
async function runStep7(
  profile: string,
  narrativeReport: string,
  characterDynamics: string,
  readerExperience: string,
  narrativeConstraints: string,
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  callbacks: BasicPipelineCallbacks,
): Promise<string | null> {
  callbacks.onStepStart(7, 'DNA 压缩中...');
  callbacks.onProgress(Math.round(7 * 100 / TOTAL_STEPS));
  callbacks.onUpdateNovel({ status: 'compressing' });

  const dnaBody = getDnaCompressionRequestBody(
    profile, narrativeReport, characterDynamics,
    readerExperience, narrativeConstraints,
    aiConfig.apiKey, aiConfig.model, aiConfig.baseURL,
  );
  const dnaResult = await fetcher.fetch('/api/source/process/dna-compression', dnaBody);

  let novelDna: string | null = null;

  if (!dnaResult.result) {
    // DNA 压缩失败不影响整体流程
    console.warn('DNA 压缩失败:', dnaResult.state.error);
  } else {
    callbacks.onStreamUpdate(7, dnaResult.state.content);
    novelDna = dnaResult.result;
    callbacks.onUpdateNovel({ novelDna });
    await callbacks.onSaveStep(7, { novelDna });
  }

  callbacks.onStepComplete(7);
  return novelDna;
}

// ---- 主编排函数 ----

/**
 * 运行基础 8 步分析管线
 *
 * @param novelId 小说 ID
 * @param rawText 原始文本（新上传时提供）
 * @param aiConfig AI 配置
 * @param novel 已有小说数据（恢复时传入，新上传传 null）
 * @param callbacks 回调接口
 * @returns 管线结果 + 跳过的步骤列表
 */
export async function runBasicPipeline(
  novelId: string,
  rawText: string | null,
  aiConfig: AIConfig,
  novel: SourceNovel | null,
  callbacks: BasicPipelineCallbacks,
): Promise<BasicPipelineResult> {
  const fetcher = createStreamFetcher();
  const resumeStep = determineResumeStep(novel);
  const skippedSteps: number[] = [];

  // 从已有数据加载已完成步骤的结果
  let slices: SemanticSlice[] = novel?.slices ?? [];
  let profile = novel?.styleProfile ?? '';
  let narrativeReport = novel?.plotReport ?? '';
  let characterDynamics = novel?.characterDynamics ?? '';
  let readerExperience = novel?.readerExperience ?? '';
  let narrativeConstraints = novel?.narrativeConstraints ?? '';
  let samples: RepresentativeSample[] = novel?.representativeSamples ?? [];
  let novelDna: string | null = novel?.novelDna ?? null;

  // 记录跳过的步骤
  for (let i = 0; i < resumeStep; i++) {
    skippedSteps.push(i);
  }

  // ── Step 0: 智能切片 ──
  if (resumeStep <= 0) {
    if (!rawText) throw new Error('新上传需要 rawText，恢复时需要已有 slices');
    slices = await runStep0(rawText, novelId, aiConfig, fetcher, callbacks);
  }

  // ── Step 1: 文风提取 ──
  if (resumeStep <= 1) {
    profile = await runStep1(slices, aiConfig, fetcher, callbacks);
  }

  // ── Step 2: 叙事动力学（依赖 profile） ──
  if (resumeStep <= 2) {
    narrativeReport = await runStep2(slices, profile, aiConfig, fetcher, callbacks);
  }

  // ── Step 3: 角色动力学（依赖 narrativeReport） ──
  if (resumeStep <= 3) {
    characterDynamics = await runStep3(slices, narrativeReport, aiConfig, fetcher, callbacks);
  }

  // ── Step 4 + Step 5: 读者体验 ‖ 叙事约束（并行） ──
  if (resumeStep <= 4) {
    callbacks.onStepStart(4, '读者体验 + 叙事约束分析中（并行）...');
    callbacks.onProgress(Math.round(4 * 100 / TOTAL_STEPS));
    callbacks.onUpdateNovel({ status: 'deep_analyzing' });

    // Step 5 不依赖 Step 4 结果，两者可并行
    const needsReaderExp = resumeStep <= 4;
    const needsNarCon = resumeStep <= 5;

    const results = await Promise.all([
      needsReaderExp
        ? runStep4(slices, profile, narrativeReport, characterDynamics, aiConfig, fetcher, callbacks)
        : Promise.resolve(readerExperience),
      needsNarCon
        ? runStep5(slices, narrativeReport, characterDynamics, aiConfig, fetcher, callbacks)
        : Promise.resolve(narrativeConstraints),
    ]);

    readerExperience = results[0];
    narrativeConstraints = results[1];

    callbacks.onSaveStep(4, { readerExperience });
    callbacks.onSaveStep(5, { narrativeConstraints });
    callbacks.onStepComplete(4);
    callbacks.onStepComplete(5);
  } else if (resumeStep <= 5) {
    // Step 4 已完成但 Step 5 未完成（极端边界情况）
    narrativeConstraints = await runStep5(slices, narrativeReport, characterDynamics, aiConfig, fetcher, callbacks);
  }

  // ── Step 6: 样本选取 ──
  if (resumeStep <= 6) {
    samples = await runStep6(slices, profile, narrativeReport, readerExperience, narrativeConstraints, aiConfig, fetcher, callbacks);
  }

  // ── Step 7: DNA 压缩（失败不中止） ──
  if (resumeStep <= 7) {
    novelDna = await runStep7(profile, narrativeReport, characterDynamics, readerExperience, narrativeConstraints, aiConfig, fetcher, callbacks);
  }

  // 全部完成
  const now = new Date().toISOString();
  callbacks.onUpdateNovel({ status: 'ready', processedAt: now });
  await callbacks.onSaveStep(7, { status: 'ready', processedAt: now });
  callbacks.onProgress(100);

  return {
    slices, styleProfile: profile, plotReport: narrativeReport,
    characterDynamics, readerExperience, narrativeConstraints,
    representativeSamples: samples, novelDna, skippedSteps,
  };
}
