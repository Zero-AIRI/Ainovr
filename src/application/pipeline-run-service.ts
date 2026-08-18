import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { PipelineRevisionService, PipelineStep } from "@/application/pipeline-revision-service";
import type { SqlDriver } from "@/persistence/sql-driver";

export type PipelineRunStatus = "waiting_human" | "completed";
export type PipelineNodeStatus = "pending" | "completed" | "skipped";

export interface PipelineRunView {
  runId: string;
  pipelineId: string;
  pipelineRevision: number;
  projectId: string | null;
  status: PipelineRunStatus;
  createdAt: number;
  updatedAt: number;
  nodes: Array<{ stepId: string; tool: string; enabled: boolean; config?: Record<string, unknown>; status: PipelineNodeStatus; checkpoint: Record<string, unknown> | null }>;
}

/**
 * A persisted human-in-the-loop runner for a frozen PipelineRevision.  It
 * intentionally does not deserialize a pipeline step into a raw command:
 * callers still invoke the named domain service for work, then record its
 * reviewed completion here. This prevents the old arbitrary-batch escape
 * hatch while preserving an auditable rerunnable sequence.
 */
export interface PipelineRunService {
  start(input: { command: Omit<CommandEnvelope, "tool" | "args">; runId: string; pipelineId: string; projectId?: string | null }): Promise<CommandResult>;
  completeStep(input: { command: Omit<CommandEnvelope, "tool" | "args">; runId: string; stepId: string; note: string }): Promise<CommandResult>;
  get(runId: string): Promise<PipelineRunView | null>;
  list(limit?: number): Promise<PipelineRunView[]>;
}

export function createPipelineRunService(options: { driver: SqlDriver; commands: CommandService; pipelines: PipelineRevisionService }): PipelineRunService {
  return {
    async start(input) {
      assertId(input.runId, "runId"); assertId(input.pipelineId, "pipelineId");
      const pipeline = (await options.pipelines.list()).find((item) => item.pipelineId === input.pipelineId);
      if (!pipeline) throw new Error("PipelineRevision 不存在。 ");
      if (pipeline.status !== "active" && pipeline.status !== "draft") throw new Error("PipelineRevision 当前不可运行。 ");
      return options.commands.execute({ ...input.command, tool: "start_pipeline_run", args: { runId: input.runId, pipelineId: pipeline.pipelineId, pipelineRevision: pipeline.revision, projectId: input.projectId ?? null, steps: pipeline.steps } });
    },
    async completeStep(input) {
      assertId(input.runId, "runId"); assertId(input.stepId, "stepId");
      if (!input.note.trim() || input.note.length > 2_000) throw new Error("步骤复核说明必须介于 1 和 2000 个字符之间。 ");
      return options.commands.execute({ ...input.command, tool: "complete_pipeline_run_step", args: { runId: input.runId, stepId: input.stepId, note: input.note.trim() } });
    },
    async get(runId) { assertId(runId, "runId"); return readRun(options.driver, runId); },
    async list(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("PipelineRun limit 必须介于 1 和 100。 ");
      const rows = await options.driver.query<{ run_id: string }>({ sql: "SELECT run_id FROM runs WHERE status IN ('waiting_human', 'completed') ORDER BY updated_at DESC, run_id ASC LIMIT ?", params: [limit] });
      return (await Promise.all(rows.map((row) => readRun(options.driver, row.run_id)))).filter((run): run is PipelineRunView => run !== null);
    },
  };
}

async function readRun(driver: SqlDriver, runId: string): Promise<PipelineRunView | null> {
  const rows = await driver.query<{ run_id: string; pipeline_id: string; pipeline_revision: number; project_id: string | null; status: PipelineRunStatus; created_at: number; updated_at: number; payload_json: string }>({
    sql: `SELECT run.run_id, snapshot.pipeline_id, snapshot.pipeline_revision, run.project_id, run.status, run.created_at, run.updated_at, snapshot.payload_json
          FROM runs run INNER JOIN run_snapshots snapshot ON snapshot.snapshot_id = run.snapshot_id WHERE run.run_id = ?`, params: [runId],
  });
  const row = rows[0]; if (!row) return null;
  const payload = parseRecord(row.payload_json);
  const steps = Array.isArray(payload.steps) ? payload.steps.map(parseStep) : [];
  const nodes = await driver.query<{ node_id: string; status: PipelineNodeStatus; checkpoint_json: string | null }>({ sql: "SELECT node_id, status, checkpoint_json FROM run_nodes WHERE run_id = ? ORDER BY node_id ASC", params: [runId] });
  return { runId: row.run_id, pipelineId: row.pipeline_id, pipelineRevision: row.pipeline_revision, projectId: row.project_id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, nodes: steps.map((step) => {
    const node = nodes.find((item) => item.node_id === step.id);
    return { stepId: step.id, tool: step.tool, enabled: step.enabled, ...(step.config ? { config: step.config } : {}), status: node?.status ?? (step.enabled ? "pending" : "skipped"), checkpoint: node?.checkpoint_json ? parseRecord(node.checkpoint_json) : null };
  }) };
}

function parseStep(value: unknown): PipelineStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("冻结的 PipelineRevision 步骤损坏。 ");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.tool !== "string" || typeof item.enabled !== "boolean") throw new Error("冻结的 PipelineRevision 步骤损坏。 ");
  return { id: item.id, tool: item.tool, enabled: item.enabled, ...(item.config && typeof item.config === "object" && !Array.isArray(item.config) ? { config: item.config as Record<string, unknown> } : {}) };
}
function parseRecord(value: string): Record<string, unknown> { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("冻结的 PipelineRun 快照损坏。 "); return parsed as Record<string, unknown>; }
function assertId(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。 `); }
