import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface ResearchDossierEvidence {
  spanId: string;
  sourceEditionId: string;
  sourceHash: string;
  exactTextHash: string;
  startByte: number;
  endByte: number;
  locator: Record<string, unknown>;
}

export interface ResearchDossierConclusion {
  id: string;
  researchQuestionId: string;
  conclusion: string;
  observations: Array<{ id: string; statement: string; evidenceSpanIds: string[] }>;
  evidenceSpanIds: string[];
  counterEvidenceSpanIds: string[];
  alternativeExplanations: string[];
  applicabilityBoundaries: string[];
  productionImplications: string[];
  coverageStatus: string;
  epistemicStatus: string;
  falsificationStatus: "passed" | "bounded" | "failed" | "unknown";
  falsificationAlternativeExplanations: string[];
  falsificationApplicabilityLimits: string[];
  sampleBiasNotes: string[];
}

/**
 * ResearchDossier 是在进入解释型研究前冻结的、可复查但不含参考原文的证据索引。
 * 它把事实、线程和 SourceSpan 的身份绑定在对象库中，SQL 仅保存不可逆的对象引用。
 */
export interface ResearchDossier {
  schemaVersion: 1;
  kind: "research_dossier";
  revision: number;
  analysisProjectId: string;
  factCount: number;
  threadCount: number;
  conclusionCount: number;
  falsificationCount: number;
  conclusions: ResearchDossierConclusion[];
  evidence: ResearchDossierEvidence[];
}

export interface ResearchDossierService {
  create(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string }): Promise<CommandResult>;
  getLatest(analysisProjectId: string): Promise<ResearchDossier | null>;
}

export interface CreateResearchDossierServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  now?: () => number;
}

export function createResearchDossierService(options: CreateResearchDossierServiceOptions): ResearchDossierService {
  return {
    async create(input) {
      if (!input.analysisProjectId.trim()) throw new Error("analysisProjectId 必须是非空字符串。");
      const research = await readResearchConclusions(options.driver, input.analysisProjectId);
      await assertDossierPrerequisites(options.driver, input.analysisProjectId, research);
      const [facts, threads, evidence, revisions] = await Promise.all([
        countAnalysisItems(options.driver, input.analysisProjectId, "fact_ledger_entry"),
        countAnalysisItems(options.driver, input.analysisProjectId, "thread_graph_thread"),
        readEvidence(options.driver, input.analysisProjectId),
        options.driver.query<{ revision: number }>({
          sql: "SELECT revision FROM research_dossiers WHERE analysis_project_id = ? ORDER BY revision DESC LIMIT 1",
          params: [input.analysisProjectId],
        }),
      ]);
      const revision = (revisions[0]?.revision ?? 0) + 1;
      const payload: ResearchDossier = {
        schemaVersion: 1,
        kind: "research_dossier",
        revision,
        analysisProjectId: input.analysisProjectId,
        factCount: facts,
        threadCount: threads,
        conclusionCount: research.conclusions.length,
        falsificationCount: research.falsifications.size,
        conclusions: research.conclusions,
        evidence,
      };
      const object = await options.objects.put({
        content: encoder.encode(JSON.stringify(payload)),
        mediaType: "application/json; charset=utf-8",
      });
      return options.commands.execute({
        ...input.command,
        tool: "commit_research_dossier",
        args: {
          analysisProjectId: input.analysisProjectId,
          dossierId: `dossier:${input.analysisProjectId}:${revision}`,
          revision,
          payload: object,
        },
      });
    },

    async getLatest(analysisProjectId) {
      const rows = await options.driver.query<{ payload_object_hash: string }>({
        sql: "SELECT payload_object_hash FROM research_dossiers WHERE analysis_project_id = ? AND stale = 0 ORDER BY revision DESC LIMIT 1",
        params: [analysisProjectId],
      });
      const row = rows[0];
      if (!row) return null;
      return parseDossier(decoder.decode(await options.objects.read(row.payload_object_hash)));
    },
  };
}

