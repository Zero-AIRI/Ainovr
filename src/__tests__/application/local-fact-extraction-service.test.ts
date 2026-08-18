import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createLocalFactExtractionService } from "@/application/local-fact-extraction-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("本地 FactExtractor 任务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-local-facts-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("将单元原文只写入对象化 prompt，通过 TaskRunner 调用本地模型并原子提交事实与成功状态", async () => {
    const { service, facts, unitId, caller } = await prepare([
      JSON.stringify({ facts: [{ id: "event_001", kind: "event", rawLabel: null, statement: "门后传来脚步声", subject: null, object: null, evidenceSpanIds: ["segmentation_001:sp00002"], epistemicStatus: "observed" }] }),
    ]);
    await expect(service.start({
      command: command("start_001"), taskId: "fact_task_001", analysisProjectId: "analysis_001", analysisUnitId: unitId,
      baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048,
    })).resolves.toEqual({ kind: "accepted", taskId: "fact_task_001" });

    await expect(service.run("fact_task_001")).resolves.toMatchObject({ taskId: "fact_task_001", status: "succeeded" });
    expect(caller.complete).toHaveBeenCalledTimes(1);
    const request = (caller.complete.mock.calls as unknown as Array<[{ systemPrompt: string; prompt: string }]>)[0]![0];
    expect(request.systemPrompt).toContain("可观察事实");
    expect(request.systemPrompt).toContain("不得猜测作者意图");
    expect(request.prompt).toContain("kind 为 other 时才填写 rawLabel");
    expect(request.prompt).toContain("segmentation_001:sp00002");
    expect(request.prompt).toContain("门后有脚步声");
    expect(request.prompt).toContain("最多 16 条");
    await expect(facts.getFactLedger("analysis_001", unitId)).resolves.toEqual([
      expect.objectContaining({ id: "event_001", evidenceSpanIds: ["segmentation_001:sp00002"] }),
    ]);
    await expect(driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE tool = 'start_local_fact_extraction'", params: [] }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ args_json: expect.stringContaining("门后有脚步声") })]));
  });

  it("一次修复后仍无效时记录 failed Coverage、保留原始输出并关闭任务，不写伪事实", async () => {
    const { service, unitId, caller, objects } = await prepare([
      JSON.stringify({ facts: [{ id: "bad_001", kind: "event", rawLabel: null, statement: "无效引用", subject: null, object: null, evidenceSpanIds: ["unknown_span"], epistemicStatus: "observed" }] }),
      "不是 JSON",
    ]);
    await service.start({
      command: command("start_002"), taskId: "fact_task_002", analysisProjectId: "analysis_001", analysisUnitId: unitId,
      baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048,
    });

    await expect(service.run("fact_task_002")).rejects.toThrow(/输出|spanId|JSON/);
    expect(caller.complete).toHaveBeenCalledTimes(2);
    await expect(service.getTask("fact_task_002")).resolves.toMatchObject({ status: "failed" });
    await expect(driver.query<{ status: string; reason: string; payload_json: string }>({ sql: "SELECT status, reason, payload_json FROM coverage_entries WHERE analysis_project_id = ? AND module = 'fact_ledger'", params: ["analysis_001"] }))
      .resolves.toEqual([expect.objectContaining({ status: "failed", reason: "invalid_output" })]);
    const outputs = await driver.query<{ output_object_hash: string | null }>({ sql: "SELECT output_object_hash FROM tasks WHERE task_id = ?", params: ["fact_task_002"] });
    expect(outputs[0]?.output_object_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(objects.read(outputs[0]!.output_object_hash!)).resolves.toBeInstanceOf(Uint8Array);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM analysis_items WHERE analysis_project_id = ? AND payload_json LIKE '%fact_ledger_entry%'", params: ["analysis_001"] }))
      .resolves.toEqual([{ count: 0 }]);
  });

  it("结构化本地输出因长度截断时，以更高输出预算进行唯一一次受控修复", async () => {
    const valid = JSON.stringify({ facts: [{ id: "event_length_001", kind: "event", rawLabel: null, statement: "门后有脚步声", subject: null, object: null, evidenceSpanIds: ["segmentation_001:sp00002"], epistemicStatus: "observed" }] });
    const { service, unitId, caller } = await prepare([valid]);
    caller.complete.mockImplementationOnce(async () => ({ text: "{\"facts\":[", finishReason: "length" }));
    await service.start({ command: command("start_length"), taskId: "fact_task_length", analysisProjectId: "analysis_001", analysisUnitId: unitId, baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 1024 });

    await expect(service.run("fact_task_length")).resolves.toMatchObject({ status: "succeeded" });
    expect(caller.complete).toHaveBeenCalledTimes(2);
    const second = (caller.complete.mock.calls as unknown as Array<[{ prompt: string; maxTokens: number }]>)[1]![0];
    expect(second.maxTokens).toBe(4096);
    expect(second.prompt).toContain("输出预算不足");
  });

  it("失败任务可经新命令重配置本地模型和输出预算，再使用原 taskId 安全恢复", async () => {
    const valid = JSON.stringify({ facts: [{ id: "event_reconfigured_001", kind: "event", rawLabel: null, statement: "门后有脚步声", subject: null, object: null, evidenceSpanIds: ["segmentation_001:sp00002"], epistemicStatus: "observed" }] });
    const { service, unitId, caller } = await prepare(["不是 JSON", "仍然不是 JSON", valid]);
    await service.start({ command: command("start_reconfigure"), taskId: "fact_task_reconfigure", analysisProjectId: "analysis_001", analysisUnitId: unitId, baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024 });
    await expect(service.run("fact_task_reconfigure")).rejects.toThrow(/JSON/);

    await expect(service.reconfigure({ command: command("reconfigure"), taskId: "fact_task_reconfigure", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 4096 })).resolves.toEqual({ kind: "accepted", taskId: "fact_task_reconfigure" });
    await expect(service.run("fact_task_reconfigure")).resolves.toMatchObject({ status: "succeeded", retryCount: 1 });
    const retry = (caller.complete.mock.calls as unknown as Array<[{ model: string; maxTokens: number }]>)[2]![0];
    expect(retry).toMatchObject({ model: "qwen3:8b", maxTokens: 4096 });
  });

  async function prepare(outputs: string[]) {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: command("reference_001"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "第一章\n门后有脚步声。" });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await corpus.prepare({
      command: command("corpus_001"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete",
      budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 },
    });
    const unitId = (await corpus.getOverview("analysis_001"))!.computeUnits[0]!.analysisUnitId;
    const tasks = createTaskRunner(driver, { now: () => 1_700_000_000_000 });
    const facts = createAnalysisFactService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const caller = { complete: vi.fn(async () => ({ text: outputs.shift() ?? "", finishReason: "stop" })) };
    return {
      unitId, facts, caller, objects,
      service: createLocalFactExtractionService({ driver, commands: application.commands, tasks, objects, facts, caller, hostId: "fact-test", now: () => 1_700_000_000_000 }),
    };
  }
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
