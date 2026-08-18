import type {
  AdoptionStatus,
  AnalysisThread,
  EpisodeRole,
  EpistemicStatus,
  FactCandidate,
  FactKind,
  MechanismCard,
  MechanismTargetLayer,
  ThreadEpisode,
  ThreadKind,
} from "./types";
import { FACT_EXTRACTION_STRING_LIMITS, MAX_FACT_EVIDENCE_SPANS, MAX_FACTS_PER_EXTRACTION } from "./analysis-json-schemas";

export type EvidenceValidationCode =
  | "invalid_json"
  | "invalid_type"
  | "missing_field"
  | "extra_field"
  | "empty_string"
  | "invalid_integer"
  | "invalid_enum"
  | "missing_raw_label"
  | "unexpected_raw_label"
  | "evidence_required"
  | "unknown_span"
  | "duplicate_span_reference"
  | "duplicate_id"
  | "too_many_items"
  | "too_long";

export interface EvidenceValidationIssue {
  code: EvidenceValidationCode;
  path: string;
  message: string;
}

export class EvidenceValidationError extends Error {
  readonly issues: EvidenceValidationIssue[];

  constructor(issues: EvidenceValidationIssue[]) {
    super(`证据分析输出无效：${issues[0]?.message ?? "未知校验错误"}`);
    this.name = "EvidenceValidationError";
    this.issues = issues;
  }
}

export interface FactExtractionOutput {
  facts: FactCandidate[];
}

export type ValidatedThreadEpisode = ThreadEpisode;

export interface ValidatedAnalysisThread
  extends Omit<AnalysisThread, "episodes"> {
  episodes: ValidatedThreadEpisode[];
}

export interface ThreadLinkingOutput {
  threads: ValidatedAnalysisThread[];
}

export interface MechanismCompilerOutput {
  cards: MechanismCard[];
}

type AllowedSpanIds = ReadonlySet<string> | readonly string[];
type JsonRecord = Record<string, unknown>;

const EPISTEMIC_STATUSES = [
  "observed",
  "inferred",
  "hypothesis",
  "ambiguous",
  "unknown",
  "not_observed",
  "not_applicable",
  "extractor_error",
] as const satisfies readonly EpistemicStatus[];

const EVIDENCE_REQUIRED_STATUSES = new Set<EpistemicStatus>([
  "observed",
  "inferred",
  "hypothesis",
  "ambiguous",
]);

const FACT_KINDS = [
  "character",
  "alias",
  "event",
  "state_change",
  "time",
  "place",
  "object",
  "goal",
  "promise",
  "threat",
  "knowledge",
  "open_question",
  "world_rule",
  "other",
] as const satisfies readonly FactKind[];

const THREAD_KINDS = [
  "event",
  "object",
  "expectation",
  "character",
  "relationship",
  "world_rule",
  "other",
] as const satisfies readonly ThreadKind[];

const EPISODE_ROLES = [
  "setup",
  "reinforcement",
  "escalation",
  "complication",
  "partial_payoff",
  "payoff",
  "reversal",
  "refusal",
  "aftermath",
  "other",
  "unknown",
] as const satisfies readonly EpisodeRole[];

const THREAD_LIFECYCLES = [
  "open",
  "resolved",
  "open_at_boundary",
  "ambiguous",
] as const satisfies readonly AnalysisThread["lifecycle"][];

const MECHANISM_LIFECYCLES = [
  "candidate",
  "verified",
  "rejected",
] as const satisfies readonly MechanismCard["lifecycle"][];

const FALSIFICATION_STATUSES = [
  "not_run",
  "passed",
  "bounded",
  "failed",
] as const satisfies readonly MechanismCard["falsification"]["status"][];

const TARGET_LAYERS = [
  "outline",
  "chapter_plan",
  "draft",
  "editor",
] as const satisfies readonly MechanismTargetLayer[];