async function assertDossierPrerequisites(driver: SqlDriver, analysisProjectId: string, research: StoredResearch): Promise<void> {
  // 研究问题是显式的人类许可，优先检查，避免把未审批的意图掩盖成技术覆盖错误。
  const questions = await driver.query<{ research_question_id: string; status: string }>({
    sql: "SELECT research_question_id, status FROM research_questions WHERE analysis_project_id = ?",
    params: [analysisProjectId],
  });
  if (questions.length === 0 || questions.some((question) => question.status !== "approved")) {
    throw new Error("AnalysisBrief 必须由人类全部批准后才能生成 Dossier。");
  }
  const conclusionQuestionIds = new Set(research.conclusions.map((conclusion) => conclusion.researchQuestionId));
  if (questions.some((question) => !conclusionQuestionIds.has(question.research_question_id))) {
    throw new Error("每个已批准 ResearchQuestion 都必须有结论或明确弃权后才能生成 Dossier。");
  }
  if (research.conclusions.some((conclusion) => !research.falsifications.has(conclusion.id))) {
    throw new Error("每个 ResearchConclusion 都必须完成独立反证后才能生成 Dossier。");
  }
  const [units, factCoverage, threadCoverage] = await Promise.all([
    driver.query<{ analysis_unit_id: string }>({
      sql: `SELECT unit.analysis_unit_id
            FROM analysis_units unit
            INNER JOIN analysis_projects project ON project.segmentation_id = unit.segmentation_id
            WHERE project.analysis_project_id = ?`,
      params: [analysisProjectId],
    }),
    driver.query<{ analysis_unit_id: string | null; status: string }>({
      sql: `SELECT analysis_unit_id, status FROM (
              SELECT entry.analysis_unit_id, entry.status,
                     ROW_NUMBER() OVER (PARTITION BY entry.analysis_project_id, entry.module, COALESCE(entry.analysis_unit_id, '') ORDER BY entry.created_at DESC, entry.coverage_entry_id DESC) AS rn
              FROM coverage_entries entry WHERE entry.analysis_project_id = ? AND entry.module = 'fact_ledger'
            ) latest WHERE rn = 1`,
      params: [analysisProjectId],
    }),
    driver.query<{ status: string }>({
      sql: `SELECT status FROM (
              SELECT entry.status, ROW_NUMBER() OVER (PARTITION BY entry.analysis_project_id, entry.module, COALESCE(entry.analysis_unit_id, '') ORDER BY entry.created_at DESC, entry.coverage_entry_id DESC) AS rn
              FROM coverage_entries entry WHERE entry.analysis_project_id = ? AND entry.module = 'thread_graph'
            ) latest WHERE rn = 1`,
      params: [analysisProjectId],
    }),
  ]);
  if (units.length === 0) throw new Error("AnalysisProject 没有可冻结的 AnalysisUnit。");
  const completedUnits = new Set(factCoverage
    .filter((entry) => entry.analysis_unit_id && (entry.status === "complete" || entry.status === "no_pattern"))
    .map((entry) => entry.analysis_unit_id));
  if (units.some((unit) => !completedUnits.has(unit.analysis_unit_id))) {
    throw new Error("每个 AnalysisUnit 都必须有完成的 FactLedger 处置后才能生成 Dossier。");
  }
  if (!threadCoverage.some((entry) => entry.status === "complete" || entry.status === "no_pattern")) {
    throw new Error("ThreadGraph 尚未处理，不能生成 Dossier。");
  }
}

async function countAnalysisItems(driver: SqlDriver, analysisProjectId: string, kind: string): Promise<number> {
  const rows = await driver.query<{ payload_json: string }>({
    sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ?",
    params: [analysisProjectId],
  });
  return rows.reduce((count, row) => {
    const record = parseRecord(row.payload_json, "AnalysisItem payload 损坏。");
    return record.kind === kind ? count + 1 : count;
  }, 0);
}

interface StoredResearch {
  conclusions: ResearchDossierConclusion[];
  falsifications: Map<string, ResearchDossierConclusion["falsificationStatus"]>;
}

