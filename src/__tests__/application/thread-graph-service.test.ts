import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createThreadGraphService } from "@/application/thread-graph-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("V2 ThreadGraph 服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-thread-graph-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("以 FactLedger 中已验证的 span 为证据，跨两个计算单元提交为同一个可追踪线程", async () => {
    const { facts, threads, unitIds, spanIds } = await prepare();
    await facts.submit({ command: command("facts_001"), analysisProjectId: "analysis_001", analysisUnitId: unitIds[0]!, rawOutput: factOutput("fact_001", spanIds[0]!, "发现红伞") });
    await facts.submit({ command: command("facts_002"), analysisProjectId: "analysis_001", analysisUnitId: unitIds[1]!, rawOutput: factOutput("fact_002", spanIds[1]!, "红伞被带走") });

    await expect(threads.submit({
      command: command("threads_001"), analysisProjectId: "analysis_001",
      rawOutput: JSON.stringify({ threads: [{
        id: "thread_red_umbrella", kind: "object", title: "红伞的去向",
        episodes: [
          { id: "episode_001", role: "setup", rawLabel: null, summary: "红伞被发现", evidenceSpanIds: [spanIds[0]], ordinal: 1 },
          { id: "episode_002", role: "escalation", rawLabel: null, summary: "红伞被带走", evidenceSpanIds: [spanIds[1]], ordinal: 2 },
        ],
        epistemicStatus: "observed", lifecycle: "open",
      }] }),
    })).resolves.toMatchObject({ kind: "ok" });

    await expect(threads.getThreads("analysis_001")).resolves.toEqual([
      expect.objectContaining({ id: "thread_red_umbrella", title: "红伞的去向", episodes: [
        expect.objectContaining({ evidenceSpanIds: [spanIds[0]] }),
        expect.objectContaining({ evidenceSpanIds: [spanIds[1]] }),
      ] }),
    ]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM evidence_instances WHERE analysis_item_id = ?", params: ["thread:analysis_001:thread_red_umbrella"] }))
      .resolves.toEqual([{ count: 2 }]);
  });

  it("没有 FactLedger 证据的 span 无法创建线程；not_observed 允许空 episode 明确弃权", async () => {
    const { threads } = await prepare();
    await expect(threads.submit({
      command: command("threads_002"), analysisProjectId: "analysis_001",
      rawOutput: JSON.stringify({ threads: [{ id: "invalid_thread", kind: "event", title: "无效", episodes: [{ id: "episode_001", role: "setup", rawLabel: null, summary: "无效", evidenceSpanIds: ["sp99999"], ordinal: 1 }], epistemicStatus: "observed", lifecycle: "open" }] }),
    })).rejects.toThrow(/sp99999/);
    await expect(threads.submit({
      command: command("threads_003"), analysisProjectId: "analysis_001",
      rawOutput: JSON.stringify({ threads: [{ id: "no_pattern", kind: "other", title: "未观察到可连接线程", episodes: [], epistemicStatus: "not_observed", lifecycle: "ambiguous" }] }),
    })).resolves.toMatchObject({ kind: "ok" });
    await expect(threads.getThreads("analysis_001")).resolves.toEqual([expect.objectContaining({ id: "no_pattern", epistemicStatus: "not_observed", episodes: [] })]);
  });

  async function prepare() {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const text = [
      "第一章",
      `修伞匠发现一把红伞。${"雨声沿着站台边缘反复滑落。".repeat(40)}`,
      "",
      "第二章",
      `有人带走了红伞。${"远处的列车灯在水洼里摇晃。".repeat(40)}`,
      "",
      "第三章",
      `站台恢复安静。${"空广播在凌晨前停止。".repeat(40)}`,
    ].join("\n");
    await references.importText({ command: command("reference_001"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await corpus.prepare({
      command: command("corpus_001"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete",
      budget: { contextWindowTokens: 2048, safetyMarginRatio: 0.2, reservedOutputTokens: 1200, renderedSystemPromptTokens: 128, renderedSchemaTokens: 128, envelopeTokens: 64 },
    });
    const unitIds = (await corpus.getOverview("analysis_001"))!.computeUnits.map((unit) => unit.analysisUnitId);
    expect(unitIds.length).toBeGreaterThanOrEqual(2);
    const spanIds = await Promise.all(unitIds.map(async (unitId) => {
      const spans = await driver.query<{ span_id: string }>({ sql: "SELECT span_id FROM source_spans WHERE analysis_unit_id = ? ORDER BY start_byte ASC", params: [unitId] });
      return spans[0]!.span_id;
    }));
    return { facts: createAnalysisFactService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }), threads: createThreadGraphService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }), unitIds, spanIds };
  }
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}

function factOutput(id: string, spanId: string, statement: string): string {
  return JSON.stringify({ facts: [{ id, kind: "event", rawLabel: null, statement, subject: null, object: null, evidenceSpanIds: [spanId], epistemicStatus: "observed" }] });
}
