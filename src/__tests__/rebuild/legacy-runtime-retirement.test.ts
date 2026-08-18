import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R8 清理红线：旧运行时已从公开树移除，不能继续作为活动 src 的一部分。
 * 这些路径是 JSON Store、自由画布、内置 Assistant 与 Zustand 业务真相的入口，
 * 与最终 Application Service / SQLite 产品边界不兼容。
 */
const retiredActivePaths = [
  "src/engine/assistant",
  "src/engine/system-model",
  "src/store",
  "src/components/canvas",
  "src/components/workspace",
  "src/components/analysis",
  "src/components/works",
  "src/lib/file-json-store.ts",
  "src/lib/data-file-paths.ts",
  "src/runtime/runtime-wiring.ts",
  "src/runtime/tauri-blueprint-store.ts",
  "src/runtime/tauri-fs.ts",
] as const;

describe("R8 活动运行时清理", () => {
  it("不再在 src 内保留旧 JSON / Assistant / Zustand 业务入口", () => {
    const remaining = retiredActivePaths.filter((relativePath) => containsSourceFile(resolve(process.cwd(), relativePath)));
    expect(remaining).toEqual([]);
  });

  it("公开基线不再携带 legacy 快照或旧安装器", () => {
    expect(existsSync(resolve(process.cwd(), "archive"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "Ainovr.previous.exe"))).toBe(false);
  });

  it("不再把已退役的画布和业务 Store 声明为活动运行时依赖", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies).not.toHaveProperty("@xyflow/react");
    expect(packageJson.dependencies).not.toHaveProperty("zustand");
  });
});

/** 空目录不是活动源码；归档移动后的残留目录由版本控制自然忽略。 */
function containsSourceFile(path: string): boolean {
  if (!existsSync(path)) return false;
  if (statSync(path).isFile()) return true;
  const pending = [path];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = resolve(current, entry.name);
      if (entry.isFile()) return true;
      if (entry.isDirectory()) pending.push(target);
    }
  }
  return false;
}
