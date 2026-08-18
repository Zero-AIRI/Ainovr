import type { AnalysisCorpusService } from "@/application/analysis-corpus-service";
import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { LocalFactExtractionService } from "@/application/local-fact-extraction-service";
import type { TaskRecord, TaskRunner } from "@/application/task-runner";
import type { ObjectStore } from "@/persistence/object-store";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface StartLocalFactExtractionBatchInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  taskId: string;
  analysisProjectId: string;
  baseURL: string;
  model: string;
  maxTokens?: number;
}

export interface LocalFactExtractionBatchService {
  start(input: StartLocalFactExtractionBatchInput): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  cancel(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}

export interface CreateLocalFactExtractionBatchServiceOptions {
  commands: CommandService;
  tasks: TaskRunner;
  objects: Pick<ObjectStore, "put" | "read">;
  corpus: Pick<AnalysisCorpusService, "getOverview">;
  extraction: Pick<LocalFactExtractionService, "start" | "run" | "cancel" | "getTask">;
  hostId: string;
  now?: () => number;
}

/**
 * R7 长文本的父级编排任务。它不绕过单元 FactExtractor：每个单元仍有独立
 * resource_key、严格 span 校验和 Coverage 处置；父任务只持久化进度游标，
 * 使宿主可在任一单元边界恢复而不重新跑已处置的单元。
 */
export function createLocalFactExtractionBatchService(options: CreateLocalFactExtractionBatchServiceOptions): LocalFactExtractionBatchService {
  const now = options.now ?? Date.now;
  const activeChildren = new Map<string, string>();

  return {
    async start(input) {
      const stored = toStoredInput(input);
      const inputObject = await options.objects.put({
        content: encoder.encode(JSON.stringify(stored)),
        mediaType: "application/vnd.ainovr.local-fact-extraction-batch-input+json",
      });
      return options.commands.execute({
        ...input.command,
        tool: "start_local_fact_extraction_batch",
        args: {
          taskId: input.taskId,
          resourceKey: `local_fact_extraction_batch:${input.analysisProjectId}`,
          input: inputObject,
        },
      });
    },

    async run(taskId) {
      const claim = await options.tasks.claim(taskId, options.hostId);
      if (!claim.claimed) return options.tasks.get(taskId);
      const heartbeat = setInterval(() => {
        void options.tasks.heartbeat(taskId, options.hostId).catch(() => undefined);
      }, 20_000);
      try {
        const input = await readStoredInput(options.tasks, options.objects, taskId);
        const overview = await options.corpus.getOverview(input.analysisProjectId);
        if (!overview || overview.computeUnits.length === 0) throw new Error("AnalysisCorpus 不存在或没有可抽取计算单元。 ");
        const state = resumeState(await options.tasks.get(taskId), input.analysisProjectId, overview.computeUnits.length);

        for (const unit of overview.computeUnits) {
          if (unit.ordinal < state.nextOrdinal) continue;
          if (await cancelIfRequested(options.tasks, taskId, options.hostId)) return options.tasks.get(taskId);

          const childTaskId = childTaskIdFor(taskId, unit.ordinal);
          activeChildren.set(taskId, childTaskId);
          let child: TaskRecord | null = null;
          try {
            child = await options.extraction.getTask(childTaskId).catch(() => null);
            if (child?.status === "running" || child?.status === "queued") {
              child = await options.extraction.run(childTaskId);
            } else if (child?.status !== "succeeded" && child?.status !== "failed" && child?.status !== "cancelled") {
              const started = await options.extraction.start({
                command: childCommand(taskId, unit.ordinal, options.hostId, now()),
                taskId: childTaskId,
                analysisProjectId: input.analysisProjectId,
                analysisUnitId: unit.analysisUnitId,
                baseURL: input.baseURL,
                model: input.model,
                maxTokens: input.maxTokens,
              });
              if (started.kind !== "accepted") throw new Error(`子 FactExtractor 未接受任务：${started.kind}。`);
              child = await options.extraction.run(childTaskId);
            }
          } catch (cause) {
            child = await options.extraction.getTask(childTaskId).catch(() => null);
            if (!child || child.status !== "failed") throw cause;
          } finally {
            activeChildren.delete(taskId);
          }

          if (await cancelIfRequested(options.tasks, taskId, options.hostId)) return options.tasks.get(taskId);
          if (child?.status === "succeeded") state.succeeded += 1;
          else if (child?.status === "failed" || child?.status === "cancelled") state.failed += 1;
          else throw new Error(`子 FactExtractor 未到达终态：${child?.status ?? "missing"}。`);
          state.nextOrdinal = unit.ordinal + 1;
          await options.tasks.checkpoint(taskId, options.hostId, checkpoint(input.analysisProjectId, state), null);
        }

        if (await cancelIfRequested(options.tasks, taskId, options.hostId)) return options.tasks.get(taskId);
        const summary = await options.objects.put({
          content: encoder.encode(JSON.stringify({
            schema_version: 1,
            kind: "local_fact_extraction_batch_summary",
            taskId,
            analysisProjectId: input.analysisProjectId,
            total: overview.computeUnits.length,
            succeeded: state.succeeded,
            failed: state.failed,
            completedAt: now(),
          })),
          mediaType: "application/vnd.ainovr.local-fact-extraction-batch-summary+json",
        });
        const completed = await options.commands.execute({
          ...completionCommand(taskId, options.hostId, now()),
          tool: "complete_local_fact_extraction_batch",
          args: { taskId, hostId: options.hostId, output: summary },
        });
        if (completed.kind !== "ok") throw new Error(`本地 FactExtractor 批任务无法提交完成结果：${completed.kind}。`);
        return options.tasks.get(taskId);
      } catch (cause) {
        const task = await options.tasks.get(taskId);
        if (task?.status === "cancel_requested") {
          await options.tasks.cancel(taskId, options.hostId).catch(() => undefined);
        } else if (task?.status === "running") {
          await options.tasks.fail(taskId, options.hostId, {
            code: "local_fact_extraction_batch_failed",
            message: safeError(cause),
            retryable: true,
          }).catch(() => undefined);
        }
        throw cause;
      } finally {
        clearInterval(heartbeat);
        activeChildren.delete(taskId);
      }
    },

    async cancel(taskId) {
      await options.tasks.requestCancel(taskId);
      const childTaskId = activeChildren.get(taskId);
      if (childTaskId) await options.extraction.cancel(childTaskId).catch(() => undefined);
    },

    getTask(taskId) {
      return options.tasks.get(taskId);
    },
  };
}

interface StoredInput {
  schema_version: 1;
  taskId: string;
  analysisProjectId: string;
  baseURL: string;
  model: string;
  maxTokens: number;
}

interface BatchState {
  nextOrdinal: number;
  succeeded: number;
  failed: number;
}

function toStoredInput(input: StartLocalFactExtractionBatchInput): StoredInput {
  for (const [key, value] of [["taskId", input.taskId], ["analysisProjectId", input.analysisProjectId], ["baseURL", input.baseURL], ["model", input.model]] as const) {
    if (!value.trim()) throw new Error(`${key} 必须是非空字符串。 `);
  }
  const maxTokens = input.maxTokens ?? 1024;
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 16_384) throw new Error("maxTokens 必须介于 256 和 16384。 ");
  return { schema_version: 1, taskId: input.taskId, analysisProjectId: input.analysisProjectId, baseURL: input.baseURL, model: input.model, maxTokens };
}

