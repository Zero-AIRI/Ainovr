import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import { parseFactExtractionOutput } from "@/lib/analysis/evidence-validation";
import type { FactCandidate } from "@/lib/analysis/types";
import type { ObjectStore, ObjectReference } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();

export interface SubmitAnalysisFactsInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  analysisProjectId: string;
  analysisUnitId: string;
  /** 模型原始 JSON；只会写入 ObjectStore，绝不进入命令审计。 */
  rawOutput: string;
  /** 由 TaskRunner 持有 lease 时，事实与任务完成必须落在同一 Command 事务。 */
  task?: { taskId: string; hostId: string };
}

export interface FactLedgerEntry extends FactCandidate {
  analysisUnitId: string;
}

export interface AnalysisFactService {
  submit(input: SubmitAnalysisFactsInput): Promise<CommandResult>;
  getFactLedger(analysisProjectId: string, analysisUnitId: string): Promise<FactLedgerEntry[]>;
}

export interface CreateAnalysisFactServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  now?: () => number;
}

/**
 * FactLedger 是参考分析的可观察事实层。模型原始输出保留在对象库以便审计，
 * SQLite 只保存经过严格证据校验的结构化事实、证据关系和覆盖状态。
 */
export function createAnalysisFactService(options: CreateAnalysisFactServiceOptions): AnalysisFactService {
  return {
    async submit(input) {
      assertInput(input);
      const allowedSpanIds = await readAllowedSpanIds(options.driver, input.analysisProjectId, input.analysisUnitId);
      const parsed = parseFactExtractionOutput(input.rawOutput, allowedSpanIds);
      const rawOutput = await options.objects.put({
        content: encoder.encode(input.rawOutput),
        mediaType: "application/json; charset=utf-8",
      });
      return options.commands.execute({
        ...input.command,
        tool: "commit_analysis_facts",
        args: {
          analysisProjectId: input.analysisProjectId,
          analysisUnitId: input.analysisUnitId,
          rawOutput,
          facts: parsed.facts.map(toCommandFact),
          ...(input.task ? { task: input.task } : {}),
        },
      });
    },

    async getFactLedger(analysisProjectId, analysisUnitId) {
      const rows = await options.driver.query<{ analysis_item_id: string; payload_json: string }>({
        sql: "SELECT analysis_item_id, payload_json FROM analysis_items WHERE analysis_project_id = ? ORDER BY created_at ASC, analysis_item_id ASC",
        params: [analysisProjectId],
      });
      const stored = rows.flatMap((row) => {
        const entry = parseStoredFact(row.payload_json);
        return entry?.analysisUnitId === analysisUnitId ? [{ analysisItemId: row.analysis_item_id, entry }] : [];
      });
      if (stored.length === 0) return [];
      const evidence = await options.driver.query<{ analysis_item_id: string; span_id: string }>({
        sql: `SELECT evidence.analysis_item_id, evidence.span_id
              FROM evidence_instances evidence
              INNER JOIN analysis_items item ON item.analysis_item_id = evidence.analysis_item_id
              WHERE item.analysis_project_id = ?`,
        params: [analysisProjectId],
      });
      const evidenceByItem = new Map<string, string[]>();
      for (const item of evidence) {
        const spanIds = evidenceByItem.get(item.analysis_item_id) ?? [];
        spanIds.push(item.span_id);
        evidenceByItem.set(item.analysis_item_id, spanIds);
      }
      return stored.map(({ analysisItemId, entry }) => ({
        ...entry,
        evidenceSpanIds: evidenceByItem.get(analysisItemId) ?? [],
      }));
    },
  };
}

