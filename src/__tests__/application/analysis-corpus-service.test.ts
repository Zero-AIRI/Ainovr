import { createHash } from "node:crypto";
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

describe("V2 AnalysisCorpus 服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-analysis-corpus-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("使用动态预算建计算单元，并把每个 SourceSpan 保存为可复算的 UTF-8 区间", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: commandBase("command_reference_001", "idem_reference_001"), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: ["第一章 起雾", "海面很暗。", "第二章 回声", "门后有脚步。"].join("\n") });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });

    await expect(corpus.prepare({
      command: commandBase("command_corpus_001", "idem_corpus_001"),
      analysisProjectId: "analysis_001",
      segmentationId: "segmentation_001",
      sourceEditionId: "edition_001",
      boundary: "complete",
      budget: {
        contextWindowTokens: 30,
        safetyMarginRatio: 0.1,
        reservedOutputTokens: 8,
        renderedSystemPromptTokens: 4,
        renderedSchemaTokens: 4,
        envelopeTokens: 4,
      },
    })).resolves.toMatchObject({ kind: "ok", resourceRefs: expect.arrayContaining([{ type: "analysis_project", id: "analysis_001" }]) });

    const overview = await corpus.getOverview("analysis_001");
    expect(overview).toMatchObject({
      analysisProjectId: "analysis_001",
      sourceEditionId: "edition_001",
      sourceInputBudgetTokens: 7,
      spanCount: 4,
    });
    expect(overview?.computeUnits.length).toBeGreaterThan(1);
    const span = await corpus.getSourceSpan("segmentation_001:sp00002");
    expect(span).toMatchObject({ sourceEditionId: "edition_001", text: "海面很暗。" });
    expect(createHash("sha256").update(span?.text ?? "").digest("hex")).toBe(span?.exactTextHash);
    expect(span?.startByte).toBeGreaterThan(0);
  });

  it("可以对同一完整 SourceEdition 冻结仅覆盖指定卷的字节范围，仍用原版字节区间取证", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const text = ["导言", "第一卷 起航", "雨落在码头。", "第二卷 返航", "潮水淹没旧路。"].join("\n");
    await references.importText({ command: commandBase("command_reference_range", "idem_reference_range"), referenceWorkId: "reference_range", sourceEditionId: "edition_range", title: "完整参考", text });
    const startByte = new TextEncoder().encode("导言\n").byteLength;
    const endByte = new TextEncoder().encode("导言\n第一卷 起航\n雨落在码头。\n").byteLength;
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });

    await expect(corpus.prepare({
      command: commandBase("command_corpus_range", "idem_corpus_range"), analysisProjectId: "analysis_range", segmentationId: "segmentation_range", sourceEditionId: "edition_range", boundary: "volume",
      byteRange: { startByte, endByte },
      budget: { contextWindowTokens: 64, safetyMarginRatio: 0.1, reservedOutputTokens: 8, renderedSystemPromptTokens: 4, renderedSchemaTokens: 4, envelopeTokens: 4 },
    })).resolves.toMatchObject({ kind: "ok" });

    const overview = await corpus.getOverview("analysis_range");
    expect(overview?.spanCount).toBe(2);
    expect(overview?.computeUnits).toEqual(expect.arrayContaining([expect.objectContaining({ startByte })]));
    expect(overview?.computeUnits.every((unit) => unit.startByte >= startByte && unit.endByte <= endByte)).toBe(true);
    await expect(corpus.getSourceSpan("segmentation_range:sp00001")).resolves.toMatchObject({ startByte, text: "第一卷 起航" });
  });

  it("同一 SourceEdition 的两个完整 segmentation 使用独立 ID，且 AnalysisProject 拒绝引用另一版本的 span", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: commandBase("command_reference_double", "idem_reference_double"), referenceWorkId: "reference_double", sourceEditionId: "edition_double", title: "双分段参考", text: "第一章\n门后有脚步声。" });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const budget = { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 };
    await corpus.prepare({ command: commandBase("command_corpus_a", "idem_corpus_a"), analysisProjectId: "analysis_a", segmentationId: "segmentation_a", sourceEditionId: "edition_double", boundary: "complete", budget });
    await corpus.prepare({ command: commandBase("command_corpus_b", "idem_corpus_b"), analysisProjectId: "analysis_b", segmentationId: "segmentation_b", sourceEditionId: "edition_double", boundary: "complete", budget });

    const spans = await driver.query<{ span_id: string }>({ sql: "SELECT span_id FROM source_spans ORDER BY span_id", params: [] });
    expect(spans.map((span) => span.span_id)).toEqual([
      "segmentation_a:sp00001", "segmentation_a:sp00002", "segmentation_b:sp00001", "segmentation_b:sp00002",
    ]);
    const unitA = (await corpus.getOverview("analysis_a"))!.computeUnits[0]!.analysisUnitId;
    const facts = createAnalysisFactService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await expect(facts.submit({
      command: commandBase("command_cross_span", "idem_cross_span"), analysisProjectId: "analysis_a", analysisUnitId: unitA,
      rawOutput: JSON.stringify({ facts: [{ id: "fact_cross", kind: "event", rawLabel: null, statement: "脚步声出现", subject: null, object: null, evidenceSpanIds: ["segmentation_b:sp00002"], epistemicStatus: "observed" }] }),
    })).rejects.toThrow(/span|SourceSpan|证据/i);
  });

  it("存在路由时把 AnalysisCorpus 预算限制在 FactExtractor 的有效窗口内", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    await references.importText({ command: commandBase("command_reference_budget", "idem_reference_budget"), referenceWorkId: "reference_budget", sourceEditionId: "edition_budget", title: "预算参考", text: "第一章\n短文本。" });
    const corpus = createAnalysisCorpusService({
      driver, commands: application.commands, objects, now: () => 1_700_000_000_000,
      modelResolver: { resolve: async () => ({ role: "fact_extractor", providerProfileId: "local", baseURL: "http://127.0.0.1", model: "qwen", protocol: "ollama_native", contextWindowTokens: 20, maxOutputTokens: 4, safetyMarginRatio: 0.3, isCloud: false, cloudEscalation: "never" }) },
    });
    await expect(corpus.prepare({ command: commandBase("command_corpus_budget", "idem_corpus_budget"), analysisProjectId: "analysis_budget", segmentationId: "segmentation_budget", sourceEditionId: "edition_budget", boundary: "complete", budget: { contextWindowTokens: 100, safetyMarginRatio: 0.1, reservedOutputTokens: 8, renderedSystemPromptTokens: 0, renderedSchemaTokens: 0, envelopeTokens: 0 } })).resolves.toMatchObject({ kind: "ok" });
    await expect(corpus.getOverview("analysis_budget")).resolves.toMatchObject({ sourceInputBudgetTokens: 6 });
  });

  it("长文本只计算一次 UTF-16 到 UTF-8 的边界索引，避免每个 SourceSpan 重扫全文", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const text = Array.from({ length: 1_200 }, (_, index) => `第${index + 1}段 甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸。`).join("\n");
    await references.importText({ command: commandBase("command_reference_large", "idem_reference_large"), referenceWorkId: "reference_large", sourceEditionId: "edition_large", title: "长文本性能夹具", text });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });

    const startedAt = performance.now();
    await expect(corpus.prepare({
      command: commandBase("command_corpus_large", "idem_corpus_large"), analysisProjectId: "analysis_large", segmentationId: "segmentation_large", sourceEditionId: "edition_large", boundary: "complete",
      budget: { contextWindowTokens: 16_384, safetyMarginRatio: 0.2, reservedOutputTokens: 4_096, renderedSystemPromptTokens: 512, renderedSchemaTokens: 1_024, envelopeTokens: 512 },
    })).resolves.toMatchObject({ kind: "ok" });
    const elapsedMs = performance.now() - startedAt;

    await expect(corpus.getOverview("analysis_large")).resolves.toMatchObject({ spanCount: 1_200 });
    // 回归门：旧实现针对每个 span 重建全文 byte-boundary 数组，真实第一册无法在可用时间内完成建库。
    expect(elapsedMs).toBeLessThan(500);
  });
});

function commandBase(commandId: string, idempotencyKey: string): Omit<CommandEnvelope, "tool" | "args"> {
  return {
    schemaVersion: 1,
    commandId,
    idempotencyKey,
    correlationId: `correlation:${commandId}`,
    actor: { kind: "human", id: "user_001" },
    createdAt: 1_700_000_000_000,
  };
}
