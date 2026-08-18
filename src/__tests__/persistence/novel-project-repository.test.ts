import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createNovelProjectRepository } from "@/persistence/novel-project-repository";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("NovelProject Repository", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-novel-project-repository-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("以同一 revision 边界创建、读取和 CAS 更新原创项目", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const repository = createNovelProjectRepository(driver, schemas, () => 1_700_000_000_000);

    await repository.create({
      projectId: "project_001",
      title: "雾港记录",
      status: "planning",
      payload: { schema_version: 1, intent: "近未来悬疑" },
      actor: { kind: "human", id: "user_001" },
    });
    await repository.update({
      projectId: "project_001",
      expectedRevision: 1,
      title: "雾港记录",
      status: "producing",
      payload: { schema_version: 1, intent: "近未来悬疑", selectedConceptId: "concept_002" },
      actor: { kind: "human", id: "user_001" },
    });

    await expect(repository.update({
      projectId: "project_001",
      expectedRevision: 1,
      title: "冲突写入",
      status: "producing",
      payload: { schema_version: 1 },
      actor: { kind: "human", id: "user_002" },
    })).rejects.toThrow(/affected rows/i);

    await expect(repository.get("project_001")).resolves.toEqual({
      projectId: "project_001",
      title: "雾港记录",
      status: "producing",
      revision: 2,
      payload: { schema_version: 1, intent: "近未来悬疑", selectedConceptId: "concept_002" },
      actor: { kind: "human", id: "user_001" },
    });
  });

  it("在写入前拒绝缺失 schema_version 的项目 payload", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const repository = createNovelProjectRepository(driver, schemas);

    await expect(repository.create({
      projectId: "project_invalid",
      title: "无效项目",
      status: "planning",
      payload: { intent: "没有版本" },
      actor: { kind: "human", id: "user_001" },
    })).rejects.toThrow(/schema_version/);
  });
});
