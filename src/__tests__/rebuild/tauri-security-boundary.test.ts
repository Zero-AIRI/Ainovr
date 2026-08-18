import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Tauri desktop security boundary", () => {
  it("does not grant generic filesystem, network, clipboard, dialog, opener, or raw database RPC access", async () => {
    const [capabilities, config, cargo, packageJson, rust, desktopRuntime] = await Promise.all([
      readFile(path.resolve("src-tauri/capabilities/default.json"), "utf8"),
      readFile(path.resolve("src-tauri/tauri.conf.json"), "utf8"),
      readFile(path.resolve("src-tauri/Cargo.toml"), "utf8"),
      readFile(path.resolve("package.json"), "utf8"),
      readFile(path.resolve("src-tauri/src/lib.rs"), "utf8"),
      readFile(path.resolve("src/runtime/desktop-workspace-application.ts"), "utf8"),
    ]);
    expect(capabilities).toContain('"core:default"');
    expect(capabilities).not.toMatch(/(?:fs:|http:|clipboard-manager:|dialog:|opener:)/);
    expect(config).toContain("connect-src 'self' http://localhost:*");
    expect(config).not.toContain(" https:");
    expect(cargo).not.toMatch(/tauri-plugin-(?:clipboard-manager|dialog|opener)/);
    expect(packageJson).not.toMatch(/@tauri-apps\/plugin-(?:clipboard-manager|dialog|opener)/);
    expect(rust).toContain("generate_handler![desktop_mcp_request]");
    expect(rust).not.toMatch(/generate_handler!\[[^\]]*(?:sql_query|sql_execute|sql_transaction|object_read)/);
    expect(desktopRuntime).toContain('"desktop_mcp_request"');
    expect(desktopRuntime).not.toMatch(/createTauriSqlDriver|createTauriObjectReader|(?:"sql_query"|"sql_execute"|"sql_transaction"|"object_read")/);
  });
});
