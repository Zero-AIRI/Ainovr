import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createStructuralReadingMapService } from "@/application/structural-reading-map-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("结构化 ReadingMap 服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-reading-map-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("从 AnalysisCorpus 创建可回读的结构化地图，并为每个计算单元写覆盖处置", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: command("import_001"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "第一章\n门后有脚步声。\n\n第二章\n雨停了。" });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await corpus.prepare({
      command: command("corpus_001"), analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete",
      budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 },
    });
    const source = await driver.query<{ normalized_object_hash: string }>({ sql: "SELECT normalized_object_hash FROM source_editions WHERE source_edition_id = ?", params: ["edition_001"] });
    const prefixBytes = new TextEncoder().encode("第一章\n门后有脚步声。");
    await corpus.prepare({
      command: command("corpus_002"), analysisProjectId: "analysis_002", segmentationId: "segmentation_002", sourceEditionId: "edition_001", boundary: "fragment",
      byteRange: { startByte: 0, endByte: prefixBytes.byteLength },
      budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 },
    });
    const maps = createStructuralReadingMapService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });

    await expect(maps.create({ command: command("reading_map_001"), analysisProjectId: "analysis_001" })).resolves.toMatchObject({ kind: "ok" });
    await expect(maps.get("analysis_001")).resolves.toEqual(expect.objectContaining({
      kind: "structural_reading_map", totalUnits: 1, totalSpans: 4,
      units: [expect.objectContaining({ analysisUnitId: "segmentation_001:unit:00001", spanCount: 4 })],
    }));
    await expect(driver.query<{ status: string; reason: string }>({ sql: "SELECT status, reason FROM coverage_entries WHERE analysis_project_id = ? AND module = 'reading_map'", params: ["analysis_001"] }))
      .resolves.toEqual([{ status: "complete", reason: "structural_reading_map" }]);
    await expect(driver.query<{ payload_json: string }>({ sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ?", params: ["analysis_001"] }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ payload_json: expect.stringContaining("门后有脚步声") })]));
    expect(source[0]?.normalized_object_hash).toEqual(expect.any(String));
  });
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
