import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createLocalFactExtractionBatchService } from "@/application/local-fact-extraction-batch-service";
import type { StartLocalFactExtractionInput } from "@/application/local-fact-extraction-service";
import { createTaskRunner, type TaskRecord, type TaskStatus } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("本地 FactExtractor 批任务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-local-fact-batch-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("以一个可恢复父任务遍历全部计算单元，保留失败单元并在每个单元后 checkpoint", async () => {
    const harness = await prepare(["succeeded", "failed", "succeeded"]);
    await expect(harness.service.start({
      command: command("batch_001"), taskId: "batch_task_001", analysisProjectId: "analysis_001",
      baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024,
    })).resolves.toEqual({ kind: "accepted", taskId: "batch_task_001" });

    await expect(harness.service.run("batch_task_001")).resolves.toMatchObject({ taskId: "batch_task_001", status: "failed" });
    expect(harness.extraction.start).toHaveBeenCalledTimes(3);
    expect(harness.extraction.run).toHaveBeenCalledTimes(3);
    expect(harness.extraction.start.mock.calls.map(([input]) => input.analysisUnitId)).toEqual([
      "analysis_001:unit:00001",
      "analysis_001:unit:00002",
      "analysis_001:unit:00003",
    ]);

    const parent = await harness.tasks.get("batch_task_001");
    expect(parent?.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "local_fact_extraction_batch", nextOrdinal: 2, succeeded: 1, failed: 0 }),
      expect.objectContaining({ kind: "local_fact_extraction_batch", nextOrdinal: 4, succeeded: 2, failed: 1 }),
    ]));
    await expect(harness.tasks.get("batch_task_001")).resolves.toMatchObject({ status: "failed", retryCount: 0 });
    expect(harness.extraction.start.mock.calls[0]?.[0].command.actor).toEqual({ kind: "internal_agent", id: "batch-test" });
  });

  it("宿主在中途异常后，重试父任务时从最后 checkpoint 恢复而不重复已完成单元", async () => {
    const harness = await prepare(["succeeded", "throw", "succeeded", "succeeded"]);
    await harness.service.start({
      command: command("batch_resume"), taskId: "batch_task_resume", analysisProjectId: "analysis_001",
      baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 1024,
    });

    await expect(harness.service.run("batch_task_resume")).rejects.toThrow("模拟宿主中断");
    await expect(harness.tasks.get("batch_task_resume")).resolves.toMatchObject({ status: "failed" });
    await harness.tasks.retry("batch_task_resume");
    await expect(harness.service.run("batch_task_resume")).resolves.toMatchObject({ status: "succeeded", retryCount: 1 });

    expect(harness.extraction.start.mock.calls.map(([input]) => input.analysisUnitId)).toEqual([
      "analysis_001:unit:00001",
      "analysis_001:unit:00002",
      "analysis_001:unit:00002",
      "analysis_001:unit:00003",
    ]);
  });

  it("旧宿主 lease 到期后，新宿主从父级 checkpoint 接管，不重复已完成单元", async () => {
    const harness = await prepare(["succeeded", "succeeded"], { hostId: "replacement-host" });
    await harness.service.start({
      command: command("batch_takeover"), taskId: "batch_task_takeover", analysisProjectId: "analysis_001",
      baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024,
    });
    await expect(harness.tasks.claim("batch_task_takeover", "crashed-host")).resolves.toMatchObject({ claimed: true });
    await harness.tasks.checkpoint("batch_task_takeover", "crashed-host", {
      schema_version: 1,
      kind: "local_fact_extraction_batch",
      analysisProjectId: "analysis_001",
      nextOrdinal: 2,
      succeeded: 1,
      failed: 0,
    }, null);

    harness.advanceClock(60_001);
    await expect(harness.service.run("batch_task_takeover")).resolves.toMatchObject({ status: "succeeded" });
    expect(harness.extraction.start.mock.calls.map(([input]) => input.analysisUnitId)).toEqual([
      "analysis_001:unit:00002",
      "analysis_001:unit:00003",
    ]);
  });

  it("恢复时复用已成功的子任务，并把它计入父级 checkpoint", async () => {
    const harness = await prepare(["succeeded"]);
    await harness.service.start({ command: command("batch_child_done"), taskId: "batch_child_done", analysisProjectId: "analysis_001", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 1024 });
    await harness.tasks.claim("batch_child_done", "crashed-host");
    await harness.tasks.checkpoint("batch_child_done", "crashed-host", { schema_version: 1, kind: "local_fact_extraction_batch", analysisProjectId: "analysis_001", nextOrdinal: 2, succeeded: 1, failed: 0 }, null);
    harness.advanceClock(60_001);
    harness.extraction.getTask.mockResolvedValueOnce(childTask("batch_child_done:unit:00002", "succeeded"));
    await expect(harness.service.run("batch_child_done")).resolves.toMatchObject({ status: "succeeded" });
    expect(harness.extraction.start.mock.calls.map(([input]) => input.analysisUnitId)).toEqual(["analysis_001:unit:00003"]);
  });

  it("父任务失败后只重跑失败子单元，并在成功后清除 unresolved failure", async () => {
    const harness = await prepare(["failed", "succeeded", "succeeded", "succeeded"]);
    await harness.service.start({ command: command("batch_failed_child"), taskId: "batch_failed_child", analysisProjectId: "analysis_001", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 1024 });
    await expect(harness.service.run("batch_failed_child")).resolves.toMatchObject({ status: "failed" });
    await harness.tasks.retry("batch_failed_child");
    await expect(harness.service.run("batch_failed_child")).resolves.toMatchObject({ status: "succeeded" });
    expect(harness.extraction.start.mock.calls.map(([input]) => input.analysisUnitId)).toEqual([
      "analysis_001:unit:00001", "analysis_001:unit:00002", "analysis_001:unit:00003", "analysis_001:unit:00001",
    ]);
    const checkpoints = (await harness.tasks.get("batch_failed_child"))?.checkpoints ?? [];
    expect(checkpoints).toEqual(expect.arrayContaining([expect.objectContaining({ failed: 0, failedOrdinals: [] })]));
  });

  it("在父任务入队时冻结无 Secret 的 FactExtractor 路由，恢复时不重新解析 Provider", async () => {
    const route = {
      role: "fact_extractor" as const, providerProfileId: "provider_local", baseURL: "http://127.0.0.1:11434/v1", model: "qwen3.5:9b", protocol: "ollama_native" as const,
      contextWindowTokens: 4096, maxOutputTokens: 1024, safetyMarginRatio: 0.2, isCloud: false, cloudEscalation: "never" as const,
    };
    const modelResolver = { resolve: vi.fn(async () => route) };
    const harness = await prepare(["succeeded", "succeeded", "succeeded"], { modelResolver });
    await harness.service.start({ command: command("frozen_route"), taskId: "batch_frozen_route", analysisProjectId: "analysis_001", baseURL: "http://configured-route.invalid/v1", model: "configured-route" });
    route.model = "changed-after-start";
    await expect(harness.service.run("batch_frozen_route")).resolves.toMatchObject({ status: "succeeded" });
    expect(modelResolver.resolve).toHaveBeenCalledTimes(1);
    expect(harness.extraction.start).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: "http://127.0.0.1:11434/v1", model: "qwen3.5:9b", frozenRoute: expect.objectContaining({ model: "qwen3.5:9b", protocol: "ollama_native" }),
    }));
  });

  async function prepare(outcomes: Array<"succeeded" | "failed" | "throw">, options: { hostId?: string; modelResolver?: { resolve: ReturnType<typeof vi.fn> } } = {}) {
    let clock = 1_700_000_000_000;
    const now = () => clock;
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now });
    const objects = await createNodeObjectStore({ workspacePath });
    const tasks = createTaskRunner(driver, { now });
    const extraction = {
      start: vi.fn(async (input: StartLocalFactExtractionInput) => ({ kind: "accepted" as const, taskId: input.taskId })),
      run: vi.fn(async (taskId: string) => {
        const outcome = outcomes.shift() ?? "succeeded";
        if (outcome === "throw") throw new Error("模拟宿主中断");
        return childTask(taskId, outcome);
      }),
      cancel: vi.fn(async () => undefined),
      getTask: vi.fn(async (): Promise<TaskRecord | null> => null),
    };
    const corpus = {
      getOverview: vi.fn(async () => ({
        analysisProjectId: "analysis_001",
        sourceEditionId: "edition_001",
        segmentationId: "segmentation_001",
        sourceInputBudgetTokens: 1024,
        spanCount: 3,
        computeUnits: [
          { analysisUnitId: "analysis_001:unit:00001", ordinal: 1, startByte: 0, endByte: 10 },
          { analysisUnitId: "analysis_001:unit:00002", ordinal: 2, startByte: 10, endByte: 20 },
          { analysisUnitId: "analysis_001:unit:00003", ordinal: 3, startByte: 20, endByte: 30 },
        ],
      })),
    };
    return {
      tasks,
      extraction,
      advanceClock: (milliseconds: number) => { clock += milliseconds; },
      service: createLocalFactExtractionBatchService({
        commands: application.commands,
        tasks,
        objects,
        corpus,
        extraction,
        hostId: options.hostId ?? "batch-test",
        ...(options.modelResolver ? { modelResolver: options.modelResolver as never } : {}),
        now,
      }),
    };
  }
});

function childTask(taskId: string, status: TaskStatus): TaskRecord {
  return {
    taskId,
    resourceKey: `local_fact_extraction:${taskId}`,
    taskType: "local_fact_extraction",
    status,
    leaseOwner: null,
    leaseExpiresAt: null,
    retryCount: 0,
    checkpoints: [],
    eventCursor: 0,
  };
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return {
    schemaVersion: 1,
    commandId: `command_${id}`,
    idempotencyKey: `idem_${id}`,
    correlationId: `correlation_${id}`,
    actor: { kind: "human", id: "user_001" },
    createdAt: 1_700_000_000_000,
  };
}
