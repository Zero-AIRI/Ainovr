// ============================================
// 道/气 分析管线 — DAG 并行编排器
// 在现有 8 步管线完成后运行，提取道/气/骨/肉/势能
// ============================================

import {
  getExperienceAnnotationRequestBody,
  parseExperienceAnnotations,
  aggregateExperienceCurves,
  computeExperienceBatches,
} from './experience-annotator';
import {
  getAblationTestingRequestBody,
  parseAblationResults,
  computeAblationBatches,
  summarizeAblationResults,
} from './ablation-tester';
import {
  getTensionTrackingRequestBody,
  parseTensionAnalysis,
} from './tension-tracker';
import { READER_PERSONAS } from '@/lib/ai/prompts';
import { createStreamFetcher, type AIConfig } from '@/lib/stream-fetcher';
import type {
  SemanticSlice,
  ExperienceAnnotation,
  ExperienceCurve,
  AblationResult,
  TensionAnalysis,
  NovelDNA,
  NovelDao,
  NovelQi,
  NovelStructure,
  NovelEngines,
  FailureModes,
  StyleEngine,
  TechniqueSampleLibrary,
  SourceNovel,
  EventGraph,
} from '@/types';

// ---- 回调接口 ----

export interface DaoPipelineCallbacks {
  onStepStart: (step: string, message: string) => void;
  onStepComplete: (step: string) => void;
  onStepError: (step: string, error: string) => void;
  onProgress: (progress: number) => void;
}

// ---- 主编排函数 ----

export async function runDaoPipeline(
  novel: SourceNovel,
  aiConfig: AIConfig,
  callbacks: DaoPipelineCallbacks,
): Promise<{
  experienceCurve: ExperienceCurve[];
  ablationResults: AblationResult[];
  tensionAnalysis: TensionAnalysis | null;
  novelDnaV2: NovelDNA | null;
  techniqueSamples: TechniqueSampleLibrary | null;
}> {
  const fetcher = createStreamFetcher();
  const slices = novel.slices;
  const styleProfile = novel.styleProfile ?? '';
  const plotReport = novel.plotReport ?? '';
  const characterDynamics = novel.characterDynamics ?? '';
  const readerExperience = novel.readerExperience ?? '';
  const narrativeConstraints = novel.narrativeConstraints ?? '';

  if (!slices || slices.length === 0) {
    throw new Error('缺少切片数据，请先完成基础分析管线');
  }

  // ═══════════════════════════════════════════
  // Phase 1: 体验流标注 (多个 reader persona 并行)
  // ═══════════════════════════════════════════

  callbacks.onStepStart('experience', '体验流标注 — AI 以多读者身份阅读...');
  callbacks.onProgress(10);

  const personaEntries = Object.entries(READER_PERSONAS);
  const allAnnotations: ExperienceAnnotation[] = [];

  // 所有 persona 并行标注
  const personaResults = await Promise.allSettled(
    personaEntries.map(async ([name, description]) => {
      const batches = computeExperienceBatches(slices, aiConfig.maxContextTokens);
      let personaAnnotations: ExperienceAnnotation[] = [];

      for (const group of batches.sliceGroups) {
        const body = getExperienceAnnotationRequestBody(
          group, name, description,
          aiConfig.apiKey, aiConfig.model, aiConfig.baseURL,
        );
        const res = await fetcher.fetch('/api/source/process/experience-annotation', body);
        if (res.result) {
          const parsed = parseExperienceAnnotations(res.result, group, name);
          personaAnnotations = personaAnnotations.concat(parsed);
        }
      }
      return { persona: name, annotations: personaAnnotations };
    }),
  );

  for (const result of personaResults) {
    if (result.status === 'fulfilled') {
      allAnnotations.push(...result.value.annotations);
    }
  }

  if (allAnnotations.length === 0) {
    callbacks.onStepError('experience', '所有读者 persona 标注均失败');
  }

  const experienceCurve = aggregateExperienceCurves(allAnnotations, slices);
  callbacks.onStepComplete('experience');
  callbacks.onProgress(30);

  // ═══════════════════════════════════════════
  // Phase 2: 消融测试 + 势能追踪 (并行)
  // ═══════════════════════════════════════════

  callbacks.onStepStart('ablation+tension', '消融测试 + 势能追踪 — 并行分析...');

  const ablationPromise = (async (): Promise<AblationResult[]> => {
    const ablationBatches = computeAblationBatches(slices, aiConfig.maxContextTokens);
    let results: AblationResult[] = [];
    for (const group of ablationBatches.sliceGroups) {
      const body = getAblationTestingRequestBody(
        group, aiConfig.apiKey, aiConfig.model, aiConfig.baseURL,
      );
      const res = await fetcher.fetch('/api/source/process/ablation-testing', body);
      if (res.result) {
        results = results.concat(parseAblationResults(res.result, group));
      }
    }
    return results;
  })();

  const tensionPromise = (async (): Promise<TensionAnalysis | null> => {
    const body = getTensionTrackingRequestBody(
      slices, plotReport, experienceCurve,
      aiConfig.apiKey, aiConfig.model, aiConfig.baseURL,
    );
    const res = await fetcher.fetch('/api/source/process/tension-tracking', body);
    if (res.result) {
      return parseTensionAnalysis(res.result, slices);
    }
    return null;
  })();

  const [ablationResults, tensionAnalysis] = await Promise.all([
    ablationPromise,
    tensionPromise,
  ]);

  callbacks.onStepComplete('ablation+tension');
  callbacks.onProgress(60);

  const ablationSummary = summarizeAblationResults(ablationResults);

  // ═══════════════════════════════════════════
  // Phase 3: 构建新六层 DNA
  // ═══════════════════════════════════════════

  callbacks.onStepStart('dna-v2', '构建六层 DNA 结构...');

  const novelDnaV2: NovelDNA = buildNovelDNA({
    slices,
    styleProfile,
    plotReport,
    characterDynamics,
    readerExperience,
    narrativeConstraints,
    experienceCurve,
    ablationResults,
    ablationSummary,
    tensionAnalysis,
    novelId: novel.id,
    model: aiConfig.model,
  });

  callbacks.onStepComplete('dna-v2');
  callbacks.onProgress(80);

  // ═══════════════════════════════════════════
  // Phase 4: 技术样本库
  // ═══════════════════════════════════════════

  callbacks.onStepStart('technique-samples', '构建技术样本库...');

  const techniqueSamples = buildTechniqueSampleLibrary(slices, ablationResults, experienceCurve);

  callbacks.onStepComplete('technique-samples');
  callbacks.onProgress(100);

  return { experienceCurve, ablationResults, tensionAnalysis, novelDnaV2, techniqueSamples };
}

