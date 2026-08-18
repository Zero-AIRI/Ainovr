import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();
const STATUSES = ["passed", "bounded", "failed", "unknown"] as const;

export type FalsificationStatus = typeof STATUSES[number];

export interface IndependentFalsification {
  conclusionId: string;
  status: FalsificationStatus;
  counterEvidenceSpanIds: string[];
  alternativeExplanations: string[];
  applicabilityLimits: string[];
  sampleBiasNotes: string[];
}

export interface FalsificationWorkItem {
  conclusionId: string;
  proposition: string;
  retrievalScope: { analysisProjectId: string; allowedSpanIds: string[] };
}

export interface IndependentFalsificationService {
  getWorkItem(analysisProjectId: string, conclusionId: string): Promise<FalsificationWorkItem>;
  submit(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; conclusionId: string; rawOutput: string }): Promise<CommandResult>;
  getByConclusion(analysisProjectId: string, conclusionId: string): Promise<IndependentFalsification | null>;
}

export interface CreateIndependentFalsificationServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  now?: () => number;
}

/**
 * 第四遍反证与结论生成进程隔离：它的 work item 只给出待检验命题与可检索 span，
 * 不回传上一 Agent 的观察、替代解释或生产用途措辞，避免同一套论证自证。
 */
export function createIndependentFalsificationService(options: CreateIndependentFalsificationServiceOptions): IndependentFalsificationService {
  return {
    async getWorkItem(analysisProjectId, conclusionId) {
      const conclusion = await readConclusion(options.driver, analysisProjectId, conclusionId);
      if (!conclusion) throw new Error("ResearchConclusion 不存在或不属于当前 AnalysisProject。");
      return {
        conclusionId,
        proposition: conclusion.conclusion,
        retrievalScope: { analysisProjectId, allowedSpanIds: await readProjectSpanIds(options.driver, analysisProjectId) },
      };
    },

    async submit(input) {
      assertNonEmpty(input.analysisProjectId, "analysisProjectId");
      assertNonEmpty(input.conclusionId, "conclusionId");
      assertNonEmpty(input.rawOutput, "rawOutput");
      const conclusion = await readConclusion(options.driver, input.analysisProjectId, input.conclusionId);
      if (!conclusion) throw new Error("ResearchConclusion 不存在或不属于当前 AnalysisProject。");
      const assessment = parseIndependentFalsificationOutput(input.rawOutput, input.conclusionId, await readProjectSpanIds(options.driver, input.analysisProjectId));
      const rawOutput = await options.objects.put({ content: encoder.encode(input.rawOutput), mediaType: "application/json; charset=utf-8" });
      return options.commands.execute({
        ...input.command,
        tool: "commit_independent_falsification",
        args: {
          analysisProjectId: input.analysisProjectId,
          conclusionId: input.conclusionId,
          researchQuestionId: conclusion.researchQuestionId,
          rawOutput,
          assessment: toCommandFalsification(assessment),
        },
      });
    },

    async getByConclusion(analysisProjectId, conclusionId) {
      const rows = await options.driver.query<{ payload_json: string }>({
        sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ? ORDER BY created_at ASC, analysis_item_id ASC",
        params: [analysisProjectId],
      });
      for (const row of rows) {
        const record = parseRecord(row.payload_json, "IndependentFalsification payload 损坏。");
        if (record.kind !== "independent_falsification" || record.conclusionId !== conclusionId || !record.assessment || typeof record.assessment !== "object" || Array.isArray(record.assessment)) continue;
        return parseAssessment(record.assessment as Record<string, unknown>, conclusionId, new Set(await readProjectSpanIds(options.driver, analysisProjectId)));
      }
      return null;
    },
  };
}

/** 严格解析反证 Agent 输出；它只能返回已给定结论的审查结果。 */
export function parseIndependentFalsificationOutput(rawOutput: string, conclusionId: string, allowedSpanIds: readonly string[]): IndependentFalsification {
  const record = parseRecord(rawOutput, "独立反证输出必须是单个 JSON 对象。");
  assertExactKeys(record, ["assessment"], "独立反证输出");
  if (!record.assessment || typeof record.assessment !== "object" || Array.isArray(record.assessment)) throw new Error("独立反证输出 assessment 必须是对象。 ");
  return parseAssessment(record.assessment as Record<string, unknown>, conclusionId, new Set(allowedSpanIds));
}

