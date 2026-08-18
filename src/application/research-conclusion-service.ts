import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();

const EPISTEMIC_STATUSES = ["observed", "inferred", "hypothesis", "ambiguous", "unknown", "not_observed", "not_applicable"] as const;
const COVERAGE_STATUSES = ["complete", "partial", "no_pattern", "not_observed", "not_applicable", "skipped_low_signal", "user_excluded", "failed", "blocked_by_budget", "needs_review"] as const;
const EVIDENCE_REQUIRED = new Set<string>(["observed", "inferred", "hypothesis", "ambiguous"]);

export type ResearchConclusionEpistemicStatus = typeof EPISTEMIC_STATUSES[number];
export type ResearchConclusionCoverageStatus = typeof COVERAGE_STATUSES[number];

export interface ResearchObservation {
  id: string;
  statement: string;
  evidenceSpanIds: string[];
}

/** 一个受 ResearchQuestion 约束、可回到 SourceSpan 的解释型结论。 */
export interface ResearchConclusion {
  id: string;
  researchQuestionId: string;
  conclusion: string;
  observations: ResearchObservation[];
  evidenceSpanIds: string[];
  counterEvidenceSpanIds: string[];
  alternativeExplanations: string[];
  applicabilityBoundaries: string[];
  productionImplications: string[];
  coverageStatus: ResearchConclusionCoverageStatus;
  epistemicStatus: ResearchConclusionEpistemicStatus;
}

export interface ResearchConclusionService {
  submit(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; researchQuestionId: string; rawOutput: string }): Promise<CommandResult>;
  getByQuestion(analysisProjectId: string, researchQuestionId: string): Promise<ResearchConclusion[]>;
}

export interface CreateResearchConclusionServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  now?: () => number;
}

/**
 * 第三遍研究问题分析的 Application Service。原始模型输出只留在 ObjectStore，
 * SQLite 仅写入已校验的结论索引、结构化观察、证据关系与覆盖处置。
 */
export function createResearchConclusionService(options: CreateResearchConclusionServiceOptions): ResearchConclusionService {
  return {
    async submit(input) {
      assertNonEmpty(input.analysisProjectId, "analysisProjectId");
      assertNonEmpty(input.researchQuestionId, "researchQuestionId");
      assertNonEmpty(input.rawOutput, "rawOutput");
      await assertApprovedQuestion(options.driver, input.analysisProjectId, input.researchQuestionId);
      const allowedSpanIds = await readProjectSpanIds(options.driver, input.analysisProjectId);
      const conclusions = parseResearchConclusionOutput(input.rawOutput, input.researchQuestionId, allowedSpanIds);
      const rawOutput = await options.objects.put({ content: encoder.encode(input.rawOutput), mediaType: "application/json; charset=utf-8" });
      return options.commands.execute({
        ...input.command,
        tool: "commit_research_conclusions",
        args: { analysisProjectId: input.analysisProjectId, researchQuestionId: input.researchQuestionId, rawOutput, conclusions: conclusions.map(toCommandConclusion) },
      });
    },

    async getByQuestion(analysisProjectId, researchQuestionId) {
      const rows = await options.driver.query<{ payload_json: string }>({
        sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ? AND research_question_id = ? ORDER BY created_at ASC, analysis_item_id ASC",
        params: [analysisProjectId, researchQuestionId],
      });
      const stored = rows.flatMap((row) => parseStoredConclusion(row.payload_json));
      const allowedSpanIds = await readProjectSpanIds(options.driver, analysisProjectId);
      return stored.map((conclusion) => parseResearchConclusionOutput(JSON.stringify({ conclusions: [conclusion] }), researchQuestionId, allowedSpanIds)[0]!);
    },
  };
}

/** 严格解析第三遍输出；不猜 Markdown，也不接受其他问题或其他项目的 span。 */
export function parseResearchConclusionOutput(rawOutput: string, researchQuestionId: string, allowedSpanIds: readonly string[]): ResearchConclusion[] {
  const root = parseRecord(rawOutput, "研究结论输出必须是单个 JSON 对象。");
  assertExactKeys(root, ["conclusions"], "研究结论输出");
  if (!Array.isArray(root.conclusions)) throw new Error("research conclusions 必须是数组。");
  const allowed = new Set(allowedSpanIds);
  const ids = new Set<string>();
  return root.conclusions.map((value, index) => parseConclusion(value, index, researchQuestionId, allowed, ids));
}

