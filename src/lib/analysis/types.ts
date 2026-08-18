/** 证据分析 v2 的认识论状态。空数组不能替代这些状态。 */
export type EpistemicStatus =
  | "observed"
  | "inferred"
  | "hypothesis"
  | "ambiguous"
  | "unknown"
  | "not_observed"
  | "not_applicable"
  | "extractor_error";

export type CorpusBoundary = "complete" | "volume" | "fragment";

export type SourceSpanKind =
  | "chapter_heading"
  | "section_heading"
  | "separator"
  | "paragraph";

/** 原文中的稳定、可机械回查位置。text 永远等于 originalText 对应切片。 */
export interface SourceSpan {
  id: string;
  kind: SourceSpanKind;
  text: string;
  startOffset: number;
  endOffset: number;
  position: number;
  ordinal: number;
  chapterIndex?: number;
  sectionIndex?: number;
}

export interface SourceDocument {
  schemaVersion: 1;
  sourceId: string;
  title: string;
  boundary: CorpusBoundary;
  sourceHash: string;
  normalizationVersion: string;
  analysisVersion: string;
  originalText: string;
  spans: SourceSpan[];
}

export type FactKind =
  | "character"
  | "alias"
  | "event"
  | "state_change"
  | "time"
  | "place"
  | "object"
  | "goal"
  | "promise"
  | "threat"
  | "knowledge"
  | "open_question"
  | "world_rule"
  | "other";

export interface FactCandidate {
  id: string;
  kind: FactKind;
  statement: string;
  subject?: string;
  object?: string;
  evidenceSpanIds: string[];
  epistemicStatus: EpistemicStatus;
  rawLabel?: string;
}

export type ThreadKind =
  | "event"
  | "object"
  | "expectation"
  | "character"
  | "relationship"
  | "world_rule"
  | "other";

export type EpisodeRole =
  | "setup"
  | "reinforcement"
  | "escalation"
  | "complication"
  | "partial_payoff"
  | "payoff"
  | "reversal"
  | "refusal"
  | "aftermath"
  | "other"
  | "unknown";

export interface ThreadEpisode {
  id: string;
  role: EpisodeRole;
  rawLabel?: string;
  summary: string;
  evidenceSpanIds: string[];
  ordinal: number;
}

export interface AnalysisThread {
  id: string;
  kind: ThreadKind;
  rawLabel?: string;
  title: string;
  episodes: ThreadEpisode[];
  epistemicStatus: EpistemicStatus;
  lifecycle: "open" | "resolved" | "open_at_boundary" | "ambiguous";
}

export type MechanismTargetLayer =
  | "outline"
  | "chapter_plan"
  | "draft"
  | "editor";

export type MechanismScope = "distributed" | "local" | "exception";

export type AdoptionStatus =
  | "pending"
  | "adopted"
  | "rejected"
  | "editor_only";

export interface MechanismFalsification {
  status: "not_run" | "passed" | "bounded" | "failed";
  alternativeExplanations: string[];
  /** 源作内的适用边界，仅供审计；不得拼入 Transfer-facing applicability。 */
  applicabilityLimits?: string[];
}

/** 一个独立候选观察在机制卡中的实例，不把同一事件的多个 span 误算为多次规律。 */
export interface MechanismEvidenceInstance {
  id: string;
  originCandidateId: string;
  spanIds: string[];
  chapterIndexes: number[];
  threadIds: string[];
}

/**
 * 可复用机制卡是分析真相；DNA/总览只能从卡片派生。
 * 源作专名和具体剧情不得进入面向生成端的投影视图。
 */
export interface MechanismCard {
  id: string;
  title: string;
  observation: string;
  effectHypothesis: string;
  when: string[];
  do: string[];
  avoid: string[];
  evidenceSpanIds: string[];
  counterexampleSpanIds: string[];
  epistemicStatus: EpistemicStatus;
  lifecycle: "candidate" | "verified" | "rejected";
  falsification: MechanismFalsification;
  /** 旧 artifact 可能缺失；新卡缺失 scope 时晋升/transfer 必须失败关闭。 */
  scope?: MechanismScope;
  applicability: string[];
  targetLayers: MechanismTargetLayer[];
  adoption: AdoptionStatus;
  /**
   * 编译卡必须能回查到第二遍的全局候选 ID。旧 artifact 可缺失，
   * 但缺失时一律不能晋升到 transfer/生产端。
   */
  originCandidateIds?: string[];
  /** distributed 卡必须至少由三个独立 candidate 实例支撑；旧卡缺失时不能晋升。 */
  evidenceInstances?: MechanismEvidenceInstance[];
}

export interface AuditItem {
  id: string;
  kind:
    | "continuity"
    | "open_loop"
    | "pov_shift"
    | "tense_shift"
    | "compression_candidate";
  title: string;
  description: string;
  evidenceSpanIds: string[];
  counterEvidenceSpanIds: string[];
  epistemicStatus: EpistemicStatus;
  disposition: "unreviewed" | "explained" | "suspected_issue" | "dismissed";
}

export interface AnalysisCoverage {
  totalUnits: number;
  completedUnits: number;
  failedUnits: number;
  status: "pending" | "running" | "complete" | "partial" | "failed";
}