function parseAssessment(record: Record<string, unknown>, conclusionId: string, allowed: ReadonlySet<string>): IndependentFalsification {
  assertExactKeys(record, ["conclusionId", "status", "counterEvidenceSpanIds", "alternativeExplanations", "applicabilityLimits", "sampleBiasNotes"], "独立反证 assessment");
  if (readNonEmpty(record.conclusionId, "assessment.conclusionId") !== conclusionId) throw new Error("独立反证不得替换待检验的结论。 ");
  const status = readEnum(record.status, "assessment.status");
  const assessment: IndependentFalsification = {
    conclusionId,
    status,
    counterEvidenceSpanIds: readSpanIds(record.counterEvidenceSpanIds, "assessment.counterEvidenceSpanIds", allowed),
    alternativeExplanations: readStringArray(record.alternativeExplanations, "assessment.alternativeExplanations"),
    applicabilityLimits: readStringArray(record.applicabilityLimits, "assessment.applicabilityLimits"),
    sampleBiasNotes: readStringArray(record.sampleBiasNotes, "assessment.sampleBiasNotes"),
  };
  const boundaries = assessment.counterEvidenceSpanIds.length + assessment.alternativeExplanations.length + assessment.applicabilityLimits.length;
  if (status === "bounded" && boundaries === 0) throw new Error("bounded 反证必须记录反例、替代解释或适用边界。 ");
  if (status === "failed" && assessment.counterEvidenceSpanIds.length === 0) throw new Error("failed 反证必须绑定至少一个反例 SourceSpan。 ");
  return assessment;
}

/** Command planner 的防御性解析；调用端仍需经过 service 的项目归属验证。 */
export function parsePlannedIndependentFalsification(value: unknown, conclusionId: string): IndependentFalsification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const spans = Array.isArray(record.counterEvidenceSpanIds) ? record.counterEvidenceSpanIds.filter((item): item is string => typeof item === "string") : [];
  try {
    return parseAssessment(record, conclusionId, new Set(spans));
  } catch {
    return null;
  }
}

export function toCommandFalsification(value: IndependentFalsification): Record<string, unknown> {
  return {
    conclusionId: value.conclusionId,
    status: value.status,
    counterEvidenceSpanIds: value.counterEvidenceSpanIds,
    alternativeExplanations: value.alternativeExplanations,
    applicabilityLimits: value.applicabilityLimits,
    sampleBiasNotes: value.sampleBiasNotes,
  };
}

interface StoredConclusion {
  researchQuestionId: string;
  conclusion: string;
}

async function readConclusion(driver: SqlDriver, analysisProjectId: string, conclusionId: string): Promise<StoredConclusion | null> {
  const rows = await driver.query<{ research_question_id: string | null; payload_json: string }>({
    sql: "SELECT research_question_id, payload_json FROM analysis_items WHERE analysis_project_id = ? ORDER BY created_at ASC, analysis_item_id ASC",
    params: [analysisProjectId],
  });
  for (const row of rows) {
    const payload = parseRecord(row.payload_json, "ResearchConclusion payload 损坏。");
    if (payload.kind !== "research_conclusion" || !payload.conclusion || typeof payload.conclusion !== "object" || Array.isArray(payload.conclusion)) continue;
    const conclusion = payload.conclusion as Record<string, unknown>;
    if (conclusion.id !== conclusionId || typeof row.research_question_id !== "string" || !row.research_question_id || typeof conclusion.conclusion !== "string" || !conclusion.conclusion.trim()) continue;
    return { researchQuestionId: row.research_question_id, conclusion: conclusion.conclusion };
  }
  return null;
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
  if (rows.length === 0) throw new Error("AnalysisProject 没有可检索的 SourceSpan。");
  return rows.map((row) => row.span_id);
}

function readSpanIds(value: unknown, label: string, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组。`);
  const values = value.map((item, index) => readNonEmpty(item, `${label}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${label} 不允许重复 spanId。`);
  if (values.some((item) => !allowed.has(item))) throw new Error(`${label} 含不属于当前 AnalysisProject 的 SourceSpan。`);
  return values;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组。`);
  return value.map((item, index) => readNonEmpty(item, `${label}[${index}]`));
}

function readEnum(value: unknown, label: string): FalsificationStatus {
  if (typeof value !== "string" || !STATUSES.includes(value as FalsificationStatus)) throw new Error(`${label} 枚举值无效。`);
  return value as FalsificationStatus;
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (Object.keys(record).length !== expected.size || keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) throw new Error(`${label} 字段不完整或包含额外字段。`);
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
}

function readNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`);
  return value;
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
