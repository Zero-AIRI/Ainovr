// ============================================
// 统一分析管线 — 7 步编排器
// ============================================
//
// Step 1: 小切片（代码，~2万字/片）
// Step 2: 逐片事件提取（N 次并行 AI，原文只读 1 次）
// Step 3: 事件对齐（代码预处理 + 1 次 AI）→ 全书记忆图谱
// Step 4: 大切片（代码，按 maxContextTokens 自适应）
// Step 5: 逐大切片深度分析（并行 AI，带完整图谱 JSON）
// Step 6: 汇总 + 刺激点分析 + 一致性报告（1 次 AI）
// Step 7: DNA 压缩（代码填充量化参数 + AI 定性）→ 纯量化生成规则
//
// 错误策略：重试 2 次后管线停止，已完成结果保留，支持断点恢复
// 短文本：统一流程，切片数=1

import type { AIConfig } from '@/lib/stream-fetcher';
import { createStreamFetcher } from '@/lib/stream-fetcher';
import { buildEventExtractionMessages, buildEventAlignmentMessages, buildDeepAnalysisMessages, buildSummaryMessages, buildDnaQualitativeMessages } from '@/lib/ai/prompts';
import type {
  SmallSlice,
  LargeSlice,
  SliceExtractionResult,
  ExtractedEvent,
  FullEventGraph,
  SliceAnalysis,
  SummaryReport,
  GenerationRulesDNA,
  UnifiedPipelineCallbacks,
  UnifiedPipelineResult,
  PipelineCheckpoint,
  AlignmentPreprocessResult,
} from './pipeline-types';
import {
  SMALL_SLICE_TARGET_SIZE,
  SMALL_SLICE_MIN_SIZE,
  MAX_RETRIES,
  TOTAL_PIPELINE_STEPS,
} from './pipeline-types';

// ============================================
// 辅助：带重试的 fetch
// ============================================

async function fetchWithRetry(
  fetcher: ReturnType<typeof createStreamFetcher>,
  url: string,
  body: object,
  step: number,
  callbacks: UnifiedPipelineCallbacks,
  label: string,
): Promise<string> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      callbacks.onStreamUpdate(step, `[重试第 ${attempt} 次: ${label}]`);
    }

    const { result, state } = await fetcher.fetch(url, body);

    if (result !== null) {
      return result;
    }

    lastError = state.error;
  }

  // 所有重试失败
  const errorMsg = `${label}失败（已重试 ${MAX_RETRIES} 次）: ${lastError}`;
  callbacks.onStreamError(step, errorMsg);
  throw new Error(errorMsg);
}

// ============================================
// Step 2: 逐片事件提取（并行 AI）
// ============================================

/** 解析 AI 输出为 ExtractedEvent[] */
function parseExtractedEvents(raw: string, sliceIndex: number): ExtractedEvent[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((e: Record<string, unknown>) =>
        typeof e.type === 'string' && typeof e.description === 'string'
        && (e.confidence === undefined || Number(e.confidence) >= 0.5),
      )
      .map((e: Record<string, unknown>, idx: number): ExtractedEvent => ({
        id: String(e.id ?? `E-S${sliceIndex}-${idx}`),
        type: String(e.type ?? '其他'),
        participants: Array.isArray(e.participants) ? e.participants.map(String) : [],
        location: String(e.location ?? '未知'),
        description: String(e.description ?? '').slice(0, 50),
        causes: Array.isArray(e.causes) ? e.causes.map(String) : [],
        effects: Array.isArray(e.effects) ? e.effects.map(String) : [],
        tensionChange: Math.min(5, Math.max(-5, Number(e.tension_change ?? 0))),
        emotion: String(e.emotion ?? ''),
        foreshadowingOf: e.foreshadowing_of ? String(e.foreshadowing_of) : null,
        confidence: Math.min(1, Math.max(0, Number(e.confidence ?? 0.7))),
        sliceIndex,
      }));
  } catch {
    return [];
  }
}

/** 从 AI 输出中提取实体列表 */
function extractEntitiesFromRaw(raw: string, events: ExtractedEvent[]): string[] {
  // 从事件的 participants 中收集，再去重
  const entities = new Set<string>();
  for (const event of events) {
    for (const p of event.participants) {
      entities.add(p);
    }
  }
  return [...entities];
}