// ---- DNA 构建器 ----

function buildNovelDNA(inputs: {
  slices: SemanticSlice[];
  styleProfile: string;
  plotReport: string;
  characterDynamics: string;
  readerExperience: string;
  narrativeConstraints: string;
  experienceCurve: ExperienceCurve[];
  ablationResults: AblationResult[];
  ablationSummary: ReturnType<typeof summarizeAblationResults>;
  tensionAnalysis: TensionAnalysis | null;
  novelId: string;
  model: string;
}): NovelDNA {
  const {
    slices, styleProfile, characterDynamics, readerExperience,
    experienceCurve, ablationResults, ablationSummary, tensionAnalysis,
    novelId, model,
  } = inputs;

  // 道：从体验曲线推断主情绪场
  const sliceByIndex = new Map(slices.map((s) => [s.index, s] as const));
  const highPointSlices = experienceCurve.filter((c) => c.highPoints);
  const emotionalTones = highPointSlices.map((hp) => {
    const slice = sliceByIndex.get(hp.sliceIndex);
    return slice?.emotionalTone ?? '';
  }).filter(Boolean);

  const primaryEmotionalField = inferEmotionalField(emotionalTones, experienceCurve);

  // 气：维持方法
  const maintenanceMethods = inferMaintenanceMethods(ablationResults, slices, experienceCurve);

  // 结构
  const bones = ablationResults
    .filter((r) => r.category === 'bone')
    .map((r) => ({ description: r.lostIfRemoved, evidence: [sliceByIndex.get(r.sliceIndex)?.title ?? ''] }));
  const muscles = ablationResults
    .filter((r) => r.category === 'muscle')
    .map((r) => ({ description: r.lostIfRemoved, evidence: [sliceByIndex.get(r.sliceIndex)?.title ?? ''] }));
  const fillerTypeA = ablationResults
    .filter((r) => r.category === 'filler_a')
    .map((r) => ({ description: r.lostIfRemoved, purpose: r.reasoning }));
  const fillerTypeB = ablationResults
    .filter((r) => r.category === 'filler_b')
    .map((r) => ({ description: r.lostIfRemoved }));

  // 引擎
  const characterDecisionModels = [characterDynamics.slice(0, 500)].filter(Boolean);

  // 风险
  const total = ablationSummary.totalCount || 1;
  const hasFillerB = ablationSummary.fillerBCount > total * 0.1;
  const hasLongDuration = tensionAnalysis?.patterns.some((p) => p.duration > 20);

  const dao: NovelDao = {
    primaryEmotionalField,
    alternativeReadings: [],
    whyReadersStay: `读者持续阅读的主要原因与「${primaryEmotionalField}」相关`,
    confidence: highPointSlices.length > 3 ? 0.7 : 0.4,
    userConfirmed: false,
  };

  const qi: NovelQi = {
    maintenanceMethods,
    breathingCycleDescription: tensionAnalysis?.breathingCycle ?? '未知',
    rhythmProfile: tensionAnalysis?.rhythmProfile ?? null,
    disruptors: inferDisruptors(tensionAnalysis, ablationResults),
  };

  const structure: NovelStructure = {
    bones: bones.slice(0, 10),
    muscles: muscles.slice(0, 15),
    fillerTypeA: fillerTypeA.slice(0, 10),
    fillerTypeB: fillerTypeB.slice(0, 5),
  };

  const engines: NovelEngines = {
    tensionPatterns: tensionAnalysis?.patterns ?? [],
    characterDecisionModels,
    informationControl: readerExperience.slice(0, 300),
  };

  const failureModes: FailureModes = {
    risks: [
      ...(hasFillerB ? [{ description: '含机械填充段落，直接模仿会显得注水', severity: 'medium' as const, mitigation: '保留填充比例但替换为有意义的呼吸段落' }] : []),
      ...(hasLongDuration ? [{ description: '势能积累周期过长，不适合快节奏平台', severity: 'high' as const, mitigation: '缩短积累周期或拆分为多个子高潮' }] : []),
      { description: '主情绪场为 AI 推断，尚未经人工确认', severity: 'medium' as const, mitigation: '分析完成后请人工审阅 DNA 报告' },
    ],
    dependencies: ['长篇小说篇幅', '连载更新节奏'],
  };

  const styleEngine: StyleEngine = {
    prosePatterns: [],
    dialogueStyle: '',
    descriptionStyle: '',
    chapterOpenings: [],
    chapterEndings: [],
    rawStyleProfile: styleProfile,
  };

  return {
    dao,
    qi,
    structure,
    engines,
    failureModes,
    styleEngine,
    meta: {
      generatedAt: new Date().toISOString(),
      sourceNovelId: novelId,
      modelUsed: model,
      totalSlices: slices.length,
    },
  };
}

