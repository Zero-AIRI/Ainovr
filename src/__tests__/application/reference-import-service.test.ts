import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("参考文本导入服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-reference-import-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("把原始文本、规范化 UTF-8 文本和位置映射写入对象库，SQLite 只记录引用", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const service = createReferenceImportService({
      driver,
      commands: application.commands,
      objects: await createNodeObjectStore({ workspacePath }),
      now: () => 1_700_000_000_000,
    });

    await expect(service.importText({
      command: commandBase(),
      referenceWorkId: "reference_001",
      sourceEditionId: "edition_001",
      title: "示例参考",
      text: "\ufeff第一章\r\n雾港\r雨落在海面。",
    })).resolves.toEqual({
      kind: "ok",
      revision: 1,
      resourceRefs: [{ type: "reference_work", id: "reference_001" }, { type: "source_edition", id: "edition_001" }],
    });

    await expect(service.getReferenceWork("reference_001")).resolves.toMatchObject({
      referenceWorkId: "reference_001",
      title: "示例参考",
      sourceEditionId: "edition_001",
      normalizedByteLength: expect.any(Number),
      tokenEstimate: expect.any(Number),
      normalizationMapObjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const listReferenceWorks = service.listReferenceWorks;
    await expect(listReferenceWorks()).resolves.toEqual([
      expect.objectContaining({ referenceWorkId: "reference_001", sourceEditionId: "edition_001" }),
    ]);
    await expect(service.getExcerpt({ sourceEditionId: "edition_001", startByte: 0, endByte: new TextEncoder().encode("第一章\n雾港").byteLength }))
      .resolves.toEqual({ text: "第一章\n雾港", startByte: 0, endByte: new TextEncoder().encode("第一章\n雾港").byteLength });
    const command = await driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE command_id = ?", params: ["command_reference_001"] });
    expect(command[0]?.args_json).not.toContain("雾港");
    await expect(driver.query<{ raw_object_hash: string; normalized_object_hash: string }>({
      sql: "SELECT raw_object_hash, normalized_object_hash FROM source_editions WHERE source_edition_id = ?",
      params: ["edition_001"],
    })).resolves.toEqual([expect.objectContaining({ raw_object_hash: expect.stringMatching(/^[a-f0-9]{64}$/), normalized_object_hash: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  });

  it("拒绝越界或非 UTF-8 字符边界的原文摘录", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const service = createReferenceImportService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    await service.importText({ command: commandBase(), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "中文" });

    await expect(service.getExcerpt({ sourceEditionId: "edition_001", startByte: 1, endByte: 3 })).rejects.toThrow(/UTF-8/);
    await expect(service.getExcerpt({ sourceEditionId: "edition_001", startByte: 0, endByte: 99 })).rejects.toThrow(/越界/);
  });

  it("只在已登记 SourceEdition 内定位调用者提供的文本，并返回字节区间而非原文", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const service = createReferenceImportService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }), now: () => 1_700_000_000_000 });
    await service.importText({ command: commandBase(), referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "卷一\n潮来\n卷二\n潮去\n卷二" });

    await expect(service.findText({ sourceEditionId: "edition_001", query: "卷二", limit: 1 })).resolves.toEqual([{
      startByte: new TextEncoder().encode("卷一\n潮来\n").byteLength,
      endByte: new TextEncoder().encode("卷一\n潮来\n卷二").byteLength,
    }]);
    await expect(service.findText({ sourceEditionId: "edition_001", query: "不存在", limit: 3 })).resolves.toEqual([]);
    await expect(service.findText({ sourceEditionId: "edition_001", query: "", limit: 1 })).rejects.toThrow(/query/);
  });
});

function commandBase(): Omit<CommandEnvelope, "tool" | "args"> {
  return {
    schemaVersion: 1,
    commandId: "command_reference_001",
    idempotencyKey: "idem_reference_001",
    correlationId: "correlation_reference_001",
    actor: { kind: "human", id: "user_001" },
    createdAt: 1_700_000_000_000,
  };
}