async function runStep2EventExtraction(
  smallSlices: SmallSlice[],
  aiConfig: AIConfig,
  fetcher: ReturnType<typeof createStreamFetcher>,
  callbacks: UnifiedPipelineCallbacks,
): Promise<SliceExtractionResult[]> {
  const totalSlices = smallSlices.length;

  // 全量并行
  const results = await Promise.all(
    smallSlices.map(async (slice) => {
      const label = `切片 ${slice.index + 1}/${totalSlices} 事件提取`;
      const { systemPrompt, userMessage } = buildEventExtractionMessages(
        slice.content, slice.index, totalSlices,
      );

      try {
        const raw = await fetchWithRetry(
          fetcher,
          '/api/source/process/event-extraction',
          { systemPrompt, userMessage, apiKey: aiConfig.apiKey, model: aiConfig.model, baseURL: aiConfig.baseURL },
          1, callbacks, label,
        );

        callbacks.onStreamUpdate(1, `[${label} 完成]`);

        const events = parseExtractedEvents(raw, slice.index);
        const entities = extractEntitiesFromRaw(raw, events);

        return {
          sliceIndex: slice.index,
          events,
          entities,
          rawResponse: raw,
        } satisfies SliceExtractionResult;
      } catch {
        // 重试耗尽 → 管线停止（严格报错策略）
        throw new Error(`切片 ${slice.index + 1}/${totalSlices} 事件提取失败`);
      }
    }),
  );

  return results;
}

// ============================================
// Step 3: 事件对齐（代码预处理 + 1 次 AI）
// ============================================

async function runStep3EventAlignment(
  sliceExtractions: SliceExtractionResult[],
  novelId: string,
  aiConfig: AIConfig,
  fetcher: ReturnType<typeof createStreamFetcher>,
  callbacks: UnifiedPipelineCallbacks,
): Promise<FullEventGraph> {
  // 代码预处理：排序、候选实体对、频率统计
  const preprocessed = preprocessForAlignment(sliceExtractions);

  // 如果只有 1 个切片，代码直接构建图谱（无需 AI 对齐）
  if (sliceExtractions.length <= 1) {
    return buildEventGraphFromExtraction(preprocessed, novelId);
  }

  // 准备 AI 输入
  const allEventsJson = JSON.stringify(preprocessed.sortedEvents, null, 2);
  const candidatePairsStr = preprocessed.candidateEntityPairs.length > 0
    ? JSON.stringify(preprocessed.candidateEntityPairs.slice(0, 50), null, 2) // 最多传 50 个候选对
    : '无候选实体对';
  const entityFrequencyStr = JSON.stringify(
    Object.fromEntries(
      Object.entries(preprocessed.entityFrequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 100), // 最多传 100 个实体
    ), null, 2,
  );

  const { systemPrompt, userMessage } = buildEventAlignmentMessages(
    allEventsJson,
    candidatePairsStr,
    entityFrequencyStr,
    preprocessed.totalEvents,
    sliceExtractions.length,
  );

  const raw = await fetchWithRetry(
    fetcher,
    '/api/source/process/event-alignment',
    { systemPrompt, userMessage, apiKey: aiConfig.apiKey, model: aiConfig.model, baseURL: aiConfig.baseURL },
    2, callbacks, '事件对齐',
  );

  callbacks.onStreamUpdate(2, '[事件对齐完成，正在构建图谱…]');

  // 解析 AI 输出为 FullEventGraph
  return parseAlignmentOutput(raw, preprocessed, novelId);
}

/** 从 AI 对齐输出构建 FullEventGraph */
function parseAlignmentOutput(
  raw: string,
  preprocessed: AlignmentPreprocessResult,
  novelId: string,
): FullEventGraph {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // AI 输出不是 JSON，回退到代码构建
      return buildEventGraphFromExtraction(preprocessed, novelId);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 使用 AI 重新输出的事件（已归一化），如果不存在则用原始事件
    const events: ExtractedEvent[] = Array.isArray(parsed.events)
      ? parsed.events.map((e: Record<string, unknown>, idx: number) => ({
          id: String(e.id ?? `E-${idx}`),
          type: String(e.type ?? '其他'),
          participants: Array.isArray(e.participants) ? e.participants.map(String) : [],
          location: String(e.location ?? '未知'),
          description: String(e.description ?? '').slice(0, 50),
          causes: Array.isArray(e.causes) ? e.causes.map(String) : [],
          effects: Array.isArray(e.effects) ? e.effects.map(String) : [],
          tensionChange: Math.min(5, Math.max(-5, Number(e.tension_change ?? e.tensionChange ?? 0))),
          emotion: String(e.emotion ?? ''),
          foreshadowingOf: e.foreshadowing_of ? String(e.foreshadowing_of) : null,
          confidence: Math.min(1, Math.max(0, Number(e.confidence ?? 0.7))),
          sliceIndex: Number(e.sliceIndex ?? 0),
        }))
      : preprocessed.sortedEvents;

    // 构建索引
    const byChapter: Record<number, string[]> = {};
    const byParticipant: Record<string, string[]> = {};
    const byType: Record<string, string[]> = {};
    for (const e of events) {
      (byChapter[e.sliceIndex] ??= []).push(e.id); // 用 sliceIndex 代替 chapter
      for (const p of e.participants) {
        (byParticipant[p] ??= []).push(e.id);
      }
      (byType[e.type] ??= []).push(e.id);
    }

    return {
      novelId,
      events,
      entityMappings: Array.isArray(parsed.entityMappings) ? parsed.entityMappings : [],
      entityTimelines: Array.isArray(parsed.entityTimelines) ? parsed.entityTimelines : [],
      foreshadowingPairs: Array.isArray(parsed.foreshadowingPairs)
        ? parsed.foreshadowingPairs.map((p: Record<string, unknown>) => ({
            setup: String(p.setup ?? ''),
            payoff: p.payoff ? String(p.payoff) : null,
            distance: Number(p.distance ?? 0),
            status: String(p.status ?? 'open') as 'resolved' | 'open' | 'dangling',
          }))
        : [],
      byChapter,
      byParticipant,
      byType,
      totalSmallSlices: new Set(events.map(e => e.sliceIndex)).size,
      extractedAt: new Date().toISOString(),
    };
  } catch {
    // 解析失败，回退到代码构建
    return buildEventGraphFromExtraction(preprocessed, novelId);
  }
}

