import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SECRET_FIELD = /(?:api[_-]?key|secret|password|access[_-]?token)$/i;
const SECRET_VALUE = /\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{8,}\b/i;

export type WorkspaceExportKind = "project" | "analysis";

export interface WorkspaceExportView {
  exportId: string;
  kind: WorkspaceExportKind;
  directory: string;
  byteLength: number;
}

export interface NodeWorkspaceExportRepository {
  write(input: { kind: WorkspaceExportKind; exportId: string; bundle: Record<string, unknown> }): Promise<WorkspaceExportView>;
}

/**
 * 导出只允许落在当前工作区 `data/exports`，并在最终落盘前检测秘密字段。
 * 它不接触 settings.json，也不提供读取/写入任意路径的能力。
 */
export function createNodeWorkspaceExportRepository(input: { workspacePath: string; now?: () => number }): NodeWorkspaceExportRepository {
  const exportsPath = path.join(path.resolve(input.workspacePath), "data", "exports");
  const now = input.now ?? Date.now;

  return {
    async write({ kind, exportId, bundle }) {
      if (kind !== "project" && kind !== "analysis") throw new Error("export kind is invalid.");
      if (!IDENTIFIER.test(exportId)) throw new Error("exportId must use lowercase letters, digits, and hyphens only.");
      assertNoSecret(bundle);
      const directory = path.join(exportsPath, `${kind}-${exportId}`);
      const existing = await existingExport(directory, kind, exportId);
      if (existing) return existing;

      const staging = path.join(exportsPath, ".tmp", `${kind}-${exportId}-${randomSuffix()}`);
      try {
        await mkdir(staging, { recursive: true });
        const payload = { schemaVersion: 1, kind: `ainovr_${kind}_export`, exportId, exportedAt: now(), bundle };
        const text = `${JSON.stringify(payload, null, 2)}\n`;
        assertNoSecret(payload);
        await writeFile(path.join(staging, "bundle.json"), text, "utf8");
        const byteLength = Buffer.byteLength(text, "utf8");
        const manifest = { schemaVersion: 1, kind, exportId, byteLength, sha256: createHash("sha256").update(text).digest("hex") };
        await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        await mkdir(exportsPath, { recursive: true });
        await rename(staging, directory);
        return { exportId, kind, directory, byteLength };
      } catch (cause) {
        await rm(staging, { recursive: true, force: true });
        throw cause;
      }
    },
  };
}

async function existingExport(directory: string, kind: WorkspaceExportKind, exportId: string): Promise<WorkspaceExportView | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as Record<string, unknown>;
    const bundle = await readFile(path.join(directory, "bundle.json"), "utf8");
    const byteLength = Buffer.byteLength(bundle, "utf8");
    if (manifest.schemaVersion !== 1 || manifest.kind !== kind || manifest.exportId !== exportId
      || manifest.byteLength !== byteLength || manifest.sha256 !== createHash("sha256").update(bundle).digest("hex")) {
      throw new Error("Existing export integrity validation failed.");
    }
    return { exportId, kind, directory, byteLength };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

function assertNoSecret(value: unknown, trail = "bundle"): void {
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) throw new Error(`Secret-like value detected in ${trail}; export was refused.`);
    if (/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(value)) throw new Error(`Bearer credential detected in ${trail}; export was refused.`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecret(item, `${trail}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(key)) throw new Error(`Secret-like field ${key} detected in ${trail}; export was refused.`);
    assertNoSecret(item, `${trail}.${key}`);
  }
}

function randomSuffix(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("Current host does not support secure export identifiers.");
  return globalThis.crypto.randomUUID();
}
