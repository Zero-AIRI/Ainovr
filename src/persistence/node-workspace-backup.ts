import { access, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import type { NodeSqlDriver } from "@/persistence/node-sqlite-driver";

const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;

interface BackupObject {
  sha256: string;
  byteLength: number;
  mediaType: string;
  registered: boolean;
}

interface BackupManifest {
  schemaVersion: 1;
  kind: "ainovr_workspace_backup";
  backupId: string;
  createdAt: number;
  database: { fileName: "ainovr.sqlite3"; sha256: string; byteLength: number };
  objects: BackupObject[];
}

export interface WorkspaceBackupView {
  backupId: string;
  directory: string;
  createdAt: number;
  objectCount: number;
}

export interface WorkspaceRestoreView {
  backupId: string;
  restoreId: string;
  workspacePath: string;
  objectCount: number;
}

export interface NodeWorkspaceBackupRepository {
  create(input: { backupId: string }): Promise<WorkspaceBackupView>;
  restore(input: { backupId: string; restoreId: string }): Promise<WorkspaceRestoreView>;
}

/**
 * R8 的受控备份仓储：只操作工作区内部 `data/backups` 与 `data/restores`。
 * 它既不读取 settings.json，也不接受调用方提供的路径；恢复永远落到新的空目录，
 * 因而不会覆盖当前 SQLite 工作区。
 */
export function createNodeWorkspaceBackupRepository(input: {
  workspacePath: string;
  driver: NodeSqlDriver;
  now?: () => number;
}): NodeWorkspaceBackupRepository {
  const root = path.resolve(input.workspacePath);
  const dataPath = path.join(root, "data");
  const backupsPath = path.join(dataPath, "backups");
  const restoresPath = path.join(dataPath, "restores");
  const now = input.now ?? Date.now;

  return {
    async create({ backupId }) {
      assertIdentifier(backupId, "backupId");
      const directory = path.join(backupsPath, `workspace-${backupId}`);
      await assertMissing(directory, "backup directory");
      const staging = path.join(backupsPath, ".tmp", `${backupId}-${randomSuffix()}`);
      await mkdir(path.join(staging, "objects"), { recursive: true });

      try {
        const databasePath = path.join(staging, "ainovr.sqlite3");
        await input.driver.backupDatabase(databasePath);
        const registered = snapshotObjectReferences(databasePath);
        const objectRoot = path.join(dataPath, "objects");
        const objects = await collectObjects(objectRoot, registered);
        for (const object of objects) {
          await copyVerifiedFile(path.join(objectRoot, object.sha256), path.join(staging, "objects", object.sha256), object.sha256, object.byteLength);
        }
        const database = await fileIntegrity(databasePath);
        const manifest: BackupManifest = {
          schemaVersion: 1,
          kind: "ainovr_workspace_backup",
          backupId,
          createdAt: now(),
          database: { fileName: "ainovr.sqlite3", sha256: database.sha256, byteLength: database.byteLength },
          objects,
        };
        await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        await mkdir(backupsPath, { recursive: true });
        await rename(staging, directory);
        return { backupId, directory, createdAt: manifest.createdAt, objectCount: objects.length };
      } catch (cause) {
        await rm(staging, { recursive: true, force: true });
        throw cause;
      }
    },

    async restore({ backupId, restoreId }) {
      assertIdentifier(backupId, "backupId");
      assertIdentifier(restoreId, "restoreId");
      const source = path.join(backupsPath, `workspace-${backupId}`);
      const manifest = await readManifest(source, backupId);
      const workspacePath = path.join(restoresPath, restoreId);
      await assertMissing(workspacePath, "restore directory");
      const staging = path.join(restoresPath, ".tmp", `${restoreId}-${randomSuffix()}`);
      const stagingData = path.join(staging, "data");
      await mkdir(path.join(stagingData, "objects"), { recursive: true });

      try {
        await copyVerifiedFile(path.join(source, manifest.database.fileName), path.join(stagingData, "ainovr.sqlite3"), manifest.database.sha256, manifest.database.byteLength);
        for (const object of manifest.objects) {
          await copyVerifiedFile(path.join(source, "objects", object.sha256), path.join(stagingData, "objects", object.sha256), object.sha256, object.byteLength);
        }
        // 只保存不含秘密的备份描述，便于恢复工作区内的人工核验。
        await writeFile(path.join(staging, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        await verifyRestoredDatabase(path.join(stagingData, "ainovr.sqlite3"), manifest.objects);
        await mkdir(restoresPath, { recursive: true });
        await rename(staging, workspacePath);
        return { backupId, restoreId, workspacePath, objectCount: manifest.objects.length };
      } catch (cause) {
        await rm(staging, { recursive: true, force: true });
        throw cause;
      }
    },
  };
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`${label} must use lowercase letters, digits, and hyphens only.`);
}

async function assertMissing(target: string, label: string): Promise<void> {
  try {
    await access(target);
  } catch {
    return;
  }
  throw new Error(`${label} already exists; Ainovr will not overwrite it.`);
}

function snapshotObjectReferences(databasePath: string): Map<string, Omit<BackupObject, "registered">> {
  const database = new Database(databasePath, { readonly: true });
  try {
    const table = database.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'objects') AS value").get() as { value: number };
    if (table.value !== 1) throw new Error("Workspace snapshot does not contain the Ainovr objects table.");
    const rows = database.prepare("SELECT sha256, byte_length, media_type FROM objects ORDER BY sha256 ASC").all() as Array<{ sha256: string; byte_length: number; media_type: string }>;
    return new Map(rows.map((row) => {
      if (!SHA256.test(row.sha256) || !Number.isInteger(row.byte_length) || row.byte_length < 0 || !row.media_type.trim()) throw new Error("Workspace snapshot contains an invalid object reference.");
      return [row.sha256, { sha256: row.sha256, byteLength: row.byte_length, mediaType: row.media_type }];
    }));
  } finally {
    database.close();
  }
}

async function collectObjects(objectRoot: string, registered: Map<string, Omit<BackupObject, "registered">>): Promise<BackupObject[]> {
  let names: string[];
  try {
    names = await readdir(objectRoot);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") names = [];
    else throw cause;
  }
  const hashes = new Set(names.filter((name) => SHA256.test(name)));
  for (const hash of registered.keys()) hashes.add(hash);

  const objects: BackupObject[] = [];
  for (const sha256 of [...hashes].sort()) {
    const registeredObject = registered.get(sha256);
    const source = path.join(objectRoot, sha256);
    const sourceStat = await lstat(source).catch(() => null);
    if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Object ${sha256} required by the workspace snapshot is unavailable.`);
    const integrity = await fileIntegrity(source);
    if (integrity.sha256 !== sha256) throw new Error(`Object ${sha256} failed SHA-256 verification before backup.`);
    if (registeredObject && integrity.byteLength !== registeredObject.byteLength) throw new Error(`Object ${sha256} byte length does not match the workspace snapshot.`);
    objects.push({
      sha256,
      byteLength: integrity.byteLength,
      mediaType: registeredObject?.mediaType ?? "application/octet-stream",
      registered: Boolean(registeredObject),
    });
  }
  return objects;
}

async function readManifest(directory: string, backupId: string): Promise<BackupManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  } catch {
    throw new Error("Workspace backup manifest is missing or invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Workspace backup manifest is invalid.");
  const manifest = value as Partial<BackupManifest>;
  if (manifest.schemaVersion !== 1 || manifest.kind !== "ainovr_workspace_backup" || manifest.backupId !== backupId
    || !Number.isInteger(manifest.createdAt) || !validDatabase(manifest.database) || !Array.isArray(manifest.objects)
    || manifest.objects.some((object) => !validObject(object))) throw new Error("Workspace backup manifest is invalid.");
  return manifest as BackupManifest;
}

function validDatabase(value: unknown): value is BackupManifest["database"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const database = value as Record<string, unknown>;
  return database.fileName === "ainovr.sqlite3" && typeof database.sha256 === "string" && SHA256.test(database.sha256)
    && Number.isInteger(database.byteLength) && (database.byteLength as number) >= 0;
}

function validObject(value: unknown): value is BackupObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return typeof object.sha256 === "string" && SHA256.test(object.sha256)
    && Number.isInteger(object.byteLength) && (object.byteLength as number) >= 0
    && typeof object.mediaType === "string" && Boolean(object.mediaType.trim())
    && typeof object.registered === "boolean";
}

async function copyVerifiedFile(source: string, destination: string, expectedHash: string, expectedByteLength: number): Promise<void> {
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error("Backup source must be a regular file.");
  const sourceIntegrity = await fileIntegrity(source);
  if (sourceIntegrity.sha256 !== expectedHash || sourceIntegrity.byteLength !== expectedByteLength) throw new Error("Backup source integrity verification failed.");
  await copyFile(source, destination);
  const destinationIntegrity = await fileIntegrity(destination);
  if (destinationIntegrity.sha256 !== expectedHash || destinationIntegrity.byteLength !== expectedByteLength) throw new Error("Backup destination integrity verification failed.");
}

async function fileIntegrity(filePath: string): Promise<{ sha256: string; byteLength: number }> {
  const content = await readFile(filePath);
  const info = await stat(filePath);
  if (!info.isFile() || content.byteLength !== info.size) throw new Error("Backup integrity check requires a stable regular file.");
  return { sha256: createHash("sha256").update(content).digest("hex"), byteLength: content.byteLength };
}

async function verifyRestoredDatabase(databasePath: string, objects: BackupObject[]): Promise<void> {
  const database = new Database(databasePath, { readonly: true });
  try {
    const rows = database.prepare("SELECT sha256, byte_length FROM objects ORDER BY sha256 ASC").all() as Array<{ sha256: string; byte_length: number }>;
    const expected = new Map(objects.filter((object) => object.registered).map((object) => [object.sha256, object.byteLength]));
    for (const row of rows) {
      if (expected.get(row.sha256) !== row.byte_length) throw new Error("Restored database object references do not match the backup manifest.");
      expected.delete(row.sha256);
    }
    if (expected.size) throw new Error("Restored database is missing object references from the backup manifest.");
  } finally {
    database.close();
  }
}

function randomSuffix(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("Current host does not support secure backup identifiers.");
  return globalThis.crypto.randomUUID();
}
