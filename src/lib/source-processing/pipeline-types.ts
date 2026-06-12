// ============================================
// 统一分析管线 — 类型定义
// ============================================

import type { AIConfig } from '@/lib/stream-fetcher';

// ---- 刺激点类型 ----

export const STIMULATION_TYPES = [
  '冲突升级',
  '信息释放',
  '关系变化',
  '实力跃迁',
  '悬念建立',
  '日常过渡',
] as const;
export type StimulationType = (typeof STIMULATION_TYPES)[number];

// ---- 事件功能类型 ----

export const EVENT_FUNCTION_TYPES = [
  '推进剧情',
  '舒缓节奏',
  '营造氛围',
  '角色塑造',
  '伏笔',
  '过渡',
] as const;
export type EventFunctionType = (typeof EVENT_FUNCTION_TYPES)[number];

// ---- 小切片 ----

export interface SmallSlice {
  index: number;
  content: string;
  charCount: number;
  startOffset: number;
  endOffset: number;
}

// ---- 大切片 ----

export interface LargeSlice {
  index: number;
  content: string;
  charCount: number;
  startOffset: number;
  endOffset: number;
  coveredSmallSliceRange: [number, number]; // [startIdx, endIdx]
}

// ---- Step 2: 事件提取产出（单切片） ----

export interface ExtractedEvent {
  id: string;
  type: string;
  participants: string[];
  location: string;
  description: string;
  causes: string[];
  effects: string[];
  tensionChange: number;
  emotion: string;
  foreshadowingOf: string | null;
  confidence: number;
  sliceIndex: number;
}

export interface SliceExtractionResult {
  sliceIndex: number;
  events: ExtractedEvent[];
  entities: string[];
  rawResponse: string;
}

// ---- Step 3: 事件对齐产出 ----

export interface EntityMapping {
  aliases: string[];
  canonical: string;
  type: 'character' | 'location' | 'organization' | 'artifact' | 'concept';
}

export interface EntityTimelineEntry {
  chapter: number;
  state: string;
  triggerEventId: string;
}

export interface EntityTimeline {
  entity: string;
  timeline: EntityTimelineEntry[];
}

export interface FullEventGraph {
  novelId: string;
  events: ExtractedEvent[];
  entityMappings: EntityMapping[];
  entityTimelines: EntityTimeline[];
  foreshadowingPairs: Array<{
    setup: string;
    payoff: string | null;
    distance: number;
    status: 'resolved' | 'open' | 'dangling';
  }>;
  byChapter: Record<number, string[]>;
  byParticipant: Record<string, string[]>;
  byType: Record<string, string[]>;
  totalSmallSlices: number;
  extractedAt: string;
}

// ---- Step 3: 代码预处理产出 ----

export interface AlignmentPreprocessResult {
  sortedEvents: ExtractedEvent[];
  candidateEntityPairs: Array<{
    names: [string, string];
    coOccurrenceCount: number;
    mutualExclusion: boolean;
    frequencyA: number;
    frequencyB: number;
  }>;
  entityFrequency: Record<string, number>;
  totalEvents: number;
}

// ---- Step 5: 大切片深度分析产出 ----

export interface SliceAnalysis {
  sliceIndex: number;

  styleMechanics: {
    sentenceLength: { avg: number; range: [number, number]; climax: number; calm: number };
    dialogueRatio: number;
    descriptionStrategy: string | null;
    counterExample: string | null;
    confidence: number;
    generationRule: string;
  };

  narrativeMechanics: {
    pacingPattern: string | null;
    informationControl: string | null;
    counterExample: string | null;
    confidence: number;
    generationRule: string;
  };

  characterMechanics: Array<{
    name: string;
    stimulusResponse: Array<{ stimulus: string; response: string }>;
    relationshipChanges: Array<{ with: string; from: string; to: string }>;
    confidence: number;
  }>;

  stimulationPoints: Array<{
    type: StimulationType;
    location: string;
    sentenceLengthAtPoint: number;
    tensionChange: number;
    confidence: number;
  }>;

  constraints: {
    worldRules: string[];
    characterLimits: string[];
    plotConstraints: string[];
    taboos: string[];
  };
}

// ---- Step 6: 汇总报告 ----

