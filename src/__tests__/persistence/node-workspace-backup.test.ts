import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver, type NodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createNodeWorkspaceBackupRepository } from "@/persistence/node-workspace-backup";

describe("Node 工作区在线备份与受控恢复", () => {
  let workspacePath: string;
  let driver: NodeSqlDriver;
  const temporaryRoots: string[] = [];

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-workspace-backup-"));
    temporaryRoots.push(workspacePath);
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await Promise.all(temporaryRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("在线备份完整 SQLite 与已登记对象，并可恢复到一个新的空工作区而不携带 settings.json", async () => {
    const objects = await createNodeObjectStore({ workspacePath });
    const object = await objects.put({ content: new TextEncoder().encode("可恢复的原创正文"), mediaType: "text/plain; charset=utf-8" });
    await driver.execute({
      sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?)",
      params: [object.sha256, object.byteLength, object.mediaType, 1, 1],
    });
    // 用测试哨兵模拟本机秘密；备份目录绝不可复制此文件。
    await writeFile(path.join(workspacePath, "data", "settings.json"), '{"apiKey":"test-secret-must-not-back-up"}', "utf8");

    const backups = createNodeWorkspaceBackupRepository({ workspacePath, driver, now: () => 1_700_000_000_000 });
    const backup = await backups.create({ backupId: "backup-001" });

    expect(backup).toMatchObject({ backupId: "backup-001", objectCount: 1 });
    await expect(access(path.join(backup.directory, "ainovr.sqlite3"))).resolves.toBeUndefined();
    await expect(readFile(path.join(backup.directory, "objects", object.sha256))).resolves.toEqual(Buffer.from("可恢复的原创正文"));
    await expect(access(path.join(backup.directory, "settings.json"))).rejects.toThrow();
    const manifestText = await readFile(path.join(backup.directory, "manifest.json"), "utf8");
    expect(manifestText).not.toContain("test-secret-must-not-back-up");
    expect(manifestText).toContain(object.sha256);

    const restored = await backups.restore({ backupId: "backup-001", restoreId: "restore-001" });
    expect(restored).toMatchObject({ backupId: "backup-001", restoreId: "restore-001", objectCount: 1 });
    await expect(access(path.join(restored.workspacePath, "data", "settings.json"))).rejects.toThrow();

    const restoredDriver = await createNodeSqlDriver({ workspacePath: restored.workspacePath });
    try {
      await expect(restoredDriver.query<{ sha256: string }>({ sql: "SELECT sha256 FROM objects", params: [] })).resolves.toEqual([{ sha256: object.sha256 }]);
      const restoredObjects = await createNodeObjectStore({ workspacePath: restored.workspacePath });
      await expect(restoredObjects.read(object.sha256)).resolves.toEqual(new TextEncoder().encode("可恢复的原创正文"));
    } finally {
      await restoredDriver.close();
    }
  });

  it("拒绝危险标识符，并且不会覆盖已有恢复目录", async () => {
    const backups = createNodeWorkspaceBackupRepository({ workspacePath, driver });
    await expect(backups.create({ backupId: "../outside" })).rejects.toThrow(/backupId/i);
    await backups.create({ backupId: "backup-safe" });
    await backups.restore({ backupId: "backup-safe", restoreId: "restore-safe" });
    await expect(backups.restore({ backupId: "backup-safe", restoreId: "restore-safe" })).rejects.toThrow(/already exists/i);
  });
});