const ADOPTION_STATUSES = [
  "pending",
  "adopted",
  "rejected",
  "editor_only",
] as const satisfies readonly AdoptionStatus[];

const FACT_FIELDS = [
  "id",
  "kind",
  "rawLabel",
  "statement",
  "subject",
  "object",
  "evidenceSpanIds",
  "epistemicStatus",
] as const;

const THREAD_FIELDS = [
  "id",
  "kind",
  "title",
  "episodes",
  "epistemicStatus",
  "lifecycle",
] as const;

const EPISODE_FIELDS = [
  "id",
  "role",
  "rawLabel",
  "summary",
  "evidenceSpanIds",
  "ordinal",
] as const;

const CARD_FIELDS = [
  "id",
  "title",
  "observation",
  "effectHypothesis",
  "when",
  "do",
  "avoid",
  "evidenceSpanIds",
  "counterexampleSpanIds",
  "epistemicStatus",
  "lifecycle",
  "falsification",
  "applicability",
  "targetLayers",
  "adoption",
] as const;

/** 解析并校验模型的事实提取原始文本。Markdown 围栏不会被容错剥除。 */
export function parseFactExtractionOutput(
  rawOutput: string,
  allowedSpanIds: AllowedSpanIds,
): FactExtractionOutput {
  const root = readExactRecord(
    parseRawJSON(rawOutput),
    "$",
    ["facts"],
  );
  const values = readArray(root.facts, "$.facts");
  if (values.length > MAX_FACTS_PER_EXTRACTION) {
    fail("too_many_items", "$.facts", `facts 最多 ${MAX_FACTS_PER_EXTRACTION} 条。`);
  }
  const allowed = new Set(allowedSpanIds);
  const ids = new Set<string>();
  const facts = values.map((value, index) => {
    const path = `$.facts[${index}]`;
    const candidate = parseFactCandidate(value, path, allowed);
    registerUniqueId(candidate.id, path, ids);
    return candidate;
  });
  return { facts };
}

/** 解析并校验 thread linker 的原始文本。 */
export function parseThreadLinkingOutput(
  rawOutput: string,
  allowedSpanIds: AllowedSpanIds,
): ThreadLinkingOutput {
  const root = readExactRecord(
    parseRawJSON(rawOutput),
    "$",
    ["threads"],
  );
  const values = readArray(root.threads, "$.threads");
  const allowed = new Set(allowedSpanIds);
  const ids = new Set<string>();
  const threads = values.map((value, index) => {
    const path = `$.threads[${index}]`;
    const parsed = parseThread(value, path, allowed, ids);
    registerUniqueId(parsed.id, path, ids);
    return parsed;
  });
  return { threads };
}

/** 解析并校验 mechanism compiler 的原始文本。 */
export function parseMechanismCompilerOutput(
  rawOutput: string,
  allowedSpanIds: AllowedSpanIds,
): MechanismCompilerOutput {
  const root = readExactRecord(parseRawJSON(rawOutput), "$", ["cards"]);
  const values = readArray(root.cards, "$.cards");
  const allowed = new Set(allowedSpanIds);
  const ids = new Set<string>();
  const cards = values.map((value, index) => {
    const path = `$.cards[${index}]`;
    const parsed = parseMechanismCard(value, path, allowed);
    registerUniqueId(parsed.id, path, ids);
    return parsed;
  });
  return { cards };
}

