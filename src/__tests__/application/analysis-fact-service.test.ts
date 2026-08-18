import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("V2 FactLedger 服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-analysis-facts-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("仅提交引用当前计算单元合法 SourceSpan 的可观察事实，并记录 Coverage", async () => {
    const { facts, unitId } = await prepareServices();
    await expect(facts.submit({
      command: commandBase("command_facts_001", "idem_facts_001"),
      analysisProjectId: "analysis_001",
      analysisUnitId: unitId,
      rawOutput: JSON.stringify({
        facts: [{
          id: "event_001", kind: "event", rawLabel: null, statement: "门后出现脚步声", subject: null, object: null,
          evidenceSpanIds: ["segmentation_001:sp00002"], epistemicStatus: "observed",
        }],
      }),
    })).resolves.toMatchObject({ kind: "ok" });

    await expect(facts.getFactLedger("analysis_001", unitId)).resolves.toEqual([
      expect.objectContaining({ id: "event_001", statement: "门后出现脚步声", evidenceSpanIds: ["segmentation_001:sp00002"], epistemicStatus: "observed" }),
    ]);
    await expect(driver.query<{ status: string }>({ sql: "SELECT status FROM analysis_units WHERE analysis_unit_id = ?", params: [unitId] }))
      .resolves.toEqual([{ status: "facts_complete" }]);
    await expect(driver.query<{ status: string; reason: string }>({ sql: "SELECT status, reason FROM coverage_entries WHERE analysis_project_id = ?", params: ["analysis_001"] }))
      .resolves.toEqual([{ status: "complete", reason: "used" }]);
  });

  it("无效 spanId 在提交前被拒绝，既不写事实也不写 Coverage", async () => {
    const { facts, unitId } = await prepareServices();
    await expect(facts.submit({
      command: commandBase("command_facts_002", "idem_facts_002"), analysisProjectId: "analysis_001", analysisUnitId: unitId,
      rawOutput: JSON.stringify({ facts: [{ id: "event_001", kind: "event", rawLabel: null, statement: "不可信", subject: null, object: null, evidenceSpanIds: ["unknown_span"], epistemicStatus: "observed" }] }),
    })).rejects.toThrow(/unknown_span/);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM analysis_items", params: [] })).resolves.toEqual([{ count: 0 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM coverage_entries", params: [] })).resolves.toEqual([{ count: 0 }]);
  });

  it("失败处置后允许以 no_pattern 完成，最新 Coverage 不再出现在缺口列表", async () => {
    const { application, facts, unitId } = await prepareServices();
    await driver.execute({ sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, ?, 'fact_ledger', 'failed', 'invalid_output', ?, ?)", params: ["coverage:failed-before-no-pattern", "analysis_001", unitId, '{"schema_version":1}', 1_699_999_999_999] });
    await expect(facts.submit({
      command: commandBase("command_no_pattern", "idem_no_pattern"), analysisProjectId: "analysis_001", analysisUnitId: unitId,
      rawOutput: JSON.stringify({ facts: [] }),
    })).resolves.toMatchObject({ kind: "ok" });
    const latest = await driver.query<{ status: string; reason: string }>({
      sql: "SELECT status, reason FROM coverage_entries WHERE analysis_project_id = ? AND module = 'fact_ledger' ORDER BY created_at DESC, coverage_entry_id DESC LIMIT 1",
      params: ["analysis_001"],
    });
    expect(latest).toEqual([{ status: "no_pattern", reason: "analyzed_no_signal" }]);
    expect((await application.queries.listCoverageGaps()).filter((gap) => gap.analysisProjectId === "analysis_001" && gap.module === "fact_ledger"))
      .toEqual([expect.objectContaining({ status: "no_pattern", reason: "analyzed_no_signal" })]);
    // no_pattern 是合法处置，但待处理页仍显示它，且不得继续展示已被取代的 failed。
  });

  async function prepareServices() {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: commandBase("command_reference_001", "idem_reference_001"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: ["第一章", "门后有脚步声。"].join("\n") });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await corpus.prepare({
      command: commandBase("command_corpus_001", "idem_corpus_001"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete",
      budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 },
    });
    const overview = await corpus.getOverview("analysis_001");
    return { application, facts: createAnalysisFactService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 }), unitId: overview!.computeUnits[0]!.analysisUnitId };
  }
});

function commandBase(commandId: string, idempotencyKey: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId, idempotencyKey, correlationId: `correlation:${commandId}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
