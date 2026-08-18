import type {
  EpistemicStatus,
  MechanismCard,
  SourceDocument,
  SourceSpan,
} from "./types";

export type MechanismCardRejectionReason =
  | "invalid_evidence_span"
  | "invalid_counterexample_span"
  | "insufficient_evidence"
  | "evidence_not_distributed"
  | "missing_scope"
  | "epistemic_status_not_promotable"
  | "falsification_not_passed"
  | "missing_counterexample"
  | "counterexample_overlaps_evidence"
  | "missing_applicability"
  | "missing_action"
  | "missing_target_layer"
  | "missing_origin_candidate"
  | "invalid_origin_candidate"
  | "missing_falsification_assessment"
  | "insufficient_evidence_instances";

export interface MechanismCardAssessment {
  eligible: boolean;
  reasons: MechanismCardRejectionReason[];
}

export interface MechanismOriginCandidateLike {
  id: string;
  epistemicStatus: EpistemicStatus;
  evidenceSpanIds: string[];
  counterEvidenceSpanIds?: string[];
}

export interface MechanismFalsificationAssessmentLike {
  candidateId: string;
  status: "passed" | "bounded" | "failed" | "unknown";
}

/**
 * 模板 code-node 和普通 TypeScript 共用的唯一卡片质量门。
 *
 * 函数必须保持自包含：模板会把它的运行时函数源码嵌入 Worker code string，
 * 因而这里不能闭包引用模块常量或辅助函数。
 */
export function assessMechanismCardRuntime(
  card: MechanismCard,
  spans: readonly Pick<SourceSpan, "id" | "position">[],
  candidates: readonly MechanismOriginCandidateLike[] = [],
  assessments: readonly MechanismFalsificationAssessmentLike[] = [],
  options: { verifyOriginLinks?: boolean } = {},
): MechanismCardRejectionReason[] {
  const reasons: MechanismCardRejectionReason[] = [];
  const promotableStatuses = new Set(["observed", "inferred"]);
  const spanMap = new Map(spans.map((span) => [span.id, span]));
  const evidenceIds = Array.isArray(card.evidenceSpanIds)
    ? card.evidenceSpanIds
    : [];
  const counterIds = Array.isArray(card.counterexampleSpanIds)
    ? card.counterexampleSpanIds
    : [];
  const evidence = evidenceIds.map((id) => spanMap.get(id));
  const originIds = Array.isArray(card.originCandidateIds)
    ? card.originCandidateIds
    : [];

  if (
    originIds.length === 0
    || originIds.some((id) => typeof id !== "string" || id.trim() === "")
    || new Set(originIds).size !== originIds.length
  ) {
    reasons.push("missing_origin_candidate");
  }

  if (options.verifyOriginLinks === true && originIds.length > 0) {
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const assessmentMap = new Map(
      assessments.map((assessment) => [assessment.candidateId, assessment]),
    );
    for (const originId of originIds) {
      const candidate = candidateMap.get(originId);
      if (!candidate) {
        reasons.push("invalid_origin_candidate");
        continue;
      }
      if (!promotableStatuses.has(candidate.epistemicStatus)) {
        reasons.push("epistemic_status_not_promotable");
      }
      const assessment = assessmentMap.get(originId);
      if (!assessment) {
        reasons.push("missing_falsification_assessment");
      } else if (!new Set(["passed", "bounded"]).has(assessment.status)) {
        reasons.push("falsification_not_passed");
      }
    }
  }

  if (evidence.some((span) => span === undefined)) {
    reasons.push("invalid_evidence_span");
  }
  if (counterIds.some((id) => !spanMap.has(id))) {
    reasons.push("invalid_counterexample_span");
  }
  if (evidenceIds.length === 0) {
    reasons.push("insufficient_evidence");
  }

  if (!card.scope || !["distributed", "local", "exception"].includes(card.scope)) {
    reasons.push("missing_scope");
  }
  const evidenceInstances = Array.isArray(card.evidenceInstances)
    ? card.evidenceInstances
    : [];
  const originUnitId = (originCandidateId: string) => {
    const lastSeparator = originCandidateId.lastIndexOf(":");
    const moduleSeparator = lastSeparator > 0
      ? originCandidateId.lastIndexOf(":", lastSeparator - 1)
      : -1;
    return moduleSeparator > 0
      ? originCandidateId.slice(0, moduleSeparator)
      : originCandidateId;
  };
  if (
    card.scope === "distributed"
    && (evidenceInstances.length < 3
      || new Set(evidenceInstances.map((instance) => instance.originCandidateId)).size < 3
      || new Set(evidenceInstances.map((instance) =>
        originUnitId(instance.originCandidateId))).size < 3
      || evidenceInstances.some((instance) =>
        !originIds.includes(instance.originCandidateId)
        || !Array.isArray(instance.spanIds)
        || instance.spanIds.length === 0
        || instance.spanIds.some((spanId) => !evidenceIds.includes(spanId))))
  ) {
    reasons.push("insufficient_evidence_instances");
  }

  if (!promotableStatuses.has(card.epistemicStatus)) {
    reasons.push("epistemic_status_not_promotable");
  }
  if (!new Set(["passed", "bounded"]).has(card.falsification.status)) {
    reasons.push("falsification_not_passed");
  }
  if (
    card.falsification.status === "bounded"
    && counterIds.length === 0
    && (!Array.isArray(card.falsification.alternativeExplanations)
      || card.falsification.alternativeExplanations.length === 0)
    && (!Array.isArray(card.falsification.applicabilityLimits)
      || card.falsification.applicabilityLimits.length === 0)
  ) {
    reasons.push("missing_counterexample");
  }
  if (counterIds.some((id) => evidenceIds.includes(id))) {
    reasons.push("counterexample_overlaps_evidence");
  }
  if (card.applicability.length === 0 || card.when.length === 0) {
    reasons.push("missing_applicability");
  }
  if (card.do.length === 0 || card.avoid.length === 0) {
    reasons.push("missing_action");
  }
  if (card.targetLayers.length === 0) {
    reasons.push("missing_target_layer");
  }

  return [...new Set(reasons)];
}

/** 纯代码质量门：模型不能自行宣布自己的结论可复用。 */
export function assessMechanismCard(
  card: MechanismCard,
  document: SourceDocument,
): MechanismCardAssessment {
  const reasons = assessMechanismCardRuntime(card, document.spans);
  return { eligible: reasons.length === 0, reasons };
}