function parseFactCandidate(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
): FactCandidate {
  const record = readExactRecord(value, path, FACT_FIELDS);
  const id = readNonEmptyString(record.id, `${path}.id`);
  assertMaxLength(id, `${path}.id`, FACT_EXTRACTION_STRING_LIMITS.id);
  const kind = readEnum(record.kind, `${path}.kind`, FACT_KINDS);
  const rawLabel = readNullableNonEmptyString(
    record.rawLabel,
    `${path}.rawLabel`,
  );
  if (rawLabel !== null) assertMaxLength(rawLabel, `${path}.rawLabel`, FACT_EXTRACTION_STRING_LIMITS.rawLabel);
  assertRawLabel(kind, rawLabel, `${path}.rawLabel`);
  const statement = readNonEmptyString(record.statement, `${path}.statement`);
  assertMaxLength(statement, `${path}.statement`, FACT_EXTRACTION_STRING_LIMITS.statement);
  const subject = readNullableNonEmptyString(record.subject, `${path}.subject`);
  if (subject !== null) assertMaxLength(subject, `${path}.subject`, FACT_EXTRACTION_STRING_LIMITS.subject);
  const object = readNullableNonEmptyString(record.object, `${path}.object`);
  if (object !== null) assertMaxLength(object, `${path}.object`, FACT_EXTRACTION_STRING_LIMITS.object);
  const evidenceSpanIds = readEvidenceSpanIds(
    record.evidenceSpanIds,
    `${path}.evidenceSpanIds`,
    allowed,
  );
  if (evidenceSpanIds.length > MAX_FACT_EVIDENCE_SPANS) {
    fail("too_many_items", `${path}.evidenceSpanIds`, `evidenceSpanIds 最多 ${MAX_FACT_EVIDENCE_SPANS} 条。`);
  }
  for (const [index, spanId] of evidenceSpanIds.entries()) assertMaxLength(spanId, `${path}.evidenceSpanIds[${index}]`, FACT_EXTRACTION_STRING_LIMITS.evidenceSpanId);
  const epistemicStatus = readEnum(
    record.epistemicStatus,
    `${path}.epistemicStatus`,
    EPISTEMIC_STATUSES,
  );
  assertEvidenceRequired(epistemicStatus, evidenceSpanIds, path);

  return {
    id,
    kind,
    statement,
    evidenceSpanIds,
    epistemicStatus,
    ...(subject === null ? {} : { subject }),
    ...(object === null ? {} : { object }),
    ...(rawLabel === null ? {} : { rawLabel }),
  };
}

function parseThread(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  episodeIds: Set<string>,
): ValidatedAnalysisThread {
  const record = readExactRecord(value, path, THREAD_FIELDS);
  const id = readNonEmptyString(record.id, `${path}.id`);
  const sourceKind = readNonEmptyString(record.kind, `${path}.kind`);
  const kind = THREAD_KINDS.includes(sourceKind as ThreadKind)
    ? sourceKind as ThreadKind
    : "other";
  const rawLabel = kind === "other" && sourceKind !== "other"
    ? sourceKind
    : undefined;
  const title = readNonEmptyString(record.title, `${path}.title`);
  const epistemicStatus = readEnum(
    record.epistemicStatus,
    `${path}.epistemicStatus`,
    EPISTEMIC_STATUSES,
  );
  const lifecycle = readEnum(
    record.lifecycle,
    `${path}.lifecycle`,
    THREAD_LIFECYCLES,
  );
  const episodeValues = readArray(record.episodes, `${path}.episodes`);
  if (
    EVIDENCE_REQUIRED_STATUSES.has(epistemicStatus) &&
    episodeValues.length === 0
  ) {
    fail(
      "evidence_required",
      `${path}.episodes`,
      `${epistemicStatus} thread 至少需要一个有证据的 episode`,
    );
  }
  const episodes = episodeValues.map((episodeValue, index) => {
    const episodePath = `${path}.episodes[${index}]`;
    const episode = parseEpisode(
      episodeValue,
      episodePath,
      allowed,
      epistemicStatus,
    );
    registerUniqueId(episode.id, episodePath, episodeIds);
    return episode;
  });

  return {
    id,
    kind,
    title,
    episodes,
    epistemicStatus,
    lifecycle,
    ...(rawLabel === undefined ? {} : { rawLabel }),
  };
}

