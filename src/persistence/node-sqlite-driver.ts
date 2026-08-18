import { mkdir } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { COMMAND_EXPECTED_REVISION_SCHEMA_VERSION, COMMAND_EXPECTED_REVISION_SQL, DATA_POLICY_REVISIONS_SCHEMA_VERSION, DATA_POLICY_REVISIONS_SQL, INITIAL_SCHEMA_SQL, INITIAL_SCHEMA_VERSION, PROJECT_SCOPED_PLANNING_DOCUMENT_IDS_SCHEMA_VERSION, PROJECT_SCOPED_PLANNING_DOCUMENT_IDS_SQL, PROVIDER_PROFILE_REVISIONS_SCHEMA_VERSION, PROVIDER_PROFILE_REVISIONS_SQL } from "@/persistence/migrations/0001-initial-schema";
import { createNodeMigrationBackup } from "@/persistence/node-migration-backup";
import { AffectedRowsExpectationError, type SqlDriver, type SqlStatement, type SqlValue, type StatementResult, type TransactionResult, type TransactionStep } from "@/persistence/sql-driver";

export interface CreateNodeSqlDriverOptions {
  /** 工作区根目录；适配器只会打开其 data/ainovr.sqlite3。 */
  workspacePath: string;
}

/**
 * Node 宿主专用的基础设施扩展。备份目标仍被限制在当前工作区
 * `data/backups/` 内，Application Service 不会得到任意数据库路径能力。
 */
export interface NodeSqlDriver extends SqlDriver {
  backupDatabase(destinationPath: string): Promise<void>;
}

const FORBIDDEN_SQL = /\b(?:attach|detach|load_extension)\b|\b(?:pragma\s+(?:writable_schema|trusted_schema|legacy_file_format))\b/i;
const MIGRATIONS = [
  { version: INITIAL_SCHEMA_VERSION, sql: INITIAL_SCHEMA_SQL },
  { version: COMMAND_EXPECTED_REVISION_SCHEMA_VERSION, sql: COMMAND_EXPECTED_REVISION_SQL },
  { version: PROVIDER_PROFILE_REVISIONS_SCHEMA_VERSION, sql: PROVIDER_PROFILE_REVISIONS_SQL },
  { version: DATA_POLICY_REVISIONS_SCHEMA_VERSION, sql: DATA_POLICY_REVISIONS_SQL },
  { version: PROJECT_SCOPED_PLANNING_DOCUMENT_IDS_SCHEMA_VERSION, sql: PROJECT_SCOPED_PLANNING_DOCUMENT_IDS_SQL },
] as const;

/**
 * Node/MCP/CLI 的 SQLite 适配器。它不包含任何小说领域规则，也不接受任意数据库路径。
 */