/** 从已提交的领域索引重建 Dossier 研究部分，不读取任何 SourceSpan 正文或原始模型输出。 */
async function readResearchConclusions(driver: SqlDriver, analysisProjectId: string): Promise<StoredResearch> {
  const rows = await driver.query<{ research_question_id: string | null; payload_json: string }>({
    sql: "SELECT research_question_id, payload_json FROM analysis_items WHERE analysis_project_id = ? ORDER BY created_at ASC, analysis_item_id ASC",
    params: [analysisProjectId],
  });
  const rawConclusions: Array<Omit<ResearchDossierConclusion, "falsificationStatus" | "falsificationAlternativeExplanations" | "falsificationApplicabilityLimits" | "sampleBiasNotes">> = [];
  const assessments = new Map<string, { status: ResearchDossierConclusion["falsificationStatus"]; alternativeExplanations: string[]; applicabilityLimits: string[]; sampleBiasNotes: string[] }>();
  for (const row of rows) {
    const payload = parseRecord(row.payload_json, "AnalysisItem payload 损坏。");
    if (payload.kind === "research_conclusion") {
      if (typeof row.research_question_id !== "string" || !row.research_question_id) throw new Error("ResearchConclusion 缺少 ResearchQuestion。 ");
      rawConclusions.push(parseStoredResearchConclusion(payload, row.research_question_id));
      continue;
    }
    if (payload.kind === "independent_falsification") {
      const parsed = parseStoredFalsification(payload);
      if (assessments.has(parsed.conclusionId)) throw new Error(`ResearchConclusion ${parsed.conclusionId} 存在多个独立反证结果。`);
      assessments.set(parsed.conclusionId, parsed);
    }
  }
  const falsifications = new Map<string, ResearchDossierConclusion["falsificationStatus"]>();
  const conclusions = rawConclusions.flatMap((conclusion) => {
    const assessment = assessments.get(conclusion.id);
    if (!assessment) return [];
    falsifications.set(conclusion.id, assessment.status);
    return [{
      ...conclusion,
      falsificationStatus: assessment.status,
      falsificationAlternativeExplanations: assessment.alternativeExplanations,
      falsificationApplicabilityLimits: assessment.applicabilityLimits,
      sampleBiasNotes: assessment.sampleBiasNotes,
    }];
  });
  // 未反证的结论不丢失，以便前置条件精确报错；它们以占位状态返回给检查器。
  const allConclusions = rawConclusions.map((conclusion) => conclusions.find((item) => item.id === conclusion.id) ?? {
    ...conclusion,
    falsificationStatus: "unknown" as const,
    falsificationAlternativeExplanations: [],
    falsificationApplicabilityLimits: [],
    sampleBiasNotes: [],
  });
  return { conclusions: allConclusions, falsifications };
}

function parseStoredResearchConclusion(payload: Record<string, unknown>, researchQuestionId: string): Omit<ResearchDossierConclusion, "falsificationStatus" | "falsificationAlternativeExplanations" | "falsificationApplicabilityLimits" | "sampleBiasNotes"> {
  const conclusion = payload.conclusion;
  if (!conclusion || typeof conclusion !== "object" || Array.isArray(conclusion)) throw new Error("ResearchConclusion payload 损坏。");
  const item = conclusion as Record<string, unknown>;
  if (item.researchQuestionId !== researchQuestionId) throw new Error("ResearchConclusion 与 ResearchQuestion 关联损坏。 ");
  return {
    id: readString(item.id, "ResearchConclusion.id"),
    researchQuestionId,
    conclusion: readString(item.conclusion, "ResearchConclusion.conclusion"),
    observations: readObservations(item.observations),
    evidenceSpanIds: readStringArray(item.evidenceSpanIds, "ResearchConclusion.evidenceSpanIds"),
    counterEvidenceSpanIds: readStringArray(item.counterEvidenceSpanIds, "ResearchConclusion.counterEvidenceSpanIds"),
    alternativeExplanations: readStringArray(item.alternativeExplanations, "ResearchConclusion.alternativeExplanations"),
    applicabilityBoundaries: readStringArray(item.applicabilityBoundaries, "ResearchConclusion.applicabilityBoundaries"),
    productionImplications: readStringArray(item.productionImplications, "ResearchConclusion.productionImplications"),
    coverageStatus: readString(item.coverageStatus, "ResearchConclusion.coverageStatus"),
    epistemicStatus: readString(item.epistemicStatus, "ResearchConclusion.epistemicStatus"),
  };
}