export interface ConsistencyReport {
  settingConflicts: Array<{
    setting: string;
    v1: string;
    v2: string;
    v1Location: string;
    v2Location: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  unresolvedForeshadowing: number;
  totalForeshadowing: number;
  driftRate: number;
  styleConsistencyRate: number;
}

export interface InformationReleaseCurve {
  avgSetupToHint: number;
  avgHintToReveal: number;
  revealDensity: number;
}

export interface StimulationCycle {
  avgPeakInterval: number;
  avgCooldownLength: number;
  cyclePattern: string[];
  stimulationDensity: Record<string, number>;
}

export interface EventFunctionAnnotation {
  eventId: string;
  functions: EventFunctionType[];
}

export interface StyleEvolutionPhase {
  phase: string;
  sentenceLengthAvg: number;
  dialogueRatio: number;
  dominantStimulation: string;
  shiftTrigger: string | null;
}

export interface SummaryReport {
  styleEvolution: StyleEvolutionPhase[];
  stimulationCycle: StimulationCycle;
  eventFunctions: EventFunctionAnnotation[];
  consistencyReport: ConsistencyReport;
  informationRelease: InformationReleaseCurve;
}

// ---- Step 7: DNA（纯量化生成规则） ----

export interface GenerationRulesDNA {
  // 句式参数
  sentenceLength: { avg: number; climax: number; calm: number; std: number };
  dialogueRatio: number;
  descriptionRatio: number;
  actionRatio: number;
  internalMonologueRatio: number;

  // 节奏参数
  conflictInterval: number;
  peakInterval: number;
  cooldownLength: number;
  stimulationCycle: string[];
  stimulationDensity: Record<string, number>;

  // 信息释放参数
  informationRelease: {
    avgSetupToHint: number;
    avgHintToReveal: number;
    revealDensity: number;
  };

  // 角色参数
  characterRules: Array<{
    name: string;
    stimulusResponse: Array<{ stimulus: string; response: string }>;
    dialogRatio: number;
  }>;

  // 一致性参数
  settingDriftTolerance: number;
  unresolvedRatio: number;
  styleConsistencyRate: number;

  // 禁忌
  taboos: string[];

  // AI 定性补充（少量）
  qualitativeNotes: {
    styleSignature: string | null;
    coreAppeal: string | null;
    riskNotes: string[];
  };

  // 元数据
  meta: {
    generatedAt: string;
    sourceNovelId: string;
    modelUsed: string;
    totalSmallSlices: number;
    totalLargeSlices: number;
    totalEvents: number;
    totalEntities: number;
  };
}

// ---- 管线回调接口 ----

export interface UnifiedPipelineCallbacks {
  onStepStart: (step: number, message: string) => void;
  onStepComplete: (step: number) => void;
  onStreamUpdate: (step: number, content: string) => void;
  onStreamError: (step: number, error: string | null) => void;
  onProgress: (progress: number) => void;
  onSaveStep: (step: number, data: Record<string, unknown>) => Promise<void>;
  onUpdateNovel: (updates: Record<string, unknown>) => void;
}

// ---- 管线结果 ----

export interface UnifiedPipelineResult {
  smallSlices: SmallSlice[];
  largeSlices: LargeSlice[];
  eventGraph: FullEventGraph | null;
  sliceAnalyses: SliceAnalysis[];
  summaryReport: SummaryReport | null;
  dna: GenerationRulesDNA | null;
  failedSteps: number[];
}

// ---- 管线状态（断点恢复用） ----

export interface PipelineCheckpoint {
  novelId: string;
  currentStep: number;
  completedSteps: number[];
  smallSlices: SmallSlice[] | null;
  largeSlices: LargeSlice[] | null;
  sliceExtractions: SliceExtractionResult[] | null;
  eventGraph: FullEventGraph | null;
  sliceAnalyses: SliceAnalysis[] | null;
  summaryReport: SummaryReport | null;
}

// ---- 常量 ----

/** 小切片目标尺寸（字符） */
export const SMALL_SLICE_TARGET_SIZE = 20_000;

/** 小切片最小尺寸（低于此值不单独切） */
export const SMALL_SLICE_MIN_SIZE = 5_000;

/** 重试次数 */
export const MAX_RETRIES = 2;

/** 管线总步数 */
export const TOTAL_PIPELINE_STEPS = 7;

/** 管线步骤标签（UI 展示用） */
export const STEP_LABELS = [
  '小切片',
  '事件提取',
  '图谱对齐',
  '大切片',
  '深度分析',
  '汇总报告',
  'DNA 压缩',
] as const;
