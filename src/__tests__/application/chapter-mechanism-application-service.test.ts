import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChapterMechanismApplicationService } from "@/application/chapter-mechanism-application-service";
import { createCreativeRecipeService } from "@/application/creative-recipe-service";
import type { CommandEnvelope } from "@/application/command-types";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterMechanismApplicationService", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-chapter-mechanism-application-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("保存单章单卡采用记录，以 ChapterContract 和精确方法 revision 建立依赖", async () => {
    const application = await setup(driver);
    const service = createChapterMechanismApplicationService({
      driver,
      commands: application.commands,
      mechanisms: { listAdoptedSnapshots: async () => [safeMechanism(1)] },
    });

    await expect(service.save({
      command: command("application_create"), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null,
      application: applicationPayload(1),
    })).resolves.toMatchObject({ kind: "ok", revision: 1 });

    await expect(service.get({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toMatchObject({
      applicationId: "production:chapter_mechanism_application:chapter_001",
      chapterId: "chapter_001",
      chapterContractRevision: 1,
      mechanismAssetId: "mechanism_safe",
      mechanismRevision: 1,
    });
    await expect(driver.query<{ depends_on_artifact_id: string; depends_on_revision: number }>({
      sql: "SELECT depends_on_artifact_id, depends_on_revision FROM artifact_dependencies WHERE artifact_id = ? ORDER BY depends_on_artifact_id",
      params: ["document:production:chapter_mechanism_application:chapter_001"],
    })).resolves.toEqual([
      { depends_on_artifact_id: "document:planning:project_001:chapter_contract:chapter_001", depends_on_revision: 1 },
      { depends_on_artifact_id: "mechanism:mechanism_safe", depends_on_revision: 1 },
    ]);
  });

  it("以 CAS 拒绝旧 revision、未采纳卡、editor_only 卡和不完整决策", async () => {
    const application = await setup(driver);
    const service = createChapterMechanismApplicationService({
      driver,
      commands: application.commands,
      mechanisms: { listAdoptedSnapshots: async () => [safeMechanism(1)] },
    });
    const input = { command: command("application_create"), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null, application: applicationPayload(1) };
    await service.save(input);
    await service.save({ ...input, command: command("application_update"), expectedRevision: 1 });

    await expect(service.save({ ...input, command: command("application_stale"), expectedRevision: 1 }))
      .resolves.toMatchObject({ kind: "conflict", currentRevision: 2 });
    await expect(service.save({ ...input, command: command("application_missing_card"), chapterId: "chapter_002", application: { ...applicationPayload(1), applicationId: "production:chapter_mechanism_application:chapter_002", chapterId: "chapter_002", mechanismAssetId: "editor_only" } }))
      .rejects.toThrow(/采纳|Writer/);
    await expect(service.save({ ...input, command: command("application_empty_reason"), expectedRevision: 1, application: { ...applicationPayload(1), fields: { ...applicationPayload(1).fields, reason: { status: "specified", value: " " } } } }))
      .rejects.toThrow(/reason/);
  });

  it("上游机制更新会使采用记录失效", async () => {
    const application = await setup(driver);
    const service = createChapterMechanismApplicationService({ driver, commands: application.commands, mechanisms: { listAdoptedSnapshots: async () => [safeMechanism(1)] } });
    await service.save({ command: command("application_create"), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null, application: applicationPayload(1) });
    await driver.transaction([
      { sql: "UPDATE artifact_dependencies SET stale = 1 WHERE depends_on_artifact_id = ? AND depends_on_revision = ?", params: ["mechanism:mechanism_safe", 1] },
    ]);
    await expect(service.get({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toBeNull();
  });

  it("采用记录是 Recipe 的唯一方法输入，更新后会使旧 Recipe 失效", async () => {
    const application = await setup(driver);
    const mechanisms = { listAdoptedSnapshots: async () => [safeMechanism(1)] };
    const applications = createChapterMechanismApplicationService({ driver, commands: application.commands, mechanisms });
    await applications.save({ command: command("application_create"), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null, application: applicationPayload(1) });
    const recipes = createCreativeRecipeService({ driver, commands: application.commands, mechanisms, applications });

    await expect(recipes.create({ command: command("recipe_create"), projectId: "project_001", chapterId: "chapter_001" }))
      .resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(recipes.get({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toMatchObject({
      applicationId: "production:chapter_mechanism_application:chapter_001",
      applicationRevision: 1,
      mechanismAssetId: "mechanism_safe",
      writerMechanisms: [expect.objectContaining({ id: "mechanism_safe" })],
    });

    await applications.save({ command: command("application_update"), projectId: "project_001", chapterId: "chapter_001", expectedRevision: 1, application: applicationPayload(1) });
    await expect(recipes.get({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toBeNull();
  });
});

async function setup(driver: SqlDriver) {
  const schemas = createSchemaRegistry();
  registerCorePayloadSchemas(schemas);
  const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
  await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "雾港记录", status: "planning", payload: { schema_version: 1 } } });
  for (const chapterId of ["chapter_001", "chapter_002"]) {
    await application.commands.execute({
      ...command(`chapter_${chapterId}`), projectId: "project_001", tool: "commit_project_planning_document",
      args: { projectId: "project_001", documentId: `planning:project_001:chapter_contract:${chapterId}`, documentType: "chapter_contract", status: "approved", expectedRevision: null, payload: { schema_version: 1, kind: "chapter_contract", chapterId, ordinal: chapterId === "chapter_001" ? 1 : 2, entryState: ["入口"], exitState: ["出口"], desire: "目标", pressure: "压力", turningPoint: "转折", mustNotHappen: [], readerPromiseAction: "establish", emotionalCycle: "变化", nextChapterInterface: ["接口"] } },
    });
  }
  await driver.transaction([
    { sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, NULL, 'mechanism_asset', 1, 'verified', ?, ?)", params: ["mechanism:mechanism_safe", 1_700_000_000_000, 1_700_000_000_000] },
    { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 1, NULL, ?, NULL, ?, ?)", params: ["mechanism:mechanism_safe", '{"schema_version":1}', '{"kind":"human","id":"user_001"}', 1_700_000_000_000] },
  ]);
  return application;
}

function safeMechanism(revision: number) {
  return { revision, card: { id: "mechanism_safe", title: "异常先于解释", targetEffect: "建立可验证期待", scope: "distributed" as const, when: ["出现异常"], operations: ["先呈现异常"], avoid: ["先解释"], applicability: ["信息受限"], targetLayers: ["draft"] as ("draft")[] } };
}

function applicationPayload(mechanismRevision: number) {
  return {
    schema_version: 1 as const,
    kind: "chapter_mechanism_application" as const,
    applicationId: "production:chapter_mechanism_application:chapter_001",
    chapterId: "chapter_001",
    chapterContractRevision: 1,
    mechanismAssetId: "mechanism_safe",
    mechanismRevision,
    fields: {
      reason: { status: "specified" as const, value: "本章需要先建立异常期待。" },
      plannedUse: { status: "specified" as const, value: "在开场呈现异常细节。" },
      observableReaderEffect: { status: "specified" as const, value: "读者会追问异常来源。" },
      misuseToAvoid: { status: "specified" as const, value: "不要立即解释原因。" },
      reviewSignals: [{ status: "specified" as const, value: "异常出现后读者会形成具体疑问。" }],
    },
  };
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