function parseStoredFalsification(payload: Record<string, unknown>): { conclusionId: string; status: ResearchDossierConclusion["falsificationStatus"]; alternativeExplanations: string[]; applicabilityLimits: string[]; sampleBiasNotes: string[] } {
  const assessment = payload.assessment;
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) throw new Error("IndependentFalsification payload 损坏。");
  const item = assessment as Record<string, unknown>;
  const status = item.status;
  if (status !== "passed" && status !== "bounded" && status !== "failed" && status !== "unknown") throw new Error("IndependentFalsification status 损坏。");
  return {
    conclusionId: readString(item.conclusionId, "IndependentFalsification.conclusionId"),
    status,
    alternativeExplanations: readStringArray(item.alternativeExplanations, "IndependentFalsification.alternativeExplanations"),
    applicabilityLimits: readStringArray(item.applicabilityLimits, "IndependentFalsification.applicabilityLimits"),
    sampleBiasNotes: readStringArray(item.sampleBiasNotes, "IndependentFalsification.sampleBiasNotes"),
  };
}

function readObservations(value: unknown): Array<{ id: string; statement: string; evidenceSpanIds: string[] }> {
  if (!Array.isArray(value)) throw new Error("ResearchConclusion.observations 损坏。");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`ResearchConclusion.observations[${index}] 损坏。`);
    const item = entry as Record<string, unknown>;
    return { id: readString(item.id, `observation[${index}].id`), statement: readString(item.statement, `observation[${index}].statement`), evidenceSpanIds: readStringArray(item.evidenceSpanIds, `observation[${index}].evidenceSpanIds`) };
  });
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 损坏。`);
  return value.map((item, index) => readString(item, `${label}[${index}]`));
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 损坏。`);
  return value;
}

async function readEvidence(driver: SqlDriver, analysisProjectId: string): Promise<ResearchDossierEvidence[]> {
  const rows = await driver.query<{
    span_id: string; source_edition_id: string; source_hash: string; exact_text_hash: string;
    start_byte: number; end_byte: number; locator_json: string;
  }>({
    sql: `SELECT DISTINCT span.span_id, span.source_edition_id, span.source_hash, span.exact_text_hash,
                 span.start_byte, span.end_byte, span.locator_json
          FROM evidence_instances evidence
          INNER JOIN analysis_items item ON item.analysis_item_id = evidence.analysis_item_id
          INNER JOIN source_spans span ON span.span_id = evidence.span_id
          WHERE item.analysis_project_id = ?
          ORDER BY span.start_byte ASC, span.span_id ASC`,
    params: [analysisProjectId],
  });
  return rows.map((row) => ({
    spanId: row.span_id,
    sourceEditionId: row.source_edition_id,
    sourceHash: row.source_hash,
    exactTextHash: row.exact_text_hash,
    startByte: row.start_byte,
    endByte: row.end_byte,
    locator: parseRecord(row.locator_json, "SourceSpan locator 损坏。"),
  }));
}

