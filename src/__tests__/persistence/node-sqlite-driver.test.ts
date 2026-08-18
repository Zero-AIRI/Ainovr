import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import type { SqlDriver } from "@/persistence/sql-driver";

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

    expect(migrations).toEqual([{ version: "0001" }, { version: "0002" }, { version: "0003" }, { version: "0004" }, { version: "0005" }]);
    expect(foreignKeys).toEqual([{ foreign_keys: 1 }]);
    expect(journal).toEqual([{ journal_mode: "wal" }]);
    const backups = await readdir(path.join(workspacePath, "data", "backups"));
    expect(backups.filter((name) => name.endsWith(".sqlite3"))).toHaveLength(5);
    expect(backups.filter((name) => name.endsWith(".json"))).toHaveLength(5);
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

  it("能恢复列已写入但迁移记录缺失的中断版本化设置迁移", async () => {
    await driver.close();
    const database = new Database(path.join(workspacePath, "data", "ainovr.sqlite3"));
    database.exec("DELETE FROM schema_migrations WHERE version IN ('0003', '0004')");
    database.close();

    driver = await createNodeSqlDriver({ workspacePath });

    await expect(driver.query<{ version: string }>({
      sql: "SELECT version FROM schema_migrations ORDER BY version",
      params: [],
    })).resolves.toEqual([{ version: "0001" }, { version: "0002" }, { version: "0003" }, { version: "0004" }, { version: "0005" }]);
  });
});