/** Command planner 复用的防御性解析；真正的项目/问题/span 归属仍在 service 层重新校验。 */
export function parsePlannedResearchConclusions(value: unknown, researchQuestionId: string): ResearchConclusion[] | null {
  if (!Array.isArray(value)) return null;
  const spanIds = collectSpanIds(value);
  try {
    return parseResearchConclusionOutput(JSON.stringify({ conclusions: value }), researchQuestionId, spanIds);
  } catch {
    return null;
  }
}

/** 传给 CommandService 的结构不包含模型原始 JSON，null/数组字段保持显式。 */
export function toCommandConclusion(conclusion: ResearchConclusion): Record<string, unknown> {
  return {
    id: conclusion.id,
    researchQuestionId: conclusion.researchQuestionId,
    conclusion: conclusion.conclusion,
    observations: conclusion.observations.map((observation) => ({ id: observation.id, statement: observation.statement, evidenceSpanIds: observation.evidenceSpanIds })),
    evidenceSpanIds: conclusion.evidenceSpanIds,
    counterEvidenceSpanIds: conclusion.counterEvidenceSpanIds,
    alternativeExplanations: conclusion.alternativeExplanations,
    applicabilityBoundaries: conclusion.applicabilityBoundaries,
    productionImplications: conclusion.productionImplications,
    coverageStatus: conclusion.coverageStatus,
    epistemicStatus: conclusion.epistemicStatus,
  };
}

function parseConclusion(value: unknown, index: number, expectedQuestionId: string, allowed: ReadonlySet<string>, ids: Set<string>): ResearchConclusion {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`conclusions[${index}] 必须是对象。`);
  const item = value as Record<string, unknown>;
  assertExactKeys(item, ["id", "researchQuestionId", "conclusion", "observations", "evidenceSpanIds", "counterEvidenceSpanIds", "alternativeExplanations", "applicabilityBoundaries", "productionImplications", "coverageStatus", "epistemicStatus"], `conclusions[${index}]`);
  const id = readNonEmpty(item.id, `conclusions[${index}].id`);
  if (ids.has(id)) throw new Error(`研究结论 id 重复：${id}。`);
  ids.add(id);
  const researchQuestionId = readNonEmpty(item.researchQuestionId, `conclusions[${index}].researchQuestionId`);
  if (researchQuestionId !== expectedQuestionId) throw new Error("研究结论不得跨 ResearchQuestion 提交。");
  const epistemicStatus = readEnum(item.epistemicStatus, EPISTEMIC_STATUSES, `conclusions[${index}].epistemicStatus`);
  const evidenceSpanIds = readSpanIds(item.evidenceSpanIds, `conclusions[${index}].evidenceSpanIds`, allowed);
  const counterEvidenceSpanIds = readSpanIds(item.counterEvidenceSpanIds, `conclusions[${index}].counterEvidenceSpanIds`, allowed);
  if (counterEvidenceSpanIds.some((spanId) => evidenceSpanIds.includes(spanId))) throw new Error(`conclusions[${index}] 的正反证据不能引用同一 SourceSpan。`);
  const observations = parseObservations(item.observations, index, allowed);
  const observationSpanIds = new Set(observations.flatMap((observation) => observation.evidenceSpanIds));
  if ([...observationSpanIds].some((spanId) => !evidenceSpanIds.includes(spanId))) throw new Error(`conclusions[${index}] 的 observation evidence 必须包含在 evidenceSpanIds 中。`);
  const productionImplications = readStringArray(item.productionImplications, `conclusions[${index}].productionImplications`);
  if (EVIDENCE_REQUIRED.has(epistemicStatus) && (evidenceSpanIds.length === 0 || observations.length === 0 || productionImplications.length === 0)) {
    throw new Error(`conclusions[${index}] 的可支持性结论必须有观察、证据和具体生产用途。`);
  }
  return {
    id,
    researchQuestionId,
    conclusion: readNonEmpty(item.conclusion, `conclusions[${index}].conclusion`),
    observations,
    evidenceSpanIds,
    counterEvidenceSpanIds,
    alternativeExplanations: readStringArray(item.alternativeExplanations, `conclusions[${index}].alternativeExplanations`),
    applicabilityBoundaries: readStringArray(item.applicabilityBoundaries, `conclusions[${index}].applicabilityBoundaries`),
    productionImplications,
    coverageStatus: readEnum(item.coverageStatus, COVERAGE_STATUSES, `conclusions[${index}].coverageStatus`),
    epistemicStatus,
  };
}

