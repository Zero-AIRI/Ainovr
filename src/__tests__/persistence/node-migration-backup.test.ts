import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeMigrationBackup } from "@/persistence/node-migration-backup";

describe("Node 迁移前备份", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map(async (workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("在迁移前复制 SQLite，并写入不含 Secret 的对象引用清单", async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-migration-backup-"));
    workspaces.push(workspacePath);
    const dataPath = path.join(workspacePath, "data");
    await mkdir(dataPath, { recursive: true });
    const database = new Database(path.join(dataPath, "ainovr.sqlite3"));
    database.exec("CREATE TABLE objects (sha256 TEXT PRIMARY KEY, byte_length INTEGER NOT NULL, media_type TEXT NOT NULL)");
    database.prepare("INSERT INTO objects (sha256, byte_length, media_type) VALUES (?, ?, ?)").run("a".repeat(64), 12, "text/plain; charset=utf-8");

    const backup = await createNodeMigrationBackup({ database, workspacePath, migrationVersion: "0003", now: () => 1_700_000_000_000 });
    database.close();

    expect(backup.databasePath).toMatch(/ainovr\.sqlite3\.before-0003-1700000000000\.sqlite3$/);
    const manifest = JSON.parse(await readFile(backup.objectManifestPath, "utf8")) as { migrationVersion: string; objects: Array<{ sha256: string; byteLength: number; mediaType: string }> };
    expect(manifest).toEqual({ migrationVersion: "0003", objects: [{ sha256: "a".repeat(64), byteLength: 12, mediaType: "text/plain; charset=utf-8" }] });
    const recovered = new Database(backup.databasePath);
    expect(recovered.prepare("SELECT COUNT(*) AS count FROM objects").get()).toEqual({ count: 1 });
    recovered.close();
  });
});