// ---- 辅助推断函数 ----

function inferEmotionalField(tones: string[], curve: ExperienceCurve[]): string {
  const highImmersion = curve.filter((c) => c.avgImmersion >= 7);
  const avgAnticipation = highImmersion.reduce((s, c) => s + c.avgAnticipation, 0) / (highImmersion.length || 1);

  if (avgAnticipation > 7) return '持续的期待感';
  if (tones.includes('紧张') && tones.length > 5) return '持续的紧张感';
  if (tones.includes('温馨') && tones.length > 5) return '持续的陪伴感/温暖感';
  if (avgAnticipation < 4 && highImmersion.length > 0) return '持续的沉浸感/舒适感';

  return '待确认（请查看体验曲线）';
}

// ═══════════════════════════════════════════
// 从事件图谱构建 DNA（200万字长篇分析新路径）
// ═══════════════════════════════════════════

export function buildNovelDNAFromEventGraph(eventGraph: EventGraph, styleProfile: string, novelId: string, model: string): NovelDNA {
  const events = eventGraph.events;

  // 道：从事件情绪分布推断
  const emotionCounts = new Map<string, number>();
  for (const e of events) {
    if (e.emotion) emotionCounts.set(e.emotion, (emotionCounts.get(e.emotion) || 0) + 1);
  }
  const topEmotion = [...emotionCounts.entries()].sort(([, a], [, b]) => b - a)[0]?.[0] ?? '待确认';

  // 从事件类型分布推断
  const typeCounts = new Map<string, number>();
  for (const e of events) typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1);
  const typeEntries = [...typeCounts.entries()].sort(([, a], [, b]) => b - a);
  const combatRatio = (typeCounts.get('战斗/冲突') || 0) / events.length;
  const dailyRatio = (typeCounts.get('日常/过渡') || 0) / events.length;

  let primaryEmotionalField = topEmotion;
  if (dailyRatio > 0.3) primaryEmotionalField = `持续的陪伴感（${topEmotion}底色）`;
  else if (combatRatio > 0.25) primaryEmotionalField = `持续的紧张感（${topEmotion}底色）`;
  else primaryEmotionalField = `持续的${topEmotion}感`;

  const dao: NovelDao = {
    primaryEmotionalField,
    alternativeReadings: [],
    whyReadersStay: `读者持续阅读的核心驱动力与「${primaryEmotionalField}」相关。事件图谱中${events.length}个事件的情绪分布支持此推断。`,
    confidence: events.length > 1000 ? 0.7 : 0.5,
    userConfirmed: false,
  };

  // 气：从事件类型比例和因果链推断
  const maintenanceMethods: string[] = [];
  if (dailyRatio > 0.2) maintenanceMethods.push(`大量日常/过渡事件（${Math.round(dailyRatio * 100)}%）维持阅读状态`);
  if (combatRatio > 0.2) maintenanceMethods.push(`高频战斗/冲突事件（${Math.round(combatRatio * 100)}%）维持紧张感`);

  const avgTensionChange = events.reduce((s, e) => s + e.tensionChange, 0) / (events.length || 1);
  if (avgTensionChange > 1) maintenanceMethods.push('整体上升的紧张趋势维持驱动感');
  else if (avgTensionChange < -1) maintenanceMethods.push('整体下降的紧张趋势维持安全感');
  else maintenanceMethods.push('均衡的张弛节奏');

  const qi: NovelQi = {
    maintenanceMethods,
    breathingCycleDescription: typeEntries.slice(0, 3).map(([t, c]) => `${t}(${c}次)`).join(' → '),
    rhythmProfile: {
      propulsionRatio: combatRatio,
      buildupRatio: (typeCounts.get('决策/选择') || 0) / events.length,
      releaseRatio: (typeCounts.get('突破/升级') || 0) / events.length,
      breathRatio: dailyRatio,
      existenceRatio: dailyRatio * 0.6,
      calibrationRatio: 0.05,
    },
    disruptors: dailyRatio < 0.1 ? ['缺少呼吸段落', '连续高潮'] : ['无明显破坏因素'],
  };

  // 结构：从因果链推断
  const highDegreeEvents = events
    .filter((e) => e.causes.length + e.effects.length >= 5)
    .sort((a, b) => (b.causes.length + b.effects.length) - (a.causes.length + a.effects.length));

  const structure: NovelStructure = {
    bones: highDegreeEvents.slice(0, 10).map((e) => ({
      description: e.description,
      evidence: [`第${e.chapter}章`, ...e.participants],
    })),
    muscles: events
      .filter((e) => Math.abs(e.tensionChange) >= 2 && e.causes.length + e.effects.length < 5)
      .slice(0, 15)
      .map((e) => ({ description: e.description, evidence: [e.type] })),
    fillerTypeA: events
      .filter((e) => e.type === '日常/过渡' && Math.abs(e.tensionChange) <= 1)
      .slice(0, 10)
      .map((e) => ({ description: e.description, purpose: '维持阅读节奏' })),
    fillerTypeB: [],
  };

  // 引擎
  const engines: NovelEngines = {
    tensionPatterns: [],
    characterDecisionModels: [],
    informationControl: typeEntries.map(([t, c]) => `${t}:${c}`).join(','),
  };

  // 风险
  const longForeshadowing = eventGraph.foreshadowingPairs.filter((p) => p.distance > 30);
  const risks = [
    ...(longForeshadowing.length > 0 ? [{
      description: `含${longForeshadowing.length}对超长程伏笔（>30章），直接模仿可能丢失回收`,
      severity: 'medium' as const,
      mitigation: '生成时维护伏笔清单，每10章检查回收进度',
    }] : []),
    ...(dailyRatio > 0.3 ? [{
      description: '日常比例过高，可能不适合快节奏平台',
      severity: 'medium' as const,
      mitigation: '可压缩日常比例至15-20%',
    }] : []),
  ];

  const failureModes: FailureModes = {
    risks,
    dependencies: ['长篇连载格式', `${eventGraph.totalChapters}章篇幅`],
  };

  const styleEngine: StyleEngine = {
    prosePatterns: [],
    dialogueStyle: '',
    descriptionStyle: '',
    chapterOpenings: [],
    chapterEndings: [],
    rawStyleProfile: styleProfile,
  };

  return {
    dao,
    qi,
    structure,
    engines,
    failureModes,
    styleEngine,
    meta: { generatedAt: new Date().toISOString(), sourceNovelId: novelId, modelUsed: model, totalSlices: events.length },
  };
}

