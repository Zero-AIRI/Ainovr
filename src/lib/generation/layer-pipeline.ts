// ============================================
// 五层管线编排器 — 先框架后填充
// 使用 stream-fetcher 统一流式调用
// ============================================

import type {
  BookOutline,
  ChapterPlan,
  ChapterSet,
  Phase,
  SourceNovel,
  Volume,
  WritingProject,
} from '@/types';
import { assembleLayerContext } from './context-assembler';
import { useSettingsStore } from '@/lib/store/settings';
import { createStreamFetcher } from '@/lib/stream-fetcher';

/** 获取 AI 设置 */
function getAISettings() {
  return useSettingsStore.getState().getAIConfig();
}

/** 通用流式调用（使用共享 stream-fetcher） */
async function streamGenerate(url: string, body: object): Promise<string> {
  const fetcher = createStreamFetcher();
  const { result, state } = await fetcher.fetch(url, body);
  if (!result) throw new Error(state.error || '生成请求失败');
  return result;
}

// ============================================
// Layer 1: 全书大纲（单次调用，无子项）
// ============================================

export async function generateOutline(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  userConcept: string,
  onStream?: (text: string) => void,
): Promise<BookOutline> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(1, sourceNovels, project);

  const body = {
    styleGuide: ctx.styleGuide,
    plotGuide: ctx.plotGuide,
    userConcept,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const content = await streamGenerate('/api/generation/outline', body);
  onStream?.(content);

  const outline: BookOutline = {
    content,
    generatedAt: new Date().toISOString(),
    isLocked: true,
    majorPlotFrameworkRef: sourceNovels.find((s) =>
      project.sourceRoles.some((r) => r.sourceNovelId === s.id && (r.role === 'plot' || r.role === 'style_and_plot'))
    )?.id ?? '',
  };

  return outline;
}

// ============================================
// Layer 2: 阶段规划（先框架后填充）
// ============================================

export async function generatePhaseFramework(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  onStream?: (text: string) => void,
): Promise<string> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(2, sourceNovels, project);

  const body = {
    outline: project.outline?.content ?? '',
    plotGuide: ctx.plotGuide,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const result = await streamGenerate('/api/generation/phase-framework', body);
  onStream?.(result);
  return result;
}

export async function generatePhaseDetail(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  phaseIndex: number,
  phaseFramework: string,
  onStream?: (text: string) => void,
): Promise<Phase> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(2, sourceNovels, project);

  const body = {
    outline: project.outline?.content ?? '',
    phaseFramework,
    phaseIndex,
    plotGuide: ctx.plotGuide,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const content = await streamGenerate('/api/generation/phase-detail', body);
  onStream?.(content);

  return {
    id: `phase-${phaseIndex}`,
    index: phaseIndex,
    title: `阶段${phaseIndex + 1}`,
    content,
    volumeCount: 0,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// Layer 3: 分卷（先框架后填充）
// ============================================

export async function generateVolumeFramework(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  phaseId: string,
  onStream?: (text: string) => void,
): Promise<string> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(3, sourceNovels, project);
  const phase = project.phases?.find((p) => p.id === phaseId);

  const body = {
    outline: project.outline?.content ?? '',
    phaseContent: phase?.content ?? '',
    minorPlotPatterns: ctx.plotGuide,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const result = await streamGenerate('/api/generation/volume-framework', body);
  onStream?.(result);
  return result;
}

export async function generateVolumeDetail(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  volumeIndex: number,
  volumeFramework: string,
  phaseId: string,
  onStream?: (text: string) => void,
): Promise<Volume> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(3, sourceNovels, project);
  const phase = project.phases?.find((p) => p.id === phaseId);

  const body = {
    outline: project.outline?.content ?? '',
    phaseContent: phase?.content ?? '',
    volumeFramework,
    volumeIndex,
    minorPlotPatterns: ctx.plotGuide,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const content = await streamGenerate('/api/generation/volume-detail', body);
  onStream?.(content);

  return {
    id: `volume-${phaseId}-${volumeIndex}`,
    phaseId,
    index: volumeIndex,
    title: `卷${volumeIndex + 1}`,
    content,
    chapterSetCount: 0,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// Layer 4: 章节集合（先框架后填充）
// ============================================

export async function generateChapterSetFramework(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  volumeId: string,
  onStream?: (text: string) => void,
): Promise<string> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(4, sourceNovels, project);
  const volume = project.volumes?.find((v) => v.id === volumeId);

  const body = {
    volumeContent: volume?.content ?? '',
    minorPlotPatterns: ctx.plotGuide,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const result = await streamGenerate('/api/generation/chapter-set-framework', body);
  onStream?.(result);
  return result;
}

export async function generateChapterSetDetail(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  setIndex: number,
  setFramework: string,
  volumeId: string,
  onStream?: (text: string) => void,
): Promise<ChapterSet> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(4, sourceNovels, project);
  const volume = project.volumes?.find((v) => v.id === volumeId);

  const body = {
    volumeContent: volume?.content ?? '',
    setFramework,
    setIndex,
    minorPlotPatterns: ctx.plotGuide,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const content = await streamGenerate('/api/generation/chapter-set-detail', body);
  onStream?.(content);

  return {
    id: `set-${volumeId}-${setIndex}`,
    volumeId,
    index: setIndex,
    title: `集合${setIndex + 1}`,
    content,
    chapterCount: 0,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// Layer 5: 每章计划（先框架后填充）
// ============================================

export async function generateChapterPlanFramework(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  chapterSetId: string,
  onStream?: (text: string) => void,
): Promise<string> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(5, sourceNovels, project);
  const set = project.chapterSets?.find((s) => s.id === chapterSetId);

  const body = {
    setContent: set?.content ?? '',
    minorPlotPatterns: ctx.plotGuide,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const result = await streamGenerate('/api/generation/chapter-plan-framework', body);
  onStream?.(result);
  return result;
}

export async function generateChapterPlanDetail(
  project: WritingProject,
  sourceNovels: SourceNovel[],
  chapterIndex: number,
  planFramework: string,
  chapterSetId: string,
  onStream?: (text: string) => void,
): Promise<ChapterPlan> {
  const ai = getAISettings();
  const ctx = assembleLayerContext(5, sourceNovels, project);
  const set = project.chapterSets?.find((s) => s.id === chapterSetId);

  const body = {
    setContent: set?.content ?? '',
    planFramework,
    chapterIndex,
    minorPlotPatterns: ctx.plotGuide,
    daoContext: ctx.daoContext,
    rhythmPrescription: ctx.rhythmPrescription,
    apiKey: ai.apiKey,
    model: ai.model,
    baseURL: ai.baseURL,
  };

  const content = await streamGenerate('/api/generation/chapter-plan-detail', body);
  onStream?.(content);

  return {
    id: `plan-${chapterSetId}-${chapterIndex}`,
    chapterSetId,
    index: chapterIndex,
    title: `第${chapterIndex + 1}章`,
    content,
    plotKeywords: [],
    patternStructure: '',
    generatedAt: new Date().toISOString(),
  };
}