/** 纯代码构建图谱（无 AI 对齐，用于单切片或 AI 对齐失败时的回退） */
function buildEventGraphFromExtraction(
  preprocessed: AlignmentPreprocessResult,
  novelId: string,
): FullEventGraph {
  const events = preprocessed.sortedEvents;
  const byChapter: Record<number, string[]> = {};
  const byParticipant: Record<string, string[]> = {};
  const byType: Record<string, string[]> = {};
  for (const e of events) {
    (byChapter[e.sliceIndex] ??= []).push(e.id);
    for (const p of e.participants) {
      (byParticipant[p] ??= []).push(e.id);
    }
    (byType[e.type] ??= []).push(e.id);
  }

  // 代码检测伏笔配对
  const foreshadowingPairs: FullEventGraph['foreshadowingPairs'] = [];
  const eventById = new Map(events.map(e => [e.id, e]));
  for (const e of events) {
    if (e.foreshadowingOf) {
      const payoff = eventById.get(e.foreshadowingOf);
      foreshadowingPairs.push({
        setup: e.id,
        payoff: payoff?.id ?? null,
        distance: payoff ? Math.abs(payoff.sliceIndex - e.sliceIndex) : 0,
        status: payoff ? 'resolved' : 'dangling',
      });
    }
  }

  return {
    novelId,
    events,
    entityMappings: [],
    entityTimelines: [],
    foreshadowingPairs,
    byChapter,
    byParticipant,
    byType,
    totalSmallSlices: new Set(events.map(e => e.sliceIndex)).size,
    extractedAt: new Date().toISOString(),
  };
}

// ============================================
// Step 5: 逐大切片深度分析（并行 AI）
// ============================================

function parseSliceAnalysis(raw: string, sliceIndex: number): SliceAnalysis | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const defaultSentenceLength = { avg: 0, range: [0, 0] as [number, number], climax: 0, calm: 0 };
    const sm = parsed.styleMechanics;
    const styleMechanics = {
      sentenceLength: (sm?.sentenceLength && typeof sm.sentenceLength === 'object')
        ? { avg: Number(sm.sentenceLength.avg) || 0, range: (Array.isArray(sm.sentenceLength.range) ? sm.sentenceLength.range : [0, 0]) as [number, number], climax: Number(sm.sentenceLength.climax) || 0, calm: Number(sm.sentenceLength.calm) || 0 }
        : defaultSentenceLength,
      dialogueRatio: Number(sm?.dialogueRatio) || 0,
      descriptionStrategy: sm?.descriptionStrategy ?? null,
      counterExample: sm?.counterExample ?? null,
      confidence: Number(sm?.confidence) || 0,
      generationRule: String(sm?.generationRule ?? ''),
    };

    const nm = parsed.narrativeMechanics;
    const narrativeMechanics = {
      pacingPattern: nm?.pacingPattern ?? null,
      informationControl: nm?.informationControl ?? null,
      counterExample: nm?.counterExample ?? null,
      confidence: Number(nm?.confidence) || 0,
      generationRule: String(nm?.generationRule ?? ''),
    };

    return {
      sliceIndex,
      styleMechanics,
      narrativeMechanics,
      characterMechanics: Array.isArray(parsed.characterMechanics) ? parsed.characterMechanics : [],
      stimulationPoints: Array.isArray(parsed.stimulationPoints) ? parsed.stimulationPoints : [],
      constraints: parsed.constraints ?? { worldRules: [], characterLimits: [], plotConstraints: [], taboos: [] },
    };
  } catch {
    return null;
  }
}

