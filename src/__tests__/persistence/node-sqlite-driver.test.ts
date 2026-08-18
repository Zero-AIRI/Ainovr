import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import initialSchemaSql from "@/persistence/migrations/0001-initial-schema.sql?raw";
import providerProfileRevisionsSql from "@/persistence/migrations/0003-provider-profile-revisions.sql?raw";
import dataPolicyRevisionsSql from "@/persistence/migrations/0004-data-policy-revisions.sql?raw";
import projectScopedPlanningDocumentIdsSql from "@/persistence/migrations/0005-project-scoped-planning-document-ids.sql?raw";
import type { SqlDriver } from "@/persistence/sql-driver";

async function createLegacy0005Workspace(workspacePath: string): Promise<string> {
  const dataPath = path.join(workspacePath, "data");
  await mkdir(dataPath, { recursive: true });
  const databasePath = path.join(dataPath, "ainovr.sqlite3");
  const database = new Database(databasePath);
  database.exec(initialSchemaSql);
  database.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  database.exec("ALTER TABLE commands ADD COLUMN expected_revision INTEGER; ALTER TABLE provider_profiles ADD COLUMN artifact_id TEXT; ALTER TABLE provider_profiles ADD COLUMN current_revision INTEGER NOT NULL DEFAULT 1; ALTER TABLE data_policies ADD COLUMN artifact_id TEXT;");
  database.exec(providerProfileRevisionsSql);
  database.exec(dataPolicyRevisionsSql);
  database.exec(projectScopedPlanningDocumentIdsSql);
  const migration = database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  for (const version of ["0001", "0002", "0003", "0004", "0005"]) migration.run(version, 1_700_000_000_000);
  database.close();
  return databasePath;
}

