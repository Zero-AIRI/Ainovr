import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { PipelineRevisionService, PipelineStep } from "@/application/pipeline-revision-service";
import type { ModelResolver, ModelRole, ResolvedModelRoute } from "@/application/model-resolver";
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
  routeSnapshots: Partial<Record<ModelRole, ResolvedModelRoute>>;
  nodes: Array<{ stepId: string; tool: string; execution: PipelineStep["execution"]; enabled: boolean; dependsOn: string[]; config?: Record<string, unknown>; taskId: string | null; outputObjectHash: string | null; status: PipelineNodeStatus; checkpoint: Record<string, unknown> | null }>;
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
  bindTask(input: { command: Omit<CommandEnvelope, "tool" | "args">; runId: string; stepId: string; taskId: string }): Promise<CommandResult>;
  get(runId: string): Promise<PipelineRunView | null>;
  list(limit?: number): Promise<PipelineRunView[]>;
}

export function createPipelineRunService(options: { driver: SqlDriver; commands: CommandService; pipelines: PipelineRevisionService; modelResolver?: ModelResolver }): PipelineRunService {
  return {
    async start(input) {
      assertId(input.runId, "runId"); assertId(input.pipelineId, "pipelineId");
      const pipeline = (await options.pipelines.list()).find((item) => item.pipelineId === input.pipelineId);
      if (!pipeline) throw new Error("PipelineRevision 不存在。 ");
      if (pipeline.status !== "active" && pipeline.status !== "draft") throw new Error("PipelineRevision 当前不可运行。 ");
      const routeSnapshots: Partial<Record<ModelRole, ResolvedModelRoute>> = {};
      if (options.modelResolver) {
        for (const step of pipeline.steps) {
          if (!step.enabled || step.execution !== "executable") continue;
          const role = modelRoleForTool(step.tool);
          if (!role || routeSnapshots[role]) continue;
          routeSnapshots[role] = await options.modelResolver.resolve({ role, complexity: role === "fact_extractor" ? "routine" : "complex" });
        }
      }
      return options.commands.execute({ ...input.command, tool: "start_pipeline_run", args: { runId: input.runId, pipelineId: pipeline.pipelineId, pipelineRevision: pipeline.revision, projectId: input.projectId ?? null, steps: pipeline.steps, routeSnapshots } });
    },
    async completeStep(input) {
      assertId(input.runId, "runId"); assertId(input.stepId, "stepId");
      if (!input.note.trim() || input.note.length > 2_000) throw new Error("步骤复核说明必须介于 1 和 2000 个字符之间。 ");
      const run = await readRun(options.driver, input.runId);
      const target = run?.nodes.find((node) => node.stepId === input.stepId);
      if (!run || !target || target.status !== "pending") return { kind: "blocked", diagnostics: [{ code: "pipeline_step_not_pending", message: "Pipeline 步骤不存在、已完成或未处于待处理状态。" }] };
      const incomplete = target.dependsOn.filter((dependency) => run.nodes.find((node) => node.stepId === dependency)?.status !== "completed");
      if (incomplete.length > 0) return { kind: "blocked", diagnostics: [{ code: "pipeline_dependency_incomplete", message: `Pipeline 步骤仍依赖未完成节点：${incomplete.join(", ")}` }] };
      const node = await options.driver.query<{ execution: PipelineStep["execution"]; task_id: string | null; task_status: string | null }>({
        sql: `SELECT node.execution, node.task_id, task.status AS task_status
              FROM run_nodes node LEFT JOIN tasks task ON task.task_id = node.task_id
              WHERE node.run_id = ? AND node.node_id = ? AND node.status = 'pending'`,
        params: [input.runId, input.stepId],
      });
      if (node[0]?.execution === "executable" && (!node[0].task_id || node[0].task_status !== "succeeded")) {
        return { kind: "blocked", diagnostics: [{ code: "task_lineage_incomplete", message: "可执行 Pipeline 节点必须绑定并成功完成真实 Task 后才能复核。" }] };
      }
      return options.commands.execute({ ...input.command, tool: "complete_pipeline_run_step", args: { runId: input.runId, stepId: input.stepId, note: input.note.trim() } });
    },
    async bindTask(input) {
      assertId(input.runId, "runId"); assertId(input.stepId, "stepId"); assertId(input.taskId, "taskId");
      return options.commands.execute({ ...input.command, tool: "bind_pipeline_run_task", args: { runId: input.runId, stepId: input.stepId, taskId: input.taskId } });
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
    const nodes = await driver.query<{ node_id: string; execution: PipelineStep["execution"]; task_id: string | null; output_object_hash: string | null; status: PipelineNodeStatus; checkpoint_json: string | null }>({ sql: "SELECT node_id, execution, task_id, output_object_hash, status, checkpoint_json FROM run_nodes WHERE run_id = ? ORDER BY node_id ASC", params: [runId] });
    const routeSnapshots = parseRouteSnapshots(payload.routeSnapshots);
    return { runId: row.run_id, pipelineId: row.pipeline_id, pipelineRevision: row.pipeline_revision, projectId: row.project_id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, routeSnapshots, nodes: steps.map((step) => {
      const node = nodes.find((item) => item.node_id === step.id);
      return { stepId: step.id, tool: step.tool, execution: step.execution, enabled: step.enabled, dependsOn: [...step.dependsOn], ...(step.config ? { config: step.config } : {}), taskId: node?.task_id ?? null, outputObjectHash: node?.output_object_hash ?? null, status: node?.status ?? (step.enabled ? "pending" : "skipped"), checkpoint: node?.checkpoint_json ? parseRecord(node.checkpoint_json) : null };
    }) };
}

function parseStep(value: unknown): PipelineStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("冻结的 PipelineRevision 步骤损坏。 ");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.tool !== "string" || typeof item.enabled !== "boolean" || (item.execution !== "executable" && item.execution !== "agent_action" && item.execution !== "human_review")) throw new Error("冻结的 PipelineRevision 步骤损坏。 ");
  const dependsOn = item.dependsOn;
  if (!Array.isArray(dependsOn) || dependsOn.some((dependency) => typeof dependency !== "string" || !dependency.trim() || dependency === item.id || !stepsDependencyId(dependency))) throw new Error("冻结的 PipelineRun 步骤依赖损坏。 ");
  return { id: item.id, tool: item.tool, enabled: item.enabled, execution: item.execution, dependsOn: [...dependsOn] as string[], ...(item.config && typeof item.config === "object" && !Array.isArray(item.config) ? { config: item.config as Record<string, unknown> } : {}) };
}
function stepsDependencyId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function parseRecord(value: string): Record<string, unknown> { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("冻结的 PipelineRun 快照损坏。 "); return parsed as Record<string, unknown>; }
function parseRouteSnapshots(value: unknown): Partial<Record<ModelRole, ResolvedModelRoute>> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("冻结的 PipelineRun 路由快照损坏。 ");
  const result: Partial<Record<ModelRole, ResolvedModelRoute>> = {};
  for (const [role, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!["writer", "reader", "reviewer", "editor", "fact_extractor"].includes(role) || !isRoute(candidate, role as ModelRole)) throw new Error("冻结的 PipelineRun 路由快照损坏。 ");
    result[role as ModelRole] = candidate;
  }
  return result;
}
function isRoute(value: unknown, role: ModelRole): value is ResolvedModelRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = value as Record<string, unknown>;
  return route.role === role && typeof route.providerProfileId === "string" && typeof route.baseURL === "string" && typeof route.model === "string" && (route.protocol === "chat_completions" || route.protocol === "responses" || route.protocol === "ollama_native") && Number.isInteger(route.contextWindowTokens) && Number.isInteger(route.maxOutputTokens) && typeof route.safetyMarginRatio === "number" && typeof route.isCloud === "boolean" && ["never", "complex_only", "always"].includes(String(route.cloudEscalation));
}
function modelRoleForTool(tool: string): ModelRole | null {
  if (tool === "start_local_fact_extraction_batch" || tool === "start_local_fact_extraction") return "fact_extractor";
  if (tool === "start_chapter_writer_v1") return "writer";
  if (tool === "start_chapter_reader") return "reader";
  if (tool === "start_chapter_reviewer") return "reviewer";
  if (tool === "start_chapter_editor") return "editor";
  return null;
}
function assertId(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。 `); }