async function runStep5DeepAnalysis(
  largeSlices: LargeSlice[],
  eventGraph: FullEventGraph | null,
  aiConfig: AIConfig,
  fetcher: ReturnType<typeof createStreamFetcher>,
  callbacks: UnifiedPipelineCallbacks,
): Promise<SliceAnalysis[]> {
  const graphJson = eventGraph ? JSON.stringify(eventGraph) : '{}';

  const results = await Promise.all(
    largeSlices.map(async (slice) => {
      const label = `大切片 ${slice.index + 1}/${largeSlices.length} 深度分析`;
      const { systemPrompt, userMessage } = buildDeepAnalysisMessages(
        slice.content, slice.index, largeSlices.length, graphJson,
      );

      const raw = await fetchWithRetry(
        fetcher,
        '/api/source/process/deep-analysis',
        { systemPrompt, userMessage, apiKey: aiConfig.apiKey, model: aiConfig.model, baseURL: aiConfig.baseURL },
        4, callbacks, label,
      );

      callbacks.onStreamUpdate(4, `[${label} 完成]`);
      return parseSliceAnalysis(raw, slice.index);
    }),
  );

  return results.filter((r): r is SliceAnalysis => r !== null);
}

// ============================================
// Step 6: 汇总 + 刺激点分析 + 一致性报告
// ============================================

