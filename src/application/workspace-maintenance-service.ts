import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { TaskRecord, TaskRunner } from "@/application/task-runner";
import type { ObjectStore } from "@/persistence/object-store";
import type { NodeWorkspaceBackupRepository, WorkspaceBackupView, WorkspaceRestoreView } from "@/persistence/node-workspace-backup";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type MaintenanceInput =
  | { schemaVersion: 1; kind: "workspace_backup"; backupId: string }
  | { schemaVersion: 1; kind: "workspace_restore"; backupId: string; restoreId: string };

export interface WorkspaceMaintenanceService {
  startBackup(input: { command: Omit<CommandEnvelope, "tool" | "args">; taskId: string; backupId: string }): Promise<CommandResult>;
  startRestore(input: { command: Omit<CommandEnvelope, "tool" | "args">; taskId: string; backupId: string; restoreId: string }): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}

/**
 * 备份与恢复均作为持久 TaskRunner 作业执行。外部宿主只能提交固定标识，
 * 不能传文件路径、SQLite 语句或 settings.json；恢复任务会由 CommandService
 * 先创建持久 confirmation，再由用户明确批准。
 */
export function createWorkspaceMaintenanceService(input: {
  commands: CommandService;
  tasks: TaskRunner;
  objects: ObjectStore;
  backups: NodeWorkspaceBackupRepository;
  hostId: string;
  now?: () => number;
}): WorkspaceMaintenanceService {
  const now = input.now ?? Date.now;

  async function start(taskId: string, maintenance: MaintenanceInput, command: Omit<CommandEnvelope, "tool" | "args">): Promise<CommandResult> {
    assertTaskId(taskId);
    const object = await input.objects.put({ content: encoder.encode(JSON.stringify(maintenance)), mediaType: "application/vnd.ainovr.workspace-maintenance-input+json" });
    return input.commands.execute({
      ...command,
      tool: maintenance.kind === "workspace_backup" ? "start_workspace_backup" : "start_workspace_restore",
      args: {
        taskId,
        resourceKey: maintenance.kind === "workspace_backup"
          ? `workspace_backup:${maintenance.backupId}`
          : `workspace_restore:${maintenance.backupId}:${maintenance.restoreId}`,
        input: object,
      },
    });
  }

  return {
    startBackup({ command, taskId, backupId }) {
      return start(taskId, { schemaVersion: 1, kind: "workspace_backup", backupId }, command);
    },

    startRestore({ command, taskId, backupId, restoreId }) {
      return start(taskId, { schemaVersion: 1, kind: "workspace_restore", backupId, restoreId }, command);
    },

    async run(taskId) {
      const claimed = await input.tasks.claim(taskId, input.hostId);
      if (!claimed.claimed) return input.tasks.get(taskId);
      let leaseLost = false;
      const heartbeat = setInterval(() => {
        void input.tasks.heartbeat(taskId, input.hostId).catch(() => { leaseLost = true; });
      }, 20_000);
      try {
        const maintenance = await readInput(input.tasks, input.objects, taskId);
        await input.tasks.checkpoint(taskId, input.hostId, { schema_version: 1, stage: maintenance.kind, backupId: maintenance.backupId }, null);
        const result = maintenance.kind === "workspace_backup"
          ? await input.backups.create({ backupId: maintenance.backupId })
          : await input.backups.restore({ backupId: maintenance.backupId, restoreId: maintenance.restoreId });
        if (leaseLost) throw new Error("工作区维护任务已失去 lease，结果不会提交。 ");
        const output = await input.objects.put({ content: encoder.encode(JSON.stringify(toOutput(result))), mediaType: "application/vnd.ainovr.workspace-maintenance-result+json" });
        const committed = await input.commands.execute({
          schemaVersion: 1,
          commandId: `complete:workspace-maintenance:${taskId}`,
          idempotencyKey: `complete:workspace-maintenance:${taskId}`,
          correlationId: `task:${taskId}`,
          actor: { kind: "internal_agent", id: input.hostId },
          tool: "complete_workspace_maintenance",
          args: { taskId, hostId: input.hostId, output },
          createdAt: now(),
        });
        if (committed.kind !== "ok") throw new Error(`工作区维护结果提交失败：${committed.kind}`);
        return input.tasks.get(taskId);
      } catch (cause) {
        const task = await input.tasks.get(taskId);
        if (task?.status === "cancel_requested") {
          await input.tasks.cancel(taskId, input.hostId).catch(() => undefined);
        } else {
          await input.tasks.fail(taskId, input.hostId, { code: "workspace_maintenance_failed", message: safeError(cause), retryable: false }).catch(() => undefined);
        }
        throw cause;
      } finally {
        clearInterval(heartbeat);
      }
    },

    getTask(taskId) {
      return input.tasks.get(taskId);
    },
  };
}

function assertTaskId(taskId: string): void {
  if (!taskId.trim()) throw new Error("taskId 必须是非空字符串。 ");
}

async function readInput(tasks: TaskRunner, objects: ObjectStore, taskId: string): Promise<MaintenanceInput> {
  const hash = await tasks.getInputObjectHash(taskId);
  if (!hash) throw new Error("工作区维护任务缺少输入对象。 ");
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(await objects.read(hash)));
  } catch {
    throw new Error("工作区维护任务输入无效。 ");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作区维护任务输入无效。 ");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.backupId !== "string" || !record.backupId.trim()) throw new Error("工作区维护任务输入无效。 ");
  if (record.kind === "workspace_backup") return { schemaVersion: 1, kind: "workspace_backup", backupId: record.backupId };
  if (record.kind === "workspace_restore" && typeof record.restoreId === "string" && record.restoreId.trim()) return { schemaVersion: 1, kind: "workspace_restore", backupId: record.backupId, restoreId: record.restoreId };
  throw new Error("工作区维护任务输入无效。 ");
}

function toOutput(result: WorkspaceBackupView | WorkspaceRestoreView): Record<string, unknown> {
  return "restoreId" in result
    ? { schemaVersion: 1, kind: "workspace_restore_result", backupId: result.backupId, restoreId: result.restoreId, objectCount: result.objectCount }
    : { schemaVersion: 1, kind: "workspace_backup_result", backupId: result.backupId, objectCount: result.objectCount, createdAt: result.createdAt };
}

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 500);
}