function parseEpisode(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  threadStatus: EpistemicStatus,
): ValidatedThreadEpisode {
  const record = readExactRecord(value, path, EPISODE_FIELDS);
  const id = readNonEmptyString(record.id, `${path}.id`);
  const sourceRole = readNonEmptyString(record.role, `${path}.role`);
  const role = EPISODE_ROLES.includes(sourceRole as EpisodeRole)
    ? sourceRole as EpisodeRole
    : "other";
  const suppliedRawLabel = readNullableNonEmptyString(
    record.rawLabel,
    `${path}.rawLabel`,
  );
  const rawLabel = sourceRole === role ? suppliedRawLabel : sourceRole;
  assertRawLabel(role, rawLabel, `${path}.rawLabel`);
  const summary = readNonEmptyString(record.summary, `${path}.summary`);
  const evidenceSpanIds = readEvidenceSpanIds(
    record.evidenceSpanIds,
    `${path}.evidenceSpanIds`,
    allowed,
  );
  assertEvidenceRequired(threadStatus, evidenceSpanIds, path);
  const ordinal = readPositiveInteger(record.ordinal, `${path}.ordinal`);

  return {
    id,
    role,
    summary,
    evidenceSpanIds,
    ordinal,
    ...(rawLabel === null ? {} : { rawLabel }),
  };
}

function parseMechanismCard(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
): MechanismCard {
  const record = readExactRecord(value, path, CARD_FIELDS);
  const id = readNonEmptyString(record.id, `${path}.id`);
  const title = readNonEmptyString(record.title, `${path}.title`);
  const observation = readNonEmptyString(
    record.observation,
    `${path}.observation`,
  );
  const effectHypothesis = readNonEmptyString(
    record.effectHypothesis,
    `${path}.effectHypothesis`,
  );
  const when = readNonEmptyStringArray(record.when, `${path}.when`);
  const doActions = readNonEmptyStringArray(record.do, `${path}.do`);
  const avoid = readNonEmptyStringArray(record.avoid, `${path}.avoid`);
  const evidenceSpanIds = readEvidenceSpanIds(
    record.evidenceSpanIds,
    `${path}.evidenceSpanIds`,
    allowed,
  );
  const counterexampleSpanIds = readEvidenceSpanIds(
    record.counterexampleSpanIds,
    `${path}.counterexampleSpanIds`,
    allowed,
  );
  const epistemicStatus = readEnum(
    record.epistemicStatus,
    `${path}.epistemicStatus`,
    EPISTEMIC_STATUSES,
  );
  assertEvidenceRequired(epistemicStatus, evidenceSpanIds, path);
  const lifecycle = readEnum(
    record.lifecycle,
    `${path}.lifecycle`,
    MECHANISM_LIFECYCLES,
  );
  const falsificationRecord = readExactRecord(
    record.falsification,
    `${path}.falsification`,
    ["status", "alternativeExplanations"],
  );
  const falsification = {
    status: readEnum(
      falsificationRecord.status,
      `${path}.falsification.status`,
      FALSIFICATION_STATUSES,
    ),
    alternativeExplanations: readNonEmptyStringArray(
      falsificationRecord.alternativeExplanations,
      `${path}.falsification.alternativeExplanations`,
    ),
  };
  const applicability = readNonEmptyStringArray(
    record.applicability,
    `${path}.applicability`,
  );
  const targetLayers = readEnumArray(
    record.targetLayers,
    `${path}.targetLayers`,
    TARGET_LAYERS,
  );
  const adoption = readEnum(
    record.adoption,
    `${path}.adoption`,
    ADOPTION_STATUSES,
  );

  return {
    id,
    title,
    observation,
    effectHypothesis,
    when,
    do: doActions,
    avoid,
    evidenceSpanIds,
    counterexampleSpanIds,
    epistemicStatus,
    lifecycle,
    falsification,
    applicability,
    targetLayers,
    adoption,
  };
}

