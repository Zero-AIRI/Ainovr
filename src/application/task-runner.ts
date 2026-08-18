import type { SqlDriver } from "@/persistence/sql-driver";

export type TaskStatus = "queued" | "running" | "waiting_confirmation" | "paused" | "succeeded" | "failed" | "cancel_requested" | "cancelled";

export interface CreateTaskRunnerOptions {
  now?: () => number;
  leaseDurationMs?: number;
}

export interface EnqueueTaskInput {
  taskId: string;
  resourceKey: string;
  taskType: string;
  inputObjectHash: string | null;
}

export interface TaskRecord {
  taskId: string;
  resourceKey: string;
  taskType: string;
  status: TaskStatus;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  retryCount: number;
  checkpoints: Record<string, unknown>[];
  /** SQLite task_events 的单调 rowid；wait 返回它以便宿主继续拉取进度。 */
  eventCursor: number;
}

export interface TaskRunner {
  enqueue(input: EnqueueTaskInput): Promise<void>;
  claim(taskId: string, hostId: string): Promise<{ claimed: boolean; status: TaskStatus; leaseExpiresAt: number | null }>;
  heartbeat(taskId: string, hostId: string): Promise<number>;
  checkpoint(taskId: string, hostId: string, cursor: Record<string, unknown>, outputObjectHash: string | null): Promise<void>;
  succeed(taskId: string, hostId: string, outputObjectHash: string | null): Promise<void>;
  fail(taskId: string, hostId: string, error: { code: string; message: string; retryable: boolean }): Promise<void>;
  requestCancel(taskId: string): Promise<void>;
  cancel(taskId: string, hostId: string): Promise<void>;
  retry(taskId: string): Promise<void>;
  wait(taskId: string, timeoutMs: number): Promise<TaskRecord>;
  get(taskId: string): Promise<TaskRecord | null>;
  getInputObjectHash(taskId: string): Promise<string | null>;
}

/**
 * 持久任务状态机。它不执行 LLM；宿主在 claim 后自行调用工作流，并在每个语义单元 checkpoint。
 */
