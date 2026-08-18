import type {
  MechanismCard,
  MechanismScope,
  MechanismTargetLayer,
} from "./types";

export interface TransferMechanismCard {
  id: string;
  title: string;
  targetEffect: string;
  scope: MechanismScope;
  when: string[];
  operations: string[];
  avoid: string[];
  applicability: string[];
  targetLayers: MechanismTargetLayer[];
}

export type TransferCardProjectionResult =
  | { ok: true; card: TransferMechanismCard }
  | { ok: false; reason: "card_not_verified" }
  | { ok: false; reason: "card_not_adopted" }
  | { ok: false; reason: "card_provenance_missing" }
  | { ok: false; reason: "card_evidence_instances_missing" }
  | { ok: false; reason: "card_scope_missing" }
  | {
      ok: false;
      reason: "source_specific_content";
      matchedTerms: string[];
    };

/**
 * 纯代码白名单投影。生成模型看不到 observation、证据、反例、源作摘录或
 * falsification 记录；若允许字段仍含已登记的源特异词，失败关闭而不猜测改写。
 */
export function projectTransferMechanismCard(
  source: MechanismCard,
  policy: { forbiddenTerms: readonly string[] },
  options: { allowEditorOnly?: boolean } = {},
): TransferCardProjectionResult {
  if (source.lifecycle !== "verified") {
    return { ok: false, reason: "card_not_verified" };
  }
  const editorOnly = source.adoption === "editor_only" && options.allowEditorOnly === true;
  if (source.adoption !== "adopted" && !editorOnly) {
    return { ok: false, reason: "card_not_adopted" };
  }
  if (!Array.isArray(source.originCandidateIds) || source.originCandidateIds.length === 0) {
    return { ok: false, reason: "card_provenance_missing" };
  }
  if (!source.scope) {
    return { ok: false, reason: "card_scope_missing" };
  }
  const evidenceInstances = Array.isArray(source.evidenceInstances)
    ? source.evidenceInstances
    : [];
  if (
    source.scope === "distributed"
    && (evidenceInstances.length < 3
      || new Set(evidenceInstances.map((instance) => instance.originCandidateId)).size < 3
      || evidenceInstances.some((instance) =>
        !source.originCandidateIds?.includes(instance.originCandidateId)
        || !Array.isArray(instance.spanIds)
        || instance.spanIds.length === 0
        || instance.spanIds.some((spanId) => !source.evidenceSpanIds.includes(spanId))))
  ) {
    return { ok: false, reason: "card_evidence_instances_missing" };
  }

  const card: TransferMechanismCard = {
    id: source.id,
    title: source.title,
    targetEffect: source.effectHypothesis,
    scope: source.scope,
    when: [...source.when],
    operations: [...source.do],
    avoid: [...source.avoid],
    applicability: [...source.applicability],
    targetLayers: editorOnly
      ? source.targetLayers.filter((layer) => layer === "editor")
      : [...source.targetLayers],
  };

  if (card.targetLayers.length === 0) {
    return { ok: false, reason: "card_not_adopted" };
  }

  const serialized = JSON.stringify(card).toLocaleLowerCase();
  const matchedTerms = [...new Set(policy.forbiddenTerms)]
    .filter((term) => term.trim().length > 0)
    .filter((term) => serialized.includes(term.toLocaleLowerCase()));
  if (matchedTerms.length > 0) {
    return {
      ok: false,
      reason: "source_specific_content",
      matchedTerms,
    };
  }

  return { ok: true, card };
}