function parseSummaryReport(raw: string): SummaryReport | null {
  // 尝试多种 JSON 提取策略
  const strategies: Array<{ name: string; extract: () => string | null }> = [
    { name: 'json code block', extract: () => { const m = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/); return m?.[1] ?? null; }},
    { name: 'first JSON object', extract: () => { const m = raw.match(/\{[\s\S]*?\}(?=\s*(?:\{|\```|$))/); return m?.[0] ?? null; }},
    { name: 'greedy JSON', extract: () => { const m = raw.match(/\{[\s\S]*\}/); return m?.[0] ?? null; }},
    { name: 'raw trim', extract: () => raw.trim().startsWith('{') ? raw.trim() : null },
  ];

  let lastError: string | null = null;

  for (const strategy of strategies) {
    const candidate = strategy.extract();
    if (!candidate) continue;

    try {
      const parsed = JSON.parse(candidate);
      // 注入默认值防止 NaN 流入下游
      return {
        styleEvolution: Array.isArray(parsed.styleEvolution) ? parsed.styleEvolution : [],
        stimulationCycle: parsed.stimulationCycle ?? {
          avgPeakInterval: 0, avgCooldownLength: 0, cyclePattern: [], stimulationDensity: {},
        },
        eventFunctions: Array.isArray(parsed.eventFunctions) ? parsed.eventFunctions : [],
        consistencyReport: parsed.consistencyReport ?? {
          settingConflicts: [], unresolvedForeshadowing: 0, totalForeshadowing: 0, driftRate: 0, styleConsistencyRate: 1,
        },
        informationRelease: parsed.informationRelease ?? {
          avgSetupToHint: 0, avgHintToReveal: 0, revealDensity: 0,
        },
      };
    } catch (e) {
      lastError = `${strategy.name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 所有策略失败时，记录原始输出的头部便于调试
  console.error('[parseSummaryReport] 所有解析策略失败:', lastError);
  console.error('[parseSummaryReport] 原始输出前 500 字符:', raw.slice(0, 500));
  return null;
}

async function runStep6Summary(
  sliceAnalyses: SliceAnalysis[],
  eventGraph: FullEventGraph | null,
  aiConfig: AIConfig,
  fetcher: ReturnType<typeof createStreamFetcher>,
  callbacks: UnifiedPipelineCallbacks,
): Promise<SummaryReport> {
  const analysesJson = JSON.stringify(sliceAnalyses);
  const graphJson = eventGraph ? JSON.stringify(eventGraph) : '{}';

  const { systemPrompt, userMessage } = buildSummaryMessages(analysesJson, graphJson);

  const raw = await fetchWithRetry(
    fetcher,
    '/api/source/process/summary',
    { systemPrompt, userMessage, apiKey: aiConfig.apiKey, model: aiConfig.model, baseURL: aiConfig.baseURL },
    5, callbacks, '汇总报告',
  );

  callbacks.onStreamUpdate(5, '[汇总完成]');

  const report = parseSummaryReport(raw);
  if (!report) {
    // 输出原始响应的头部用于调试
    const preview = raw.slice(0, 300).replace(/\n/g, '↵');
    throw new Error(`汇总报告解析失败（AI 输出前 300 字符: ${preview}）`);
  }
  return report;
}

// ============================================
// Step 7: DNA 压缩（代码填充 + AI 定性）
// ============================================

function computeQuantitativeDna(
  eventGraph: FullEventGraph | null,
  summaryReport: SummaryReport | null,
  sliceAnalyses: SliceAnalysis[],
  novelId: string,
  model: string,
): { dna: GenerationRulesDNA; computedParams: string } {
  // 从 sliceAnalyses 计算句式参数
  const lengths = sliceAnalyses.map(a => a.styleMechanics.sentenceLength.avg).filter(n => n > 0);
  const dialogRatios = sliceAnalyses.map(a => a.styleMechanics.dialogueRatio).filter(n => n > 0);
  const avgSentenceLen = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const avgDialog = dialogRatios.length > 0 ? dialogRatios.reduce((a, b) => a + b, 0) / dialogRatios.length : 0;

  const sentenceLengthStd = lengths.length > 1
    ? Math.sqrt(lengths.reduce((s, n) => s + (n - avgSentenceLen) ** 2, 0) / (lengths.length - 1))
    : 0;

  const climaxLengths = sliceAnalyses.map(a => a.styleMechanics.sentenceLength.climax).filter(n => n > 0);
  const calmLengths = sliceAnalyses.map(a => a.styleMechanics.sentenceLength.calm).filter(n => n > 0);

  // 从刺激点计算节奏参数
  const allStimPoints = sliceAnalyses.flatMap(a => a.stimulationPoints);
  const peakPoints = allStimPoints.filter(p => p.tensionChange >= 3);
  // 用总字数 / 高峰间隔数估算平均高峰间距
  const totalChars = sliceAnalyses.reduce((s, a) => {
    // 从句长 × 句数估算片段字数，若无数据则取 0
    const charEstimate = a.styleMechanics.sentenceLength.avg * (a.stimulationPoints.length || 1) * 5;
    return s + charEstimate;
  }, 0);
  const avgPeakInterval = peakPoints.length > 1
    ? Math.round(totalChars / (peakPoints.length - 1))
    : 0;
  const cooldownPoints = allStimPoints.filter(p => p.type === '日常过渡');

  // 刺激类型密度
  const stimDensity: Record<string, number> = {};
  for (const p of allStimPoints) {
    stimDensity[p.type] = (stimDensity[p.type] || 0) + 1;
  }
  const totalStim = allStimPoints.length || 1;
  for (const k of Object.keys(stimDensity)) {
    stimDensity[k] = Math.round((stimDensity[k] / totalStim) * 100) / 100;
  }

  // 从汇总报告获取参数
  const cycle = summaryReport?.stimulationCycle;
  const consistency = summaryReport?.consistencyReport;
  const infoRelease = summaryReport?.informationRelease;

  // 角色规则
  const characterRules = sliceAnalyses
    .flatMap(a => a.characterMechanics)
    .reduce((map, cm) => {
      if (!map.has(cm.name)) {
        map.set(cm.name, { name: cm.name, stimulusResponse: cm.stimulusResponse, dialogRatio: 0 });
      } else {
        const existing = map.get(cm.name)!;
        existing.stimulusResponse.push(...cm.stimulusResponse);
      }
      return map;
    }, new Map<string, GenerationRulesDNA['characterRules'][0]>());

  // 禁忌
  const taboos = [...new Set(sliceAnalyses.flatMap(a => a.constraints.taboos))];

  const dna: GenerationRulesDNA = {
    sentenceLength: {
      avg: Math.round(avgSentenceLen),
      climax: climaxLengths.length > 0 ? Math.round(climaxLengths.reduce((a, b) => a + b, 0) / climaxLengths.length) : 0,
      calm: calmLengths.length > 0 ? Math.round(calmLengths.reduce((a, b) => a + b, 0) / calmLengths.length) : 0,
      std: Math.round(sentenceLengthStd),
    },
    dialogueRatio: Math.round(avgDialog * 100) / 100,
    descriptionRatio: Math.round((1 - avgDialog) * 0.5 * 100) / 100,
    actionRatio: Math.round((1 - avgDialog) * 0.3 * 100) / 100,
    internalMonologueRatio: Math.round((1 - avgDialog) * 0.2 * 100) / 100,
    conflictInterval: cycle?.avgPeakInterval ?? avgPeakInterval,
    peakInterval: cycle?.avgPeakInterval ?? avgPeakInterval,
    cooldownLength: cycle?.avgCooldownLength ?? (cooldownPoints.length > 0 ? 2000 : 0),
    stimulationCycle: cycle?.cyclePattern ?? Object.keys(stimDensity),
    stimulationDensity: stimDensity,
    informationRelease: {
      avgSetupToHint: infoRelease?.avgSetupToHint ?? 0,
      avgHintToReveal: infoRelease?.avgHintToReveal ?? 0,
      revealDensity: infoRelease?.revealDensity ?? 0,
    },
    characterRules: [...characterRules.values()],
    settingDriftTolerance: consistency?.driftRate ?? 0,
    unresolvedRatio: consistency
      ? (consistency.unresolvedForeshadowing ?? 0) / Math.max(1, consistency.totalForeshadowing ?? 1)
      : 0,
    styleConsistencyRate: consistency?.styleConsistencyRate ?? 1,
    taboos,
    qualitativeNotes: { styleSignature: null, coreAppeal: null, riskNotes: [] },
    meta: {
      generatedAt: new Date().toISOString(),
      sourceNovelId: novelId,
      modelUsed: model,
      totalSmallSlices: eventGraph?.totalSmallSlices ?? 0,
      totalLargeSlices: sliceAnalyses.length,
      totalEvents: eventGraph?.events.length ?? 0,
      totalEntities: eventGraph?.entityMappings.length ?? 0,
    },
  };

  return { dna, computedParams: JSON.stringify(dna, null, 2) };
}

function parseQualitativeNotes(raw: string): GenerationRulesDNA['qualitativeNotes'] {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { styleSignature: null, coreAppeal: null, riskNotes: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.qualitativeNotes ?? { styleSignature: null, coreAppeal: null, riskNotes: [] };
  } catch {
    return { styleSignature: null, coreAppeal: null, riskNotes: [] };
  }
}

async function runStep7Dna(
  eventGraph: FullEventGraph | null,
  summaryReport: SummaryReport | null,
  sliceAnalyses: SliceAnalysis[],
  novelId: string,
  aiConfig: AIConfig,
  fetcher: ReturnType<typeof createStreamFetcher>,
  callbacks: UnifiedPipelineCallbacks,
): Promise<GenerationRulesDNA> {
  // 代码填充量化参数
  let dna: GenerationRulesDNA;
  let computedParams: string;
  try {
    const result = computeQuantitativeDna(
      eventGraph, summaryReport, sliceAnalyses, novelId, aiConfig.model,
    );
    dna = result.dna;
    computedParams = result.computedParams;
  } catch (err) {
    // 量化计算失败 → 返回最小默认 DNA，不阻塞管线
    const msg = err instanceof Error ? err.message : '量化计算异常';
    callbacks.onStreamUpdate(6, `[DNA 量化计算失败: ${msg}，使用默认值]`);
    dna = {
      sentenceLength: { avg: 0, climax: 0, calm: 0, std: 0 },
      dialogueRatio: 0, descriptionRatio: 0, actionRatio: 0, internalMonologueRatio: 0,
      conflictInterval: 0, peakInterval: 0, cooldownLength: 0,
      stimulationCycle: [], stimulationDensity: {},
      informationRelease: { avgSetupToHint: 0, avgHintToReveal: 0, revealDensity: 0 },
      characterRules: [],
      settingDriftTolerance: 0, unresolvedRatio: 0, styleConsistencyRate: 1,
      taboos: [],
      qualitativeNotes: { styleSignature: null, coreAppeal: null, riskNotes: [] },
      meta: { generatedAt: new Date().toISOString(), sourceNovelId: novelId, modelUsed: aiConfig.model, totalSmallSlices: 0, totalLargeSlices: sliceAnalyses.length, totalEvents: eventGraph?.events.length ?? 0, totalEntities: 0 },
    };
    computedParams = JSON.stringify(dna, null, 2);
  }

  // AI 定性（1 次调用）
  if (summaryReport) {
    try {
      const { systemPrompt, userMessage } = buildDnaQualitativeMessages(
        JSON.stringify(summaryReport), computedParams,
      );

      const raw = await fetchWithRetry(
        fetcher,
        '/api/source/process/dna-compression',
        { systemPrompt, userMessage, apiKey: aiConfig.apiKey, model: aiConfig.model, baseURL: aiConfig.baseURL },
        6, callbacks, 'DNA 定性',
      );

      dna.qualitativeNotes = parseQualitativeNotes(raw);
    } catch {
      // AI 定性失败不阻塞，保留代码填充的量化部分
      callbacks.onStreamUpdate(6, '[DNA 定性失败，仅使用量化参数]');
    }
  }

  return dna;
}

// ============================================
// Step 1: 小切片（纯代码）
// ============================================

export function createSmallSlices(rawText: string): SmallSlice[] {
  const totalChars = rawText.length;

  // 短文本：整个文本作为一个切片
  if (totalChars <= SMALL_SLICE_TARGET_SIZE * 1.3) {
    return [{
      index: 0,
      content: rawText,
      charCount: totalChars,
      startOffset: 0,
      endOffset: totalChars,
    }];
  }

  const slices: SmallSlice[] = [];
  let offset = 0;

  while (offset < totalChars) {
    let endOffset = Math.min(offset + SMALL_SLICE_TARGET_SIZE, totalChars);

    // 在段落/换行边界截断，避免切断句子
    if (endOffset < totalChars) {
      const searchStart = Math.max(offset + SMALL_SLICE_MIN_SIZE, endOffset - 2000);
      const searchRange = rawText.slice(searchStart, endOffset + 2000);
      // 找最后一个换行符作为切割点
      const lastNewline = searchRange.lastIndexOf('\n');
      if (lastNewline > 0) {
        endOffset = searchStart + lastNewline + 1;
      }
    }

    const content = rawText.slice(offset, endOffset);
    if (content.trim().length > 0) {
      slices.push({
        index: slices.length,
        content,
        charCount: content.length,
        startOffset: offset,
        endOffset,
      });
    }

    offset = endOffset;
  }

  return slices;
}

// ============================================
// Step 3 代码预处理：候选实体对
// ============================================

export function preprocessForAlignment(
  extractions: SliceExtractionResult[],
): AlignmentPreprocessResult {
  // 收集所有事件，按 sliceIndex 排序
  const allEvents = extractions
    .flatMap(e => e.events)
    .sort((a, b) => a.sliceIndex - b.sliceIndex);

  // 统计实体频率
  const entityFrequency: Record<string, number> = {};
  const entitySlicePresence: Record<string, Set<number>> = {};

  for (const event of allEvents) {
    for (const participant of event.participants) {
      entityFrequency[participant] = (entityFrequency[participant] || 0) + 1;
      if (!entitySlicePresence[participant]) {
        entitySlicePresence[participant] = new Set();
      }
      entitySlicePresence[participant].add(event.sliceIndex);
    }
  }

  // 找候选实体对（疑似同一实体的不同称呼）
  const entityNames = Object.keys(entityFrequency);
  const candidatePairs: AlignmentPreprocessResult['candidateEntityPairs'] = [];

  for (let i = 0; i < entityNames.length; i++) {
    for (let j = i + 1; j < entityNames.length; j++) {
      const a = entityNames[i];
      const b = entityNames[j];

      // 跳过低频实体
      if (entityFrequency[a] < 2 || entityFrequency[b] < 2) continue;

      const slicesA = entitySlicePresence[a];
      const slicesB = entitySlicePresence[b];

      // 计算共现和互斥
      let coOccurrence = 0;
      for (const s of slicesA) {
        if (slicesB.has(s)) coOccurrence++;
      }

      const mutualExclusion = coOccurrence === 0 && slicesA.size > 1 && slicesB.size > 1;

      // 只保留有可能的候选：互斥出现（从不同时出现在同一切片）
      if (mutualExclusion || coOccurrence > 0) {
        candidatePairs.push({
          names: [a, b],
          coOccurrenceCount: coOccurrence,
          mutualExclusion,
          frequencyA: entityFrequency[a],
          frequencyB: entityFrequency[b],
        });
      }
    }
  }

  // 按互斥优先排序
  candidatePairs.sort((a, b) => {
    if (a.mutualExclusion && !b.mutualExclusion) return -1;
    if (!a.mutualExclusion && b.mutualExclusion) return 1;
    return (b.frequencyA + b.frequencyB) - (a.frequencyA + a.frequencyB);
  });

  return {
    sortedEvents: allEvents,
    candidateEntityPairs: candidatePairs,
    entityFrequency,
    totalEvents: allEvents.length,
  };
}

// ============================================
// Step 4: 大切片（纯代码）
// ============================================

export function createLargeSlices(rawText: string, maxContextTokens: number): LargeSlice[] {
  // 估算：1 token ≈ 1.5 中文字符，留 30% 空间给图谱和 prompt
  const availableChars = Math.floor(maxContextTokens * 1.5 * 0.7);

  const totalChars = rawText.length;

  // 短文本：整个文本作为一个切片
  if (totalChars <= availableChars) {
    return [{
      index: 0,
      content: rawText,
      charCount: totalChars,
      startOffset: 0,
      endOffset: totalChars,
      coveredSmallSliceRange: [0, 0],
    }];
  }

  const slices: LargeSlice[] = [];
  let offset = 0;

  while (offset < totalChars) {
    let endOffset = Math.min(offset + availableChars, totalChars);

    // 在段落/换行边界截断
    if (endOffset < totalChars) {
      const searchStart = Math.max(offset + availableChars * 0.8, endOffset - 2000);
      const searchRange = rawText.slice(searchStart, endOffset + 2000);
      const lastNewline = searchRange.lastIndexOf('\n');
      if (lastNewline > 0) {
        endOffset = searchStart + lastNewline + 1;
      }
    }

    const content = rawText.slice(offset, endOffset);
    if (content.trim().length > 0) {
      slices.push({
        index: slices.length,
        content,
        charCount: content.length,
        startOffset: offset,
        endOffset,
        coveredSmallSliceRange: [0, 0], // 将在管线中根据 offset 映射填充
      });
    }

    offset = endOffset;
  }

  return slices;
}

// ============================================
// 主管线入口
// ============================================

export async function runUnifiedPipeline(
  novelId: string,
  rawText: string,
  aiConfig: AIConfig,
  checkpoint: PipelineCheckpoint | null,
  callbacks: UnifiedPipelineCallbacks,
  externalFetcher?: ReturnType<typeof createStreamFetcher>,
): Promise<UnifiedPipelineResult> {
  const fetcher = externalFetcher ?? createStreamFetcher();
  const failedSteps: number[] = [];

  // 断点恢复：从已完成步骤集合确定跳过
  const completedSteps = new Set(checkpoint?.completedSteps ?? []);

  // 中间产物
  let smallSlices: SmallSlice[] = checkpoint?.smallSlices ?? [];
  let largeSlices: LargeSlice[] = checkpoint?.largeSlices ?? [];
  let sliceExtractions: SliceExtractionResult[] = checkpoint?.sliceExtractions ?? [];
  let eventGraph: FullEventGraph | null = checkpoint?.eventGraph ?? null;
  let sliceAnalyses: SliceAnalysis[] = checkpoint?.sliceAnalyses ?? [];
  let summaryReport: SummaryReport | null = checkpoint?.summaryReport ?? null;
  let dna: GenerationRulesDNA | null = null;

  try {
    // ---- Step 1: 小切片 ----
    if (!completedSteps.has(0)) {
      callbacks.onStepStart(0, '正在切分小切片…');
      callbacks.onProgress(Math.round(0 * 100 / TOTAL_PIPELINE_STEPS));

      smallSlices = createSmallSlices(rawText);

      await callbacks.onSaveStep(0, { smallSlices });
      callbacks.onStepComplete(0);
      completedSteps.add(0);
    }

    // ---- Step 2: 逐片事件提取（并行 AI） ----
    if (!completedSteps.has(1)) {
      callbacks.onStepStart(1, `正在提取事件（${smallSlices.length} 个小切片并行）…`);
      callbacks.onProgress(Math.round(1 * 100 / TOTAL_PIPELINE_STEPS));

      sliceExtractions = await runStep2EventExtraction(
        smallSlices, aiConfig, fetcher, callbacks,
      );

      await callbacks.onSaveStep(1, { sliceExtractions });
      callbacks.onStepComplete(1);
      completedSteps.add(1);
    }

    // ---- Step 3: 事件对齐（代码预处理 + 1 次 AI） ----
    if (!completedSteps.has(2)) {
      callbacks.onStepStart(2, '正在对齐事件图谱…');
      callbacks.onProgress(Math.round(2 * 100 / TOTAL_PIPELINE_STEPS));

      eventGraph = await runStep3EventAlignment(
        sliceExtractions, novelId, aiConfig, fetcher, callbacks,
      );

      await callbacks.onSaveStep(2, { eventGraph });
      callbacks.onStepComplete(2);
      completedSteps.add(2);
    }

    // ---- Step 4: 大切片 ----
    if (!completedSteps.has(3)) {
      callbacks.onStepStart(3, '正在切分大切片…');
      callbacks.onProgress(Math.round(3 * 100 / TOTAL_PIPELINE_STEPS));

      largeSlices = createLargeSlices(rawText, aiConfig.maxContextTokens);
      // 映射 coveredSmallSliceRange
      for (const ls of largeSlices) {
        const startIdx = smallSlices.findIndex(ss => ss.endOffset > ls.startOffset);
        const endIdx = smallSlices.findLastIndex(ss => ss.startOffset < ls.endOffset);
        ls.coveredSmallSliceRange = [
          Math.max(0, startIdx),
          Math.max(0, endIdx),
        ];
      }

      await callbacks.onSaveStep(3, { largeSlices });
      callbacks.onStepComplete(3);
      completedSteps.add(3);
    }

    // ---- Step 5: 逐大切片深度分析（并行 AI） ----
    if (!completedSteps.has(4)) {
      callbacks.onStepStart(4, `正在深度分析（${largeSlices.length} 个大切片并行）…`);
      callbacks.onProgress(Math.round(4 * 100 / TOTAL_PIPELINE_STEPS));

      sliceAnalyses = await runStep5DeepAnalysis(
        largeSlices, eventGraph, aiConfig, fetcher, callbacks,
      );

      await callbacks.onSaveStep(4, { sliceAnalyses });
      callbacks.onStepComplete(4);
      completedSteps.add(4);
    }

    // ---- Step 6: 汇总 + 刺激点分析 + 一致性报告 ----
    if (!completedSteps.has(5)) {
      callbacks.onStepStart(5, '正在汇总分析…');
      callbacks.onProgress(Math.round(5 * 100 / TOTAL_PIPELINE_STEPS));

      summaryReport = await runStep6Summary(
        sliceAnalyses, eventGraph, aiConfig, fetcher, callbacks,
      );

      await callbacks.onSaveStep(5, { summaryReport });
      callbacks.onStepComplete(5);
      completedSteps.add(5);
    }

    // ---- Step 7: DNA 压缩 ----
    if (!completedSteps.has(6)) {
      callbacks.onStepStart(6, '正在压缩 DNA…');
      callbacks.onProgress(Math.round(6 * 100 / TOTAL_PIPELINE_STEPS));

      dna = await runStep7Dna(
        eventGraph, summaryReport, sliceAnalyses, novelId, aiConfig, fetcher, callbacks,
      );

      await callbacks.onSaveStep(6, { dna });
      callbacks.onStepComplete(6);
      completedSteps.add(6);
    }

    callbacks.onProgress(100);
  } catch (error) {
    // 错误已由 fetchWithRetry 抛出
    // 已完成的步骤结果保留在闭包变量中
    const failedStep = [...Array(TOTAL_PIPELINE_STEPS).keys()].find(
      s => !completedSteps.has(s)
    );
    if (failedStep !== undefined) {
      failedSteps.push(failedStep);
    }
    throw error;
  }

  return {
    smallSlices,
    largeSlices,
    eventGraph,
    sliceAnalyses,
    summaryReport,
    dna,
    failedSteps,
  };
}