export function createTaskRunner(driver: SqlDriver, options: CreateTaskRunnerOptions = {}): TaskRunner {
  const now = options.now ?? Date.now;
  const leaseDurationMs = options.leaseDurationMs ?? 60_000;

  async function getTask(taskId: string): Promise<TaskRecord | null> {
    const tasks = await driver.query<{
      task_id: string;
      resource_key: string;
      task_type: string;
      status: TaskStatus;
      lease_owner: string | null;
      lease_expires_at: number | null;
      retry_count: number;
    }>({
      sql: "SELECT task_id, resource_key, task_type, status, lease_owner, lease_expires_at, retry_count FROM tasks WHERE task_id = ?",
      params: [taskId],
    });
    const task = tasks[0];
    if (!task) return null;
    const checkpoints = await driver.query<{ cursor_json: string }>({
      sql: "SELECT cursor_json FROM task_checkpoints WHERE task_id = ? ORDER BY created_at ASC, checkpoint_id ASC",
      params: [taskId],
    });
    const eventCursor = await driver.query<{ cursor: number }>({
      sql: "SELECT COALESCE(MAX(rowid), 0) AS cursor FROM task_events WHERE task_id = ?",
      params: [taskId],
    });
    return {
      taskId: task.task_id,
      resourceKey: task.resource_key,
      taskType: task.task_type,
      status: task.status,
      leaseOwner: task.lease_owner,
      leaseExpiresAt: task.lease_expires_at,
      retryCount: task.retry_count,
      checkpoints: checkpoints.map((checkpoint) => JSON.parse(checkpoint.cursor_json) as Record<string, unknown>),
      eventCursor: eventCursor[0]?.cursor ?? 0,
    };
  }

  return {
    async enqueue(input): Promise<void> {
      const createdAt = now();
      await driver.transaction([
        {
          sql: `
          INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at)
          VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
        `,
          params: [input.taskId, input.resourceKey, input.taskType, input.inputObjectHash, null, null, null, 0, createdAt, createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        taskEventStep(input.taskId, "queued", { schema_version: 1, taskType: input.taskType }, createdAt),
      ]);
    },

    async claim(taskId, hostId) {
      const claimedAt = now();
      const leaseExpiresAt = claimedAt + leaseDurationMs;
      const attemptId = taskUuid();
      const eventId = taskUuid();
      // A host may die after a cancellation request.  A later claimant must
      // converge the task to cancelled instead of reviving it as running.
      const cancellation = await driver.transaction([
        {
          sql: "UPDATE tasks SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE task_id = ? AND status = 'cancel_requested' AND (lease_expires_at IS NULL OR lease_expires_at < ?)",
          params: [claimedAt, taskId, claimedAt],
          expectAffectedRows: { min: 0, max: 1 },
        },
      ]);
      if (cancellation.steps[0].rowsAffected === 1) {
        await driver.transaction([
          { sql: "UPDATE task_attempts SET status = 'cancelled', finished_at = ?, error_json = NULL WHERE task_id = ? AND status = 'running'", params: [claimedAt, taskId], expectAffectedRows: { min: 0 } },
          taskEventStep(taskId, "cancelled", { schema_version: 1, reason: "expired_cancel_request" }, claimedAt),
        ]);
        return { claimed: false, status: "cancelled" as TaskStatus, leaseExpiresAt: null };
      }
      const transaction = await driver.transaction([
        {
          sql: `
          UPDATE tasks
          SET status = 'running', lease_owner = ?, lease_expires_at = ?, updated_at = ?
          WHERE task_id = ?
            AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))
        `,
          params: [hostId, leaseExpiresAt, claimedAt, taskId, claimedAt],
        },
        {
          sql: "UPDATE task_attempts SET status = 'abandoned', finished_at = ? WHERE task_id = ? AND status = 'running' AND host_id <> ? AND EXISTS (SELECT 1 FROM tasks WHERE task_id = ? AND lease_owner = ? AND lease_expires_at = ?)",
          params: [claimedAt, taskId, hostId, taskId, hostId, leaseExpiresAt],
        },
        {
          sql: "INSERT INTO task_attempts (attempt_id, task_id, host_id, status, started_at, finished_at, error_json) SELECT ?, ?, ?, 'running', ?, NULL, NULL WHERE EXISTS (SELECT 1 FROM tasks WHERE task_id = ? AND lease_owner = ? AND lease_expires_at = ?)",
          params: [attemptId, taskId, hostId, claimedAt, taskId, hostId, leaseExpiresAt],
        },
        {
          sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) SELECT ?, ?, 'claimed', ?, ? WHERE EXISTS (SELECT 1 FROM task_attempts WHERE attempt_id = ?)",
          params: [eventId, taskId, JSON.stringify({ schema_version: 1, hostId, leaseExpiresAt }), claimedAt, attemptId],
        },
      ]);
      const rows = await driver.query<{ status: TaskStatus; lease_expires_at: number | null }>({
        sql: "SELECT status, lease_expires_at FROM tasks WHERE task_id = ?",
        params: [taskId],
      });
      const task = rows[0];
      if (!task) throw new Error(`Task not found: ${taskId}`);
      return { claimed: transaction.steps[0].rowsAffected === 1, status: task.status, leaseExpiresAt: task.lease_expires_at };
    },

    async heartbeat(taskId, hostId): Promise<number> {
      const heartbeatAt = now();
      const leaseExpiresAt = heartbeatAt + leaseDurationMs;
      await driver.transaction([
        {
          sql: "UPDATE tasks SET lease_expires_at = ?, updated_at = ? WHERE task_id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at >= ?",
          params: [leaseExpiresAt, heartbeatAt, taskId, hostId, heartbeatAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        taskEventStep(taskId, "heartbeat", { schema_version: 1, hostId, leaseExpiresAt }, heartbeatAt),
      ]).catch(() => { throw new Error("Task lease is not held by this host."); });
      return leaseExpiresAt;
    },

    async checkpoint(taskId, hostId, cursor, outputObjectHash): Promise<void> {
      const checkpointAt = now();
      const checkpointId = taskUuid();
      await driver.transaction([
        {
          sql: "UPDATE tasks SET updated_at = ? WHERE task_id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at >= ?",
          params: [checkpointAt, taskId, hostId, checkpointAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "INSERT INTO task_checkpoints (checkpoint_id, task_id, cursor_json, output_object_hash, created_at) VALUES (?, ?, ?, ?, ?)",
          params: [checkpointId, taskId, JSON.stringify(cursor), outputObjectHash, checkpointAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        taskEventStep(taskId, "checkpoint", { schema_version: 1, checkpointId }, checkpointAt),
      ]).catch(() => { throw new Error("Task lease is not held by this host."); });
    },

    async succeed(taskId, hostId, outputObjectHash): Promise<void> {
      const completedAt = now();
      await driver.transaction([
        {
          sql: `
          UPDATE tasks
          SET status = 'succeeded', output_object_hash = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE task_id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at >= ?
        `,
          params: [outputObjectHash, completedAt, taskId, hostId, completedAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        closeAttemptStep(taskId, hostId, "succeeded", null, completedAt),
        taskEventStep(taskId, "succeeded", { schema_version: 1, hostId }, completedAt),
      ]).catch(() => { throw new Error("Task lease is not held by this host."); });
    },

    async fail(taskId, hostId, error): Promise<void> {
      const failedAt = now();
      await driver.transaction([
        {
          sql: "UPDATE tasks SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE task_id = ? AND status = 'running' AND lease_owner = ?",
          params: [failedAt, taskId, hostId],
          expectAffectedRows: { min: 1, max: 1 },
        },
        closeAttemptStep(taskId, hostId, "failed", error, failedAt),
        taskEventStep(taskId, "failed", { schema_version: 1, code: error.code, message: error.message, retryable: error.retryable }, failedAt),
      ]).catch(() => { throw new Error("Task lease is not held by this host."); });
    },

    async requestCancel(taskId): Promise<void> {
      const cancelledAt = now();
      await driver.transaction([
        {
          sql: "UPDATE tasks SET status = 'cancel_requested', updated_at = ? WHERE task_id = ? AND status IN ('queued', 'running', 'waiting_confirmation', 'paused')",
          params: [cancelledAt, taskId],
          expectAffectedRows: { min: 1, max: 1 },
        },
        taskEventStep(taskId, "cancel_requested", { schema_version: 1 }, cancelledAt),
      ]).catch(() => { throw new Error(`Task cannot be cancelled: ${taskId}`); });
    },

    async cancel(taskId, hostId): Promise<void> {
      const cancelledAt = now();
      await driver.transaction([
        {
          sql: "UPDATE tasks SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE task_id = ? AND status = 'cancel_requested' AND (lease_owner = ? OR lease_owner IS NULL)",
          params: [cancelledAt, taskId, hostId],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "UPDATE task_attempts SET status = 'cancelled', finished_at = ?, error_json = NULL WHERE task_id = ? AND host_id = ? AND status = 'running'",
          params: [cancelledAt, taskId, hostId],
          expectAffectedRows: { min: 0, max: 1 },
        },
        taskEventStep(taskId, "cancelled", { schema_version: 1, hostId }, cancelledAt),
      ]).catch(() => { throw new Error("Task lease is not held by this host."); });
    },

    async retry(taskId): Promise<void> {
      const retriedAt = now();
      await driver.transaction([
        {
          sql: "UPDATE tasks SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, output_object_hash = NULL, retry_count = retry_count + 1, updated_at = ? WHERE task_id = ? AND status IN ('failed', 'cancelled')",
          params: [retriedAt, taskId],
          expectAffectedRows: { min: 1, max: 1 },
        },
        taskEventStep(taskId, "retried", { schema_version: 1 }, retriedAt),
      ]).catch(() => { throw new Error(`Task cannot be retried: ${taskId}`); });
    },

    async wait(taskId, timeoutMs) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000) throw new Error("wait timeout must be between 0 and 30000 ms.");
      const deadline = Date.now() + timeoutMs;
      while (true) {
        const task = await getTask(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);
        if (isTerminal(task.status) || Date.now() >= deadline) return task;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
      }
    },

    get: getTask,

    async getInputObjectHash(taskId) {
      const rows = await driver.query<{ input_object_hash: string | null }>({
        sql: "SELECT input_object_hash FROM tasks WHERE task_id = ?",
        params: [taskId],
      });
      if (!rows[0]) throw new Error(`Task not found: ${taskId}`);
      return rows[0].input_object_hash;
    },
  };
}

function isTerminal(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function taskEventStep(taskId: string, eventType: string, payload: Record<string, unknown>, createdAt: number) {
  return {
    sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
    params: [taskUuid(), taskId, eventType, JSON.stringify(payload), createdAt],
    expectAffectedRows: { min: 1, max: 1 },
  };
}

/** Node 24 与 Tauri WebView 均提供同一 Web Crypto UUID 能力，避免 Application Service 依赖 Node 内置模块。 */
function taskUuid(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("当前宿主不支持安全任务 UUID。 ");
  return globalThis.crypto.randomUUID();
}

function closeAttemptStep(
  taskId: string,
  hostId: string,
  status: "succeeded" | "failed" | "cancelled",
  error: { code: string; message: string; retryable: boolean } | null,
  finishedAt: number,
) {
  return {
    sql: "UPDATE task_attempts SET status = ?, finished_at = ?, error_json = ? WHERE task_id = ? AND host_id = ? AND status = 'running'",
    params: [status, finishedAt, error ? JSON.stringify({ schema_version: 1, ...error }) : null, taskId, hostId],
    expectAffectedRows: { min: 1, max: 1 },
  };
}
