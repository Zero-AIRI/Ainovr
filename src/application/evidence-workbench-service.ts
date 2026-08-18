import type { SqlDriver } from "@/persistence/sql-driver";

export interface EvidenceWorkbenchFilter {
  analysisProjectId: string;
  researchQuestionId?: string;
  conclusionId?: string;
  spanId?: string;
}

/** 可由 UI、CLI 和 MCP 安全展示的证据索引；正文仍必须经 get_source_excerpt 显式读取。 */
export interface EvidenceWorkbenchEntry {
  evidenceInstanceId: string;
  analysisItemId: string;
  itemKind: string;
  researchQuestionId: string | null;
  conclusionId: string | null;
  role: string;
  spanId: string;
  sourceEditionId: string;
  sourceHash: string;
  exactTextHash: string;
  startByte: number;
  endByte: number;
  locator: Record<string, unknown>;
}

export interface AnalysisCoverageEntry {
  coverageEntryId: string;
  analysisUnitId: string | null;
  module: string;
  status: string;
  reason: string;
  createdAt: number;
}

export interface CoverageFilter {
  analysisProjectId: string;
  module?: string;
  analysisUnitId?: string;
}

export interface EvidenceWorkbenchService {
  getEvidence(filter: EvidenceWorkbenchFilter): Promise<EvidenceWorkbenchEntry[]>;
  listCoverage(filter: CoverageFilter): Promise<AnalysisCoverageEntry[]>;
}

export interface CreateEvidenceWorkbenchServiceOptions {
  driver: SqlDriver;
}

/**
 * 证据与 Coverage 的只读 Application Service。它只返回可审计的定位索引，
 * 不读取 ObjectStore，因此不会把原文、模型原始输出或完整 Prompt 暴露为工作台数据。
 */
export function createEvidenceWorkbenchService(options: CreateEvidenceWorkbenchServiceOptions): EvidenceWorkbenchService {
  return {
    async getEvidence(filter) {
      assertNonEmpty(filter.analysisProjectId, "analysisProjectId");
      await assertProjectExists(options.driver, filter.analysisProjectId);
      const where = ["item.analysis_project_id = ?"];
      const params: Array<string> = [filter.analysisProjectId];
      if (filter.researchQuestionId !== undefined) {
        assertNonEmpty(filter.researchQuestionId, "researchQuestionId");
        where.push("item.research_question_id = ?");
        params.push(filter.researchQuestionId);
      }
      if (filter.spanId !== undefined) {
        assertNonEmpty(filter.spanId, "spanId");
        where.push("span.span_id = ?");
        params.push(filter.spanId);
      }
      const rows = await options.driver.query<RawEvidenceRow>({
        sql: `SELECT evidence.evidence_instance_id, evidence.analysis_item_id, evidence.role,
                     item.research_question_id, item.payload_json,
                     span.span_id, span.source_edition_id, span.source_hash, span.exact_text_hash,
                     span.start_byte, span.end_byte, span.locator_json
              FROM evidence_instances evidence
              INNER JOIN analysis_items item ON item.analysis_item_id = evidence.analysis_item_id
              INNER JOIN source_spans span ON span.span_id = evidence.span_id
              WHERE ${where.join(" AND ")}
              ORDER BY evidence.created_at ASC, evidence.evidence_instance_id ASC`,
        params,
      });
      const entries = rows.map(toEvidenceEntry);
      if (filter.conclusionId === undefined) return entries;
      assertNonEmpty(filter.conclusionId, "conclusionId");
      return entries.filter((entry) => entry.conclusionId === filter.conclusionId);
    },

    async listCoverage(filter) {
      assertNonEmpty(filter.analysisProjectId, "analysisProjectId");
      await assertProjectExists(options.driver, filter.analysisProjectId);
      const where = ["analysis_project_id = ?"];
      const params: Array<string> = [filter.analysisProjectId];
      if (filter.module !== undefined) {
        assertNonEmpty(filter.module, "module");
        where.push("module = ?");
        params.push(filter.module);
      }
      if (filter.analysisUnitId !== undefined) {
        assertNonEmpty(filter.analysisUnitId, "analysisUnitId");
        where.push("analysis_unit_id = ?");
        params.push(filter.analysisUnitId);
      }
      const rows = await options.driver.query<RawCoverageRow>({
        sql: `SELECT coverage_entry_id, analysis_unit_id, module, status, reason, created_at
              FROM (
                SELECT coverage_entry_id, analysis_unit_id, module, status, reason, created_at,
                       ROW_NUMBER() OVER (PARTITION BY analysis_project_id, module, COALESCE(analysis_unit_id, '') ORDER BY created_at DESC, coverage_entry_id DESC) AS rn
                FROM coverage_entries
                WHERE ${where.join(" AND ")}
              ) latest
              WHERE rn = 1
              ORDER BY created_at ASC, coverage_entry_id ASC`,
        params,
      });
      return rows.map((row) => ({
        coverageEntryId: row.coverage_entry_id,
        analysisUnitId: row.analysis_unit_id,
        module: row.module,
        status: row.status,
        reason: row.reason,
        createdAt: row.created_at,
      }));
    },
  };
}

interface RawEvidenceRow {
  evidence_instance_id: string;
  analysis_item_id: string;
  role: string;
  research_question_id: string | null;
  payload_json: string;
  span_id: string;
  source_edition_id: string;
  source_hash: string;
  exact_text_hash: string;
  start_byte: number;
  end_byte: number;
  locator_json: string;
}

interface RawCoverageRow {
  coverage_entry_id: string;
  analysis_unit_id: string | null;
  module: string;
  status: string;
  reason: string;
  created_at: number;
}

function toEvidenceEntry(row: RawEvidenceRow): EvidenceWorkbenchEntry {
  const payload = parseRecord(row.payload_json, "AnalysisItem payload 损坏。");
  return {
    evidenceInstanceId: row.evidence_instance_id,
    analysisItemId: row.analysis_item_id,
    itemKind: readKind(payload),
    researchQuestionId: row.research_question_id,
    conclusionId: readConclusionId(payload),
    role: row.role,
    spanId: row.span_id,
    sourceEditionId: row.source_edition_id,
    sourceHash: row.source_hash,
    exactTextHash: row.exact_text_hash,
    startByte: row.start_byte,
    endByte: row.end_byte,
    locator: parseRecord(row.locator_json, "SourceSpan locator 损坏。"),
  };
}

function readKind(payload: Record<string, unknown>): string {
  return typeof payload.kind === "string" && payload.kind.trim() ? payload.kind : "unknown";
}

function readConclusionId(payload: Record<string, unknown>): string | null {
  if (payload.kind === "independent_falsification") return nonEmptyString(payload.conclusionId);
  if (payload.kind !== "research_conclusion" || !payload.conclusion || typeof payload.conclusion !== "object" || Array.isArray(payload.conclusion)) return null;
  return nonEmptyString((payload.conclusion as Record<string, unknown>).id);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function assertProjectExists(driver: SqlDriver, analysisProjectId: string): Promise<void> {
  const rows = await driver.query<{ analysis_project_id: string }>({
    sql: "SELECT analysis_project_id FROM analysis_projects WHERE analysis_project_id = ?",
    params: [analysisProjectId],
  });
  if (rows.length !== 1) throw new Error("AnalysisProject 不存在。 ");
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`);
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