function parseRawJSON(rawOutput: string): unknown {
  try {
    return JSON.parse(rawOutput) as unknown;
  } catch {
    fail(
      "invalid_json",
      "$",
      "输出必须是单个 JSON 值，不能包含 Markdown 围栏或解释文字",
    );
  }
}

function readExactRecord<const T extends readonly string[]>(
  value: unknown,
  path: string,
  fields: T,
): JsonRecord & Record<T[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_type", path, "必须是 object");
  }
  const record = value as JsonRecord;
  const expected = new Set<string>(fields);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      fail("extra_field", `${path}.${key}`, `不允许额外字段 ${key}`);
    }
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      fail("missing_field", `${path}.${field}`, `缺少必填字段 ${field}`);
    }
  }
  return record as JsonRecord & Record<T[number], unknown>;
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail("invalid_type", path, "必须是 array");
  return value;
}

function readNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string") fail("invalid_type", path, "必须是 string");
  if (value.trim() === "") fail("empty_string", path, "不能是空字符串");
  return value;
}

function assertMaxLength(value: string, path: string, maxLength: number): void {
  if (value.length > maxLength) fail("too_long", path, `最多 ${maxLength} 个字符。`);
}

function readNullableNonEmptyString(
  value: unknown,
  path: string,
): string | null {
  if (value === null) return null;
  return readNonEmptyString(value, path);
}

function readNonEmptyStringArray(value: unknown, path: string): string[] {
  return readArray(value, path).map((item, index) =>
    readNonEmptyString(item, `${path}[${index}]`),
  );
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(
      "invalid_enum",
      path,
      `只允许：${allowed.join(" / ")}`,
    );
  }
  return value as T[number];
}

function readEnumArray<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number][] {
  return readArray(value, path).map((item, index) =>
    readEnum(item, `${path}[${index}]`, allowed),
  );
}

function readPositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    fail("invalid_integer", path, "必须是正整数");
  }
  return value as number;
}

function readEvidenceSpanIds(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
): string[] {
  const spanIds = readNonEmptyStringArray(value, path);
  const seen = new Set<string>();
  for (let index = 0; index < spanIds.length; index += 1) {
    const spanId = spanIds[index];
    if (seen.has(spanId)) {
      fail(
        "duplicate_span_reference",
        `${path}[${index}]`,
        `spanId ${spanId} 在同一证据列表中重复`,
      );
    }
    seen.add(spanId);
    if (!allowed.has(spanId)) {
      fail(
        "unknown_span",
        `${path}[${index}]`,
        `spanId ${spanId} 不属于本次允许的原文范围`,
      );
    }
  }
  return spanIds;
}

function assertRawLabel(
  category: string,
  rawLabel: string | null,
  path: string,
): void {
  if (category === "other" && rawLabel === null) {
    fail("missing_raw_label", path, "类别为 other 时必须保留 rawLabel");
  }
  if (category !== "other" && rawLabel !== null) {
    fail(
      "unexpected_raw_label",
      path,
      "核心枚举类别的 rawLabel 必须为 null，不能夹带第二分类",
    );
  }
}

function assertEvidenceRequired(
  status: EpistemicStatus,
  evidenceSpanIds: readonly string[],
  path: string,
): void {
  if (
    EVIDENCE_REQUIRED_STATUSES.has(status) &&
    evidenceSpanIds.length === 0
  ) {
    fail(
      "evidence_required",
      `${path}.evidenceSpanIds`,
      `${status} 结论必须至少引用一个真实 evidence span`,
    );
  }
}

function registerUniqueId(
  id: string,
  path: string,
  seen: Set<string>,
): void {
  if (seen.has(id)) {
    fail("duplicate_id", `${path}.id`, `id ${id} 重复`);
  }
  seen.add(id);
}

function fail(
  code: EvidenceValidationCode,
  path: string,
  message: string,
): never {
  throw new EvidenceValidationError([{ code, path, message }]);
}
