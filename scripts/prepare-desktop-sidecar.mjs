import { cp, mkdir, rm, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "src-tauri", "resources", "desktop-sidecar");
const companion = path.join(root, "dist-mcp", "ainovr-mcp.mjs");
const packages = ["better-sqlite3", "node-addon-api"];

await assertFile(companion, "请先运行 npm run build:mcp。");
await assertFile(process.execPath, "当前 Node runtime 不可用。");
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "node_modules"), { recursive: true });
await copyFile(companion, path.join(output, "ainovr-mcp.mjs"));
await copyFile(process.execPath, path.join(output, "node.exe"));
for (const packageName of packages) {
  const source = path.join(root, "node_modules", packageName);
  await assertDirectory(source, `缺少运行时依赖 ${packageName}；请先运行 npm ci。`);
  await cp(source, path.join(output, "node_modules", packageName), { recursive: true });
}

async function assertFile(target, message) {
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) throw new Error(message);
}

async function assertDirectory(target, message) {
  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory()) throw new Error(message);
}