function parseObservations(value: unknown, conclusionIndex: number, allowed: ReadonlySet<string>): ResearchObservation[] {
  if (!Array.isArray(value)) throw new Error(`conclusions[${conclusionIndex}].observations 必须是数组。`);
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`observations[${index}] 必须是对象。`);
    const observation = entry as Record<string, unknown>;
    assertExactKeys(observation, ["id", "statement", "evidenceSpanIds"], `conclusions[${conclusionIndex}].observations[${index}]`);
    const id = readNonEmpty(observation.id, `observations[${index}].id`);
    if (ids.has(id)) throw new Error(`observation id 重复：${id}。`);
    ids.add(id);
    return { id, statement: readNonEmpty(observation.statement, `observations[${index}].statement`), evidenceSpanIds: readSpanIds(observation.evidenceSpanIds, `observations[${index}].evidenceSpanIds`, allowed) };
  });
}

async function assertApprovedQuestion(driver: SqlDriver, analysisProjectId: string, researchQuestionId: string): Promise<void> {
  const rows = await driver.query<{ status: string }>({
    sql: "SELECT status FROM research_questions WHERE analysis_project_id = ? AND research_question_id = ?",
    params: [analysisProjectId, researchQuestionId],
  });
  if (rows.length === 0) throw new Error("ResearchQuestion 不属于当前 AnalysisProject。");
  if (rows[0]!.status !== "approved") throw new Error("ResearchQuestion 必须先由人类批准后才能提交结论。");
}

async function readProjectSpanIds(driver: SqlDriver, analysisProjectId: string): Promise<string[]> {
  const rows = await driver.query<{ span_id: string }>({
    sql: `SELECT span.span_id
          FROM source_spans span
          INNER JOIN analysis_projects project ON project.source_edition_id = span.source_edition_id
          WHERE project.analysis_project_id = ?
          ORDER BY span.start_byte ASC, span.span_id ASC`,
    params: [analysisProjectId],
  });
  if (rows.length === 0) throw new Error("AnalysisProject 没有可引用的 SourceSpan。");
  return rows.map((row) => row.span_id);
}

function parseStoredConclusion(value: string): ResearchConclusion[] {
  const payload = parseRecord(value, "ResearchConclusion payload 损坏。");
  if (payload.schema_version !== 1 || payload.kind !== "research_conclusion" || !payload.conclusion || typeof payload.conclusion !== "object" || Array.isArray(payload.conclusion)) return [];
  return [payload.conclusion as ResearchConclusion];
}

function collectSpanIds(conclusions: unknown[]): string[] {
  const result: string[] = [];
  for (const conclusion of conclusions) {
    if (!conclusion || typeof conclusion !== "object" || Array.isArray(conclusion)) continue;
    const item = conclusion as Record<string, unknown>;
    for (const key of ["evidenceSpanIds", "counterEvidenceSpanIds"] as const) {
      if (Array.isArray(item[key])) for (const spanId of item[key]) if (typeof spanId === "string") result.push(spanId);
    }
    if (Array.isArray(item.observations)) for (const observation of item.observations) {
      if (!observation || typeof observation !== "object" || Array.isArray(observation)) continue;
      const spanIds = (observation as Record<string, unknown>).evidenceSpanIds;
      if (Array.isArray(spanIds)) for (const spanId of spanIds) if (typeof spanId === "string") result.push(spanId);
    }
  }
  return result;
}

function readSpanIds(value: unknown, label: string, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组。`);
  const ids = value.map((spanId, index) => readNonEmpty(spanId, `${label}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new Error(`${label} 不允许重复 spanId。`);
  if (ids.some((spanId) => !allowed.has(spanId))) throw new Error(`${label} 含不属于当前 AnalysisProject 的 SourceSpan。`);
  return ids;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组。`);
  return value.map((item, index) => readNonEmpty(item, `${label}[${index}]`));
}

function readEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label} 枚举值无效。`);
  return value as T[number];
}

function readNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).length !== expected.size || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`${label} 字段不完整或包含额外字段。`);
}

function parseRecord(value: string, message: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(message);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(message);
  return parsed as Record<string, unknown>;
}