function parseStoredFact(value: string): StoredFact | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("FactLedger payload 损坏。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("FactLedger payload 损坏。");
  const record = parsed as Record<string, unknown>;
  const fact = record.fact;
  if (record.kind !== undefined && record.kind !== "fact_ledger_entry") return null;
  if (record.schema_version !== 1 || typeof record.analysisUnitId !== "string" || !record.analysisUnitId || !fact || typeof fact !== "object" || Array.isArray(fact)) {
    throw new Error("FactLedger payload 缺少 analysisUnitId 或事实内容。");
  }
  const evidenceSpanIds = (fact as Record<string, unknown>).evidenceSpanIds;
  const allowedSpanIds = Array.isArray(evidenceSpanIds) && evidenceSpanIds.every((spanId) => typeof spanId === "string")
    ? evidenceSpanIds
    : [];
  const candidate = parseFactExtractionOutput(JSON.stringify({ facts: [fact] }), allowedSpanIds).facts[0];
  return candidate ? { ...candidate, analysisUnitId: record.analysisUnitId } : null;
}

interface StoredFact extends FactCandidate {
  analysisUnitId: string;
}

async function readAllowedSpanIds(driver: SqlDriver, analysisProjectId: string, analysisUnitId: string): Promise<string[]> {
  const units = await driver.query<{ analysis_unit_id: string; status: string }>({
    sql: `SELECT unit.analysis_unit_id, unit.status
          FROM analysis_units unit
          INNER JOIN analysis_projects project ON project.segmentation_id = unit.segmentation_id
          WHERE project.analysis_project_id = ? AND unit.analysis_unit_id = ?`,
    params: [analysisProjectId, analysisUnitId],
  });
  const unit = units[0];
  if (!unit) throw new Error("AnalysisUnit 不属于当前 AnalysisProject。");
  if (unit.status !== "prepared") throw new Error(`AnalysisUnit 当前状态不允许提交事实：${unit.status}。`);
  const spans = await driver.query<{ span_id: string }>({
    sql: "SELECT span_id FROM source_spans WHERE analysis_unit_id = ? ORDER BY start_byte ASC, span_id ASC",
    params: [analysisUnitId],
  });
  if (spans.length === 0) throw new Error("AnalysisUnit 没有可用 SourceSpan。");
  return spans.map((span) => span.span_id);
}

function assertInput(input: SubmitAnalysisFactsInput): void {
  if (!input.analysisProjectId.trim() || !input.analysisUnitId.trim()) throw new Error("analysisProjectId 和 analysisUnitId 必须是非空字符串。");
  if (!input.rawOutput.trim()) throw new Error("rawOutput 必须是非空 JSON 字符串。");
}

export interface PlannedFact {
  id: string;
  kind: FactCandidate["kind"];
  rawLabel?: string;
  statement: string;
  subject?: string;
  object?: string;
  evidenceSpanIds: string[];
  epistemicStatus: FactCandidate["epistemicStatus"];
}

/** 传给 CommandService 的事实使用显式 null，保持严格 JSON schema 的完整字段。 */
export function toCommandFact(fact: FactCandidate): Record<string, unknown> {
  return {
    id: fact.id,
    kind: fact.kind,
    rawLabel: fact.rawLabel ?? null,
    statement: fact.statement,
    subject: fact.subject ?? null,
    object: fact.object ?? null,
    evidenceSpanIds: fact.evidenceSpanIds,
    epistemicStatus: fact.epistemicStatus,
  };
}

/** 供 Command planner 复用，避免一个未校验的内部调用绕过事实字段契约。 */
export function parsePlannedFacts(value: unknown, allowedSpanIds: readonly string[]): PlannedFact[] | null {
  if (!Array.isArray(value)) return null;
  try {
    return parseFactExtractionOutput(JSON.stringify({ facts: value }), allowedSpanIds).facts;
  } catch {
    return null;
  }
}

export function objectReferenceFrom(value: unknown): ObjectReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sha256 = typeof record.sha256 === "string" ? record.sha256 : "";
  const byteLength = record.byteLength;
  const mediaType = typeof record.mediaType === "string" ? record.mediaType.trim() : "";
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(byteLength) || (byteLength as number) < 0 || !mediaType) return null;
  return { sha256, byteLength: byteLength as number, mediaType };
}