export async function createNodeSqlDriver(options: CreateNodeSqlDriverOptions): Promise<NodeSqlDriver> {
  const dataPath = path.join(options.workspacePath, "data");
  await mkdir(dataPath, { recursive: true });

  const database = new Database(path.join(dataPath, "ainovr.sqlite3"));
  try {
    // 在设定 WAL 或创建备份前拒绝未来 schema；旧程序绝不触碰新数据库。
    assertSupportedSchemaVersion(database);
    configureConnection(database);
    await applyMigrations(database, options.workspacePath);
  } catch (cause) {
    database.close();
    throw cause;
  }

  return {
    async query<T>(statement: SqlStatement): Promise<T[]> {
      assertAllowedSql(statement.sql);
      return database.prepare(statement.sql).all(...normalizeParams(statement.params)) as T[];
    },

    async execute(statement: SqlStatement): Promise<StatementResult> {
      assertAllowedSql(statement.sql);
      return toStatementResult(database.prepare(statement.sql).run(...normalizeParams(statement.params)));
    },

    async transaction(steps: TransactionStep[]): Promise<TransactionResult> {
      for (const step of steps) assertAllowedSql(step.sql);

      database.exec("BEGIN IMMEDIATE");
      try {
        const results = steps.map((step) => {
          const result = toStatementResult(database.prepare(step.sql).run(...normalizeParams(step.params)));
          assertAffectedRows(step, result);
          return result;
        });
        database.exec("COMMIT");
        return { steps: results };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    async backupDatabase(destinationPath: string): Promise<void> {
      assertBackupDestination(dataPath, destinationPath);
      // better-sqlite3 的 online backup API 从当前连接创建一致快照；它不需要
      // 停止 MCP/CLI 中的其他只读或写入宿主，也不会把 settings.json 纳入其中。
      await database.backup(destinationPath);
    },

    async close(): Promise<void> {
      database.close();
    },
  };
}

function assertBackupDestination(dataPath: string, destinationPath: string): void {
  const backupsPath = path.resolve(dataPath, "backups");
  const resolved = path.resolve(destinationPath);
  const relative = path.relative(backupsPath, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.extname(resolved).toLowerCase() !== ".sqlite3") {
    throw new Error("SQLite online backup destination must stay inside the Ainovr backup directory.");
  }
}

function configureConnection(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = NORMAL");
}

async function applyMigrations(database: Database.Database, workspacePath: string): Promise<void> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  for (const migration of MIGRATIONS) {
    const applied = database.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(migration.version) as { version: string } | undefined;
    if (applied) continue;
    await createNodeMigrationBackup({ database, workspacePath, migrationVersion: migration.version });
    database.exec("BEGIN IMMEDIATE");
    try {
      ensureMigrationColumns(database, migration.version);
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

/**
 * SQLite 不支持 `ADD COLUMN IF NOT EXISTS`。这些固定列属于已发布的
 * 0003/0004 前向迁移；若旧宿主已写入列却在写 migration record 前中断，
 * 这里会在同一事务内续跑回填，绝不重建或覆盖现有数据。
 */
function ensureMigrationColumns(database: Database.Database, version: string): void {
  if (version === PROVIDER_PROFILE_REVISIONS_SCHEMA_VERSION) {
    addColumnIfMissing(database, "provider_profiles", "artifact_id", "artifact_id TEXT");
    addColumnIfMissing(database, "provider_profiles", "current_revision", "current_revision INTEGER NOT NULL DEFAULT 1");
  }
  if (version === DATA_POLICY_REVISIONS_SCHEMA_VERSION) {
    addColumnIfMissing(database, "data_policies", "artifact_id", "artifact_id TEXT");
  }
}

function addColumnIfMissing(database: Database.Database, table: "provider_profiles" | "data_policies", column: string, definition: string): void {
  const existing = database.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get(table, column);
  if (existing) return;
  // table、column 和 definition 均来自上方固定迁移清单，不接受外部输入。
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function assertSupportedSchemaVersion(database: Database.Database): void {
  const migrationsTable = database.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations') AS value").get() as { value: number };
  if (migrationsTable.value !== 1) return;
  const known = new Set<string>(MIGRATIONS.map((migration) => migration.version));
  const versions = database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: string }>;
  const unsupported = versions.find((item) => !known.has(item.version));
  if (unsupported) throw new Error(`Ainovr database schema version ${unsupported.version} is unsupported by this application; refusing to modify the database.`);
}

function assertAllowedSql(sql: string): void {
  if (FORBIDDEN_SQL.test(sql)) throw new Error("SQLite statement is not allowed by the Ainovr gateway.");
}

function normalizeParams(params: SqlValue[]): Array<string | number | Uint8Array | null> {
  return params.map((value) => typeof value === "boolean" ? Number(value) : value);
}

function toStatementResult(result: Database.RunResult): StatementResult {
  return {
    rowsAffected: result.changes,
    lastInsertRowId: typeof result.lastInsertRowid === "bigint" ? result.lastInsertRowid.toString() : result.lastInsertRowid,
  };
}

function assertAffectedRows(step: TransactionStep, result: StatementResult): void {
  const expectation = step.expectAffectedRows;
  if (!expectation) return;

  const maximum = expectation.max ?? Number.POSITIVE_INFINITY;
  if (result.rowsAffected < expectation.min || result.rowsAffected > maximum) {
    throw new AffectedRowsExpectationError(expectation.min, maximum, result.rowsAffected);
  }
}
