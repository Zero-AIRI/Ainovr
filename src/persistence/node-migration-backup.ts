import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface NodeMigrationBackup {
  databasePath: string;
  objectManifestPath: string;
}

/**
 * Node MCP/CLI 在执行 schema migration 前创建的本地恢复点。
 * 清单只列对象 hash、长度与媒体类型，不读取对象内容，更不接触 settings.json。
 */
export async function createNodeMigrationBackup(input: {
  database: Database.Database;
  workspacePath: string;
  migrationVersion: string;
  now?: () => number;
}): Promise<NodeMigrationBackup> {
  if (!/^\d{4}$/.test(input.migrationVersion)) throw new Error("migrationVersion 必须是四位迁移版本。 ");
  const now = input.now ?? Date.now;
  const dataPath = path.join(input.workspacePath, "data");
  const backupPath = path.join(dataPath, "backups");
  await mkdir(backupPath, { recursive: true });
  // 在复制前将 WAL 内容 checkpoint 到主库，避免副本遗漏已提交页。
  input.database.pragma("wal_checkpoint(TRUNCATE)");
  const suffix = `${input.migrationVersion}-${now()}`;
  const databasePath = path.join(backupPath, `ainovr.sqlite3.before-${suffix}.sqlite3`);
  await copyFile(path.join(dataPath, "ainovr.sqlite3"), databasePath);
  const objectManifestPath = path.join(backupPath, `objects.before-${suffix}.json`);
  const objects = readObjectReferences(input.database);
  await writeFile(objectManifestPath, `${JSON.stringify({ migrationVersion: input.migrationVersion, objects }, null, 2)}\n`, "utf8");
  return { databasePath, objectManifestPath };
}

function readObjectReferences(database: Database.Database): Array<{ sha256: string; byteLength: number; mediaType: string }> {
  const exists = database.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'objects') AS value").get() as { value: number };
  if (exists.value !== 1) return [];
  const rows = database.prepare("SELECT sha256, byte_length, media_type FROM objects ORDER BY sha256 ASC").all() as Array<{ sha256: string; byte_length: number; media_type: string }>;
  return rows.map((row) => {
    if (!SHA256_PATTERN.test(row.sha256) || !Number.isInteger(row.byte_length) || row.byte_length < 0 || !row.media_type.trim()) throw new Error("objects 表含非法对象引用，拒绝迁移。 ");
    return { sha256: row.sha256, byteLength: row.byte_length, mediaType: row.media_type };
  });
}