function parseDossier(value: string): ResearchDossier {
  const record = parseRecord(value, "ResearchDossier payload 损坏。");
  if (record.schemaVersion !== 1 || record.kind !== "research_dossier" || typeof record.analysisProjectId !== "string" || !Number.isInteger(record.revision) || !Number.isInteger(record.factCount) || !Number.isInteger(record.threadCount) || !Number.isInteger(record.conclusionCount) || !Number.isInteger(record.falsificationCount) || !Array.isArray(record.conclusions) || !Array.isArray(record.evidence)) {
    throw new Error("ResearchDossier payload 字段无效。");
  }
  return {
    schemaVersion: 1,
    kind: "research_dossier",
    revision: record.revision as number,
    analysisProjectId: record.analysisProjectId,
    factCount: record.factCount as number,
    threadCount: record.threadCount as number,
    conclusionCount: record.conclusionCount as number,
    falsificationCount: record.falsificationCount as number,
    conclusions: record.conclusions.map((value, index) => parseDossierConclusion(value, index)),
    evidence: record.evidence.map((value, index) => parseEvidence(value, index)),
  };
}

function parseDossierConclusion(value: unknown, index: number): ResearchDossierConclusion {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`ResearchDossier conclusions[${index}] 无效。`);
  const item = value as Record<string, unknown>;
  const status = item.falsificationStatus;
  if (status !== "passed" && status !== "bounded" && status !== "failed" && status !== "unknown") throw new Error(`ResearchDossier conclusions[${index}].falsificationStatus 无效。`);
  return {
    id: readString(item.id, `ResearchDossier conclusions[${index}].id`),
    researchQuestionId: readString(item.researchQuestionId, `ResearchDossier conclusions[${index}].researchQuestionId`),
    conclusion: readString(item.conclusion, `ResearchDossier conclusions[${index}].conclusion`),
    observations: readObservations(item.observations),
    evidenceSpanIds: readStringArray(item.evidenceSpanIds, `ResearchDossier conclusions[${index}].evidenceSpanIds`),
    counterEvidenceSpanIds: readStringArray(item.counterEvidenceSpanIds, `ResearchDossier conclusions[${index}].counterEvidenceSpanIds`),
    alternativeExplanations: readStringArray(item.alternativeExplanations, `ResearchDossier conclusions[${index}].alternativeExplanations`),
    applicabilityBoundaries: readStringArray(item.applicabilityBoundaries, `ResearchDossier conclusions[${index}].applicabilityBoundaries`),
    productionImplications: readStringArray(item.productionImplications, `ResearchDossier conclusions[${index}].productionImplications`),
    coverageStatus: readString(item.coverageStatus, `ResearchDossier conclusions[${index}].coverageStatus`),
    epistemicStatus: readString(item.epistemicStatus, `ResearchDossier conclusions[${index}].epistemicStatus`),
    falsificationStatus: status,
    falsificationAlternativeExplanations: readStringArray(item.falsificationAlternativeExplanations, `ResearchDossier conclusions[${index}].falsificationAlternativeExplanations`),
    falsificationApplicabilityLimits: readStringArray(item.falsificationApplicabilityLimits, `ResearchDossier conclusions[${index}].falsificationApplicabilityLimits`),
    sampleBiasNotes: readStringArray(item.sampleBiasNotes, `ResearchDossier conclusions[${index}].sampleBiasNotes`),
  };
}

function parseEvidence(value: unknown, index: number): ResearchDossierEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`ResearchDossier evidence[${index}] 无效。`);
  const item = value as Record<string, unknown>;
  const strings = ["spanId", "sourceEditionId", "sourceHash", "exactTextHash"] as const;
  if (strings.some((key) => typeof item[key] !== "string" || !(item[key] as string).trim()) || !Number.isInteger(item.startByte) || !Number.isInteger(item.endByte) || (item.startByte as number) < 0 || (item.endByte as number) < (item.startByte as number) || !item.locator || typeof item.locator !== "object" || Array.isArray(item.locator)) {
    throw new Error(`ResearchDossier evidence[${index}] 字段无效。`);
  }
  return {
    spanId: item.spanId as string,
    sourceEditionId: item.sourceEditionId as string,
    sourceHash: item.sourceHash as string,
    exactTextHash: item.exactTextHash as string,
    startByte: item.startByte as number,
    endByte: item.endByte as number,
    locator: item.locator as Record<string, unknown>,
  };
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