describe("Node SqlDriver 双宿主契约", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-sql-driver-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("固定在工作区 data/ainovr.sqlite3 创建并迁移数据库", async () => {
    await access(path.join(workspacePath, "data", "ainovr.sqlite3"));

    const migrations = await driver.query<{ version: string }>({
      sql: "SELECT version FROM schema_migrations ORDER BY version",
      params: [],
    });
    const foreignKeys = await driver.query<{ foreign_keys: number }>({ sql: "PRAGMA foreign_keys", params: [] });
    const journal = await driver.query<{ journal_mode: string }>({ sql: "PRAGMA journal_mode", params: [] });

    expect(migrations).toEqual([{ version: "0001" }, { version: "0002" }, { version: "0003" }, { version: "0004" }, { version: "0005" }, { version: "0006" }]);
    expect(foreignKeys).toEqual([{ foreign_keys: 1 }]);
    expect(journal).toEqual([{ journal_mode: "wal" }]);
    const backups = await readdir(path.join(workspacePath, "data", "backups"));
    expect(backups.filter((name) => name.endsWith(".sqlite3"))).toHaveLength(6);
    expect(backups.filter((name) => name.endsWith(".json"))).toHaveLength(6);
  });

  it("参数化查询和事务 affected-row 断言共享同一契约", async () => {
    await driver.execute({
      sql: "INSERT INTO workspace_meta (key, value_json, updated_at) VALUES (?, ?, ?)",
      params: ["workspace_name", '{"schema_version":1,"value":"测试工作区"}', 1_700_000_000_000],
    });

    await expect(driver.transaction([
      {
        sql: "UPDATE workspace_meta SET value_json = ?, updated_at = ? WHERE key = ?",
        params: ['{"schema_version":1,"value":"已更新"}', 1_700_000_000_001, "workspace_name"],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "UPDATE workspace_meta SET value_json = ? WHERE key = ?",
        params: ['{"schema_version":1,"value":"不应写入"}', "missing"],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ])).rejects.toThrow(/affected rows/i);

    const rows = await driver.query<{ value_json: string }>({
      sql: "SELECT value_json FROM workspace_meta WHERE key = ?",
      params: ["workspace_name"],
    });
    expect(rows).toEqual([{ value_json: '{"schema_version":1,"value":"测试工作区"}' }]);
  });

  it("0001 建立最终计划要求的全部表组", async () => {
    const rows = await driver.query<{ name: string }>({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      params: [],
    });

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      "schema_migrations", "workspace_meta", "objects", "commands", "idempotency_records", "audit_events", "confirmations", "change_feed",
      "tasks", "task_attempts", "task_events", "task_checkpoints",
      "pipelines", "pipeline_revisions", "run_snapshots", "runs", "run_nodes", "run_events",
      "reference_works", "source_editions", "source_locations", "analysis_segmentations", "analysis_units", "source_spans",
      "analysis_projects", "research_questions", "analysis_items", "evidence_instances", "coverage_entries", "research_dossiers",
      "mechanism_assets", "mechanism_asset_revisions", "mechanism_adoptions",
      "novel_projects", "project_branches", "chapters", "project_documents",
      "artifacts", "artifact_revisions", "artifact_dependencies",
      "canon_entries", "character_knowledge", "reader_states", "reader_promises", "production_commits",
      "provider_profiles", "model_routes", "data_policies",
    ]));
  });

  it("为主分支强制保证章节 ordinal 唯一，避免并发首章双写", async () => {
    await driver.execute({
      sql: "INSERT INTO novel_projects (project_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      params: ["project_unique_chapter", "并发章节", "planning", 1_700_000_000_000, 1_700_000_000_000],
    });
    await driver.execute({
      sql: "INSERT INTO chapters (chapter_id, project_id, branch_id, ordinal, status, current_revision, created_at, updated_at) VALUES (?, ?, NULL, 1, 'accepted', 1, ?, ?)",
      params: ["chapter_unique_1", "project_unique_chapter", 1_700_000_000_000, 1_700_000_000_000],
    });
    await expect(driver.execute({
      sql: "INSERT INTO chapters (chapter_id, project_id, branch_id, ordinal, status, current_revision, created_at, updated_at) VALUES (?, ?, NULL, 1, 'accepted', 1, ?, ?)",
      params: ["chapter_unique_2", "project_unique_chapter", 1_700_000_000_001, 1_700_000_000_001],
    })).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it("拒绝越界 SQLite 指令", async () => {
    await expect(driver.execute({
      sql: "ATTACH DATABASE ? AS external_workspace",
      params: [path.join(workspacePath, "outside.sqlite3")],
    })).rejects.toThrow(/not allowed/i);
  });

  it("遇到未知的更高 schema 版本时拒绝启动，且不创建备份或修改原数据库", async () => {
    const incompatibleWorkspace = path.join(workspacePath, "incompatible-workspace");
    const dataPath = path.join(incompatibleWorkspace, "data");
    await mkdir(dataPath, { recursive: true });
    const databasePath = path.join(dataPath, "ainovr.sqlite3");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run("9999", 1_700_000_000_000);
    database.close();
    const before = await readFile(databasePath);

    await expect(createNodeSqlDriver({ workspacePath: incompatibleWorkspace })).rejects.toThrow(/schema version.*unsupported|unsupported.*schema version/i);
    await expect(readFile(databasePath)).resolves.toEqual(before);
    await expect(access(path.join(dataPath, "backups"))).rejects.toThrow();
  });

  it("将标准 0005 工作区前向迁移到 0006，并创建 SQLite 与对象引用备份", async () => {
    const legacyWorkspace = path.join(workspacePath, "legacy-0005");
    const databasePath = await createLegacy0005Workspace(legacyWorkspace);
    const legacy = new Database(databasePath);
    legacy.pragma("foreign_keys = OFF");
    legacy.exec("INSERT INTO run_snapshots (snapshot_id, pipeline_id, pipeline_revision, payload_json, created_at) VALUES ('snapshot-1', 'pipeline-1', 1, '{\"schema_version\":1,\"kind\":\"pipeline_run_snapshot\",\"steps\":[{\"id\":\"node-1\",\"execution\":\"agent_action\"}],\"routeSnapshots\":{}}', 1); INSERT INTO runs (run_id, snapshot_id, project_id, status, task_id, created_at, updated_at) VALUES ('run-1', 'snapshot-1', NULL, 'queued', NULL, 1, 1); INSERT INTO run_nodes (run_id, node_id, status, output_object_hash, checkpoint_json, started_at, completed_at) VALUES ('run-1', 'node-1', 'queued', NULL, NULL, NULL, NULL); INSERT INTO novel_projects (project_id, title, status, current_revision, created_at, updated_at) VALUES ('project-1', '迁移项目', 'planning', 1, 1, 1); INSERT INTO reader_states (reader_state_id, project_id, chapter_id, payload_json, revision, created_at) VALUES ('state-1', 'project-1', NULL, '{}', 1, 1); INSERT INTO reader_promises (reader_promise_id, project_id, chapter_id, payload_json, status, revision, created_at, updated_at) VALUES ('promise-1', 'project-1', NULL, '{}', 'open', 1, 1, 1);");
    legacy.close();

    const migrated = await createNodeSqlDriver({ workspacePath: legacyWorkspace });
    await expect(migrated.query<{ version: string }>({ sql: "SELECT version FROM schema_migrations ORDER BY version", params: [] })).resolves.toEqual([
      { version: "0001" }, { version: "0002" }, { version: "0003" }, { version: "0004" }, { version: "0005" }, { version: "0006" },
    ]);
    await expect(migrated.query<{ name: string }>({ sql: "SELECT name FROM pragma_table_info('run_nodes') WHERE name = 'execution'", params: [] })).resolves.toEqual([{ name: "execution" }]);
    await expect(migrated.query<{ execution: string; task_id: string | null }>({ sql: "SELECT execution, task_id FROM run_nodes WHERE run_id = 'run-1' AND node_id = 'node-1'", params: [] })).resolves.toEqual([{ execution: "agent_action", task_id: null }]);
    await expect(migrated.query<{ reader_state_id: string; reader_promise_id: string }>({ sql: "SELECT state.reader_state_id, promise.reader_promise_id FROM reader_states state INNER JOIN reader_promises promise ON promise.project_id = state.project_id", params: [] })).resolves.toEqual([{ reader_state_id: "state-1", reader_promise_id: "promise-1" }]);
    await migrated.close();

    await access(databasePath);
    const backups = await readdir(path.join(legacyWorkspace, "data", "backups"));
    expect(backups.filter((name) => name.endsWith(".sqlite3"))).toHaveLength(1);
    expect(backups.filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });

  it("已具备最终结构但缺少 0006 记录时只验证并补记版本", async () => {
    await driver.close();
    const databasePath = path.join(workspacePath, "data", "ainovr.sqlite3");
    const database = new Database(databasePath);
    database.exec("DELETE FROM schema_migrations WHERE version = '0006'");
    database.close();

    driver = await createNodeSqlDriver({ workspacePath });
    await expect(driver.query<{ version: string }>({ sql: "SELECT version FROM schema_migrations WHERE version = '0006'", params: [] })).resolves.toEqual([{ version: "0006" }]);
  });

  it("冻结快照没有显式 execution 时拒绝 0006，且事务不留下半迁移结构", async () => {
    const legacyWorkspace = path.join(workspacePath, "legacy-missing-execution");
    const databasePath = await createLegacy0005Workspace(legacyWorkspace);
    const database = new Database(databasePath);
    database.pragma("foreign_keys = OFF");
    database.exec("INSERT INTO run_snapshots (snapshot_id, pipeline_id, pipeline_revision, payload_json, created_at) VALUES ('snapshot-1', 'pipeline-1', 1, '{\"steps\":[{\"id\":\"node-1\"}]}', 1); INSERT INTO runs (run_id, snapshot_id, project_id, status, task_id, created_at, updated_at) VALUES ('run-1', 'snapshot-1', NULL, 'queued', NULL, 1, 1); INSERT INTO run_nodes (run_id, node_id, status, output_object_hash, checkpoint_json, started_at, completed_at) VALUES ('run-1', 'node-1', 'queued', NULL, NULL, NULL, NULL);");
    database.close();

    await expect(createNodeSqlDriver({ workspacePath: legacyWorkspace })).rejects.toThrow(/explicit frozen execution|refusing migration/i);
    const after = new Database(databasePath);
    expect(after.prepare("SELECT 1 FROM pragma_table_info('run_nodes') WHERE name = 'execution'").get()).toBeUndefined();
    expect(after.prepare("SELECT 1 FROM schema_migrations WHERE version = '0006'").get()).toBeUndefined();
    expect(after.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_nodes_0006'").get()).toBeUndefined();
    after.close();
  });

  it("主分支章节 ordinal 重复时拒绝 0006", async () => {
    const legacyWorkspace = path.join(workspacePath, "legacy-duplicate-ordinal");
    const databasePath = await createLegacy0005Workspace(legacyWorkspace);
    const database = new Database(databasePath);
    database.pragma("foreign_keys = OFF");
    database.exec("INSERT INTO chapters (chapter_id, project_id, branch_id, ordinal, status, current_revision, created_at, updated_at) VALUES ('chapter-1', 'project-1', NULL, 1, 'planned', 1, 1, 1), ('chapter-2', 'project-1', NULL, 1, 'planned', 1, 1, 1);");
    database.close();

    await expect(createNodeSqlDriver({ workspacePath: legacyWorkspace })).rejects.toThrow(/Duplicate main-branch chapter ordinal/i);
    const after = new Database(databasePath);
    expect(after.prepare("SELECT 1 FROM schema_migrations WHERE version = '0006'").get()).toBeUndefined();
    expect(after.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'chapters_main_branch_ordinal_unique'").get()).toBeUndefined();
    after.close();
  });

  it("接受文档无法证明 ProductionCommit lineage 时拒绝 0006", async () => {
    const legacyWorkspace = path.join(workspacePath, "legacy-unverifiable-lineage");
    const databasePath = await createLegacy0005Workspace(legacyWorkspace);
    const database = new Database(databasePath);
    database.pragma("foreign_keys = OFF");
    database.exec("INSERT INTO production_commits (production_commit_id, project_id, chapter_id, accepted_document_id, manifest_object_hash, run_id, actor_json, created_at) VALUES ('commit-1', 'project-1', 'chapter-1', 'document-1', 'not-a-real-object', NULL, '{}', 1);");
    database.close();

    await expect(createNodeSqlDriver({ workspacePath: legacyWorkspace })).rejects.toThrow(/ProductionCommit references cannot be verified|verifiable complete lineage/i);
    const after = new Database(databasePath);
    expect(after.prepare("SELECT 1 FROM schema_migrations WHERE version = '0006'").get()).toBeUndefined();
    expect(after.prepare("SELECT 1 FROM pragma_table_info('production_commits') WHERE name = 'lineage_json'").get()).toBeUndefined();
    after.close();
  });

  it("能恢复列已写入但迁移记录缺失的中断版本化设置迁移", async () => {
    await driver.close();
    const database = new Database(path.join(workspacePath, "data", "ainovr.sqlite3"));
    database.exec("DELETE FROM schema_migrations WHERE version IN ('0003', '0004')");
    database.close();

    driver = await createNodeSqlDriver({ workspacePath });

    await expect(driver.query<{ version: string }>({
      sql: "SELECT version FROM schema_migrations ORDER BY version",
      params: [],
    })).resolves.toEqual([{ version: "0001" }, { version: "0002" }, { version: "0003" }, { version: "0004" }, { version: "0005" }, { version: "0006" }]);
  });
});