/** 根据分析结果推断破坏阅读状态的因素 */
function inferDisruptors(tensionAnalysis: TensionAnalysis | null, ablationResults: AblationResult[]): string[] {
  const disruptors: string[] = [];
  if (tensionAnalysis) {
    const longAccumulations = tensionAnalysis.patterns.filter((p) => p.duration > 20);
    if (longAccumulations.length > 0) {
      disruptors.push(`${longAccumulations.length} 处势能积累周期过长（>20 切片），可能导致读者疲劳`);
    }
  }
  const fillerBCount = ablationResults.filter((r) => r.category === 'filler_b').length;
  if (fillerBCount > ablationResults.length * 0.1) {
    disruptors.push(`${fillerBCount} 段机械填充可能打断阅读节奏`);
  }
  if (disruptors.length === 0) {
    disruptors.push('未检测到明显破坏因素');
  }
  return disruptors;
}

function inferMaintenanceMethods(
  ablationResults: AblationResult[],
  slices: SemanticSlice[],
  _curve: ExperienceCurve[],
): string[] {
  const methods: string[] = [];
  const fillerA = ablationResults.filter((r) => r.category === 'filler_a');
  const muscle = ablationResults.filter((r) => r.category === 'muscle');

  if (fillerA.length > ablationResults.length * 0.15) {
    methods.push('大量体验填充段落维持阅读状态（日常/准备/过渡）');
  }
  if (muscle.length > ablationResults.length * 0.2) {
    methods.push('丰富的人物互动和世界细节增强沉浸感');
  }

  const tensionLevels = slices.map((s) => s.tensionLevel).filter((t): t is number => t !== null && t !== undefined);
  const highTensionCount = tensionLevels.filter((t) => t >= 7).length;
  const lowTensionCount = tensionLevels.filter((t) => t <= 3).length;

  if (highTensionCount > lowTensionCount * 2) {
    methods.push('高频紧张-释放循环维持爽感');
  } else if (lowTensionCount > highTensionCount * 1.5) {
    methods.push('低强度持续叙事维持陪伴感');
  } else {
    methods.push('均衡的张弛节奏');
  }

  return methods;
}

