import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskRunner } from "@/application/task-runner";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("TaskRunner", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-task-runner-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("以 resource_key 去重、用 lease 接管过期任务，并保存 checkpoint", async () => {
    let time = 1_700_000_000_000;
    const runner = createTaskRunner(driver, { now: () => time, leaseDurationMs: 60_000 });
    await runner.enqueue({ taskId: "task_001", resourceKey: "project:1:chapter:1", taskType: "chapter_production", inputObjectHash: null });
    await expect(runner.enqueue({ taskId: "task_duplicate", resourceKey: "project:1:chapter:1", taskType: "chapter_production", inputObjectHash: null })).rejects.toThrow();

    await expect(runner.claim("task_001", "host_a")).resolves.toEqual({ claimed: true, status: "running", leaseExpiresAt: time + 60_000 });
    time += 60_001;
    await expect(runner.claim("task_001", "host_b")).resolves.toEqual({ claimed: true, status: "running", leaseExpiresAt: time + 60_000 });
    await runner.checkpoint("task_001", "host_b", { stage: "writer", node: "writer_v1" }, null);
    await runner.succeed("task_001", "host_b", null);

    await expect(runner.get("task_001")).resolves.toEqual({
      taskId: "task_001",
      resourceKey: "project:1:chapter:1",
      taskType: "chapter_production",
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      retryCount: 0,
      checkpoints: [{ stage: "writer", node: "writer_v1" }],
      eventCursor: expect.any(Number),
    });
  });

  it("记录任务尝试和状态事件，供另一个宿主从持久游标恢复", async () => {
    const runner = createTaskRunner(driver, { now: () => 1_700_000_000_000, leaseDurationMs: 60_000 });
    await runner.enqueue({ taskId: "task_001", resourceKey: "analysis:1", taskType: "reference_analysis", inputObjectHash: null });
    await runner.claim("task_001", "host_a");
    await runner.heartbeat("task_001", "host_a");
    await runner.checkpoint("task_001", "host_a", { stage: "facts" }, null);
    await runner.succeed("task_001", "host_a", null);

    await expect(driver.query<{ host_id: string; status: string; finished_at: number | null }>({
      sql: "SELECT host_id, status, finished_at FROM task_attempts WHERE task_id = ?",
      params: ["task_001"],
    })).resolves.toEqual([{ host_id: "host_a", status: "succeeded", finished_at: 1_700_000_000_000 }]);
    await expect(driver.query<{ event_type: string }>({
      sql: "SELECT event_type FROM task_events WHERE task_id = ? ORDER BY rowid ASC",
      params: ["task_001"],
    })).resolves.toEqual([
      { event_type: "queued" },
      { event_type: "claimed" },
      { event_type: "heartbeat" },
      { event_type: "checkpoint" },
      { event_type: "succeeded" },
    ]);
    await expect(runner.get("task_001")).resolves.toMatchObject({ eventCursor: expect.any(Number) });
  });

  it("非持有者不能写 checkpoint 或完成任务", async () => {
    const runner = createTaskRunner(driver, { now: () => 1_700_000_000_000, leaseDurationMs: 60_000 });
    await runner.enqueue({ taskId: "task_001", resourceKey: "analysis:1", taskType: "reference_analysis", inputObjectHash: null });
    await runner.claim("task_001", "host_a");

    await expect(runner.checkpoint("task_001", "host_b", { stage: "facts" }, null)).rejects.toThrow(/lease/i);
    await expect(runner.succeed("task_001", "host_b", null)).rejects.toThrow(/lease/i);
  });

  it("取消、重试和 wait 都通过持久状态机而非 UI 内存完成", async () => {
    const runner = createTaskRunner(driver, { now: () => 1_700_000_000_000, leaseDurationMs: 60_000 });
    await runner.enqueue({ taskId: "task_001", resourceKey: "analysis:1", taskType: "reference_analysis", inputObjectHash: null });
    await runner.claim("task_001", "host_a");
    await runner.requestCancel("task_001");
    await runner.cancel("task_001", "host_a");

    await expect(runner.wait("task_001", 0)).resolves.toMatchObject({ status: "cancelled" });
    await runner.retry("task_001");
    await expect(runner.get("task_001")).resolves.toMatchObject({ status: "queued", retryCount: 1, leaseOwner: null });
  });

  it("没有 lease 的排队、等待确认和暂停任务也能完成取消", async () => {
    const runner = createTaskRunner(driver, { now: () => 1_700_000_000_000 });
    for (const [taskId, status] of [["queued", "queued"], ["waiting", "waiting_confirmation"], ["paused", "paused"]] as const) {
      await runner.enqueue({ taskId, resourceKey: `analysis:${taskId}`, taskType: "reference_analysis", inputObjectHash: null });
      if (status !== "queued") await driver.execute({ sql: "UPDATE tasks SET status = ? WHERE task_id = ?", params: [status, taskId] });
      await runner.requestCancel(taskId);
      await runner.cancel(taskId, "host_without_lease");
      await expect(runner.get(taskId)).resolves.toMatchObject({ status: "cancelled", leaseOwner: null });
    }
  });

  it("wait 被解构调用时仍从同一持久任务读取状态", async () => {
    const runner = createTaskRunner(driver, { now: () => 1_700_000_000_000 });
    await runner.enqueue({ taskId: "task_001", resourceKey: "analysis:1", taskType: "reference_analysis", inputObjectHash: null });
    const wait = runner.wait;

    await expect(wait("task_001", 0)).resolves.toMatchObject({ taskId: "task_001", status: "queued" });
  });
});