async function readStoredInput(tasks: TaskRunner, objects: Pick<ObjectStore, "read">, taskId: string): Promise<StoredInput> {
  const hash = await tasks.getInputObjectHash(taskId);
  if (!hash) throw new Error("本地 FactExtractor 批任务缺少输入对象。 ");
  const parsed: unknown = JSON.parse(decoder.decode(await objects.read(hash)));
  if (!isStoredInput(parsed)) throw new Error("本地 FactExtractor 批任务输入无效。 ");
  return parsed;
}

function isStoredInput(value: unknown): value is StoredInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema_version === 1
    && ["taskId", "analysisProjectId", "baseURL", "model"].every((key) => typeof record[key] === "string" && (record[key] as string).trim())
    && Number.isInteger(record.maxTokens) && Number(record.maxTokens) >= 256 && Number(record.maxTokens) <= 16_384;
}

function resumeState(task: TaskRecord | null, analysisProjectId: string, total: number): BatchState {
  const states = (task?.checkpoints ?? [])
    .map((value) => value as Partial<Record<string, unknown>>)
    .filter((value) => value.schema_version === 1 && value.kind === "local_fact_extraction_batch" && value.analysisProjectId === analysisProjectId)
    .map((value) => ({
      nextOrdinal: integer(value.nextOrdinal),
      succeeded: integer(value.succeeded),
      failed: integer(value.failed),
    }))
    .filter((value): value is BatchState => value.nextOrdinal !== null && value.succeeded !== null && value.failed !== null && value.nextOrdinal >= 1 && value.nextOrdinal <= total + 1);
  if (states.length === 0) return { nextOrdinal: 1, succeeded: 0, failed: 0 };
  return states.reduce((latest, candidate) => candidate.nextOrdinal > latest.nextOrdinal ? candidate : latest);
}

function integer(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function checkpoint(analysisProjectId: string, state: BatchState): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: "local_fact_extraction_batch",
    analysisProjectId,
    nextOrdinal: state.nextOrdinal,
    succeeded: state.succeeded,
    failed: state.failed,
  };
}

function childTaskIdFor(parentTaskId: string, ordinal: number): string {
  return `${parentTaskId}:unit:${String(ordinal).padStart(5, "0")}`;
}

function childCommand(parentTaskId: string, ordinal: number, hostId: string, createdAt: number): Omit<CommandEnvelope, "tool" | "args"> {
  const suffix = `${parentTaskId}:unit:${String(ordinal).padStart(5, "0")}`;
  return {
    schemaVersion: 1,
    commandId: `batch-start:${suffix}`,
    idempotencyKey: `batch-start:${suffix}`,
    correlationId: `batch:${parentTaskId}`,
    actor: { kind: "internal_agent", id: hostId },
    createdAt,
  };
}

function completionCommand(taskId: string, hostId: string, createdAt: number): Omit<CommandEnvelope, "tool" | "args"> {
  return {
    schemaVersion: 1,
    commandId: `batch-complete:${taskId}`,
    idempotencyKey: `batch-complete:${taskId}`,
    correlationId: `batch:${taskId}`,
    actor: { kind: "internal_agent", id: hostId },
    createdAt,
  };
}

async function cancelIfRequested(tasks: TaskRunner, taskId: string, hostId: string): Promise<boolean> {
  const task = await tasks.get(taskId);
  if (task?.status !== "cancel_requested") return false;
  await tasks.cancel(taskId, hostId);
  return true;
}

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 500);
}