// ---- 技术样本库构建 ----

function buildTechniqueSampleLibrary(
  slices: SemanticSlice[],
  ablationResults: AblationResult[],
  experienceCurve: ExperienceCurve[],
): TechniqueSampleLibrary {
  const selectSamples = (filter: (s: SemanticSlice, i: number) => boolean, count: number) => {
    const matched = slices.filter((s, i) => filter(s, i));
    return matched.slice(0, count).map((s) => ({
      sliceId: s.id,
      sliceIndex: s.index,
      title: s.title,
      content: s.content,
      selectionReason: '自动筛选',
    }));
  };

  const boneIndices = new Set(ablationResults.filter((r) => r.category === 'bone').map((r) => r.sliceIndex));
  const highPointIndices = new Set(experienceCurve.filter((c) => c.highPoints).map((c) => c.sliceIndex));

  // 按 sliceIndex 建立消融结果索引，避免位置映射错误
  const ablationBySliceIndex = new Map<number, AblationResult>();
  for (const r of ablationResults) {
    ablationBySliceIndex.set(r.sliceIndex, r);
  }

  return {
    hooks: selectSamples((s) => s.narrativeFunction === 'setup' || s.index <= 3, 3),
    climaxes: selectSamples(
      (s) => s.tensionLevel >= 8 || s.narrativeFunction === 'climax', 3,
    ),
    buildups: selectSamples(
      (s) => s.tensionLevel >= 5 && s.tensionLevel < 8 && s.narrativeFunction === 'escalation', 3,
    ),
    transitions: selectSamples(
      (s) => s.narrativeFunction === 'cooldown' || s.narrativeFunction === 'setup', 3,
    ),
    relationshipProgressions: selectSamples(
      (s) => s.semanticTags.some((t) => ['关系', '情感', '互动'].includes(t)), 3,
    ),
    worldRevelations: selectSamples(
      (s) => s.semanticTags.some((t) => ['世界观', '设定', '揭示'].includes(t)), 3,
    ),
    breathPassages: selectSamples(
      (s) => ablationBySliceIndex.get(s.index)?.category === 'filler_a' || (s.tensionLevel <= 3 && !boneIndices.has(s.index)), 3,
    ),
    foreshadowings: selectSamples(
      (s) => s.semanticTags.some((t) => ['伏笔', '铺垫', '暗示'].includes(t)) || s.dependencies.length > 0, 3,
    ),
  };
}
