import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "@/runtime/workspace-resolution";

describe("workspace resolution", () => {
  const cwd = path.join(path.parse(process.cwd()).root, "work", "ainovr");
  const appData = path.join(path.parse(process.cwd()).root, "Users", "author", "AppData", "Roaming");

  it("uses an explicit --workspace before environment and AppData", () => {
    expect(resolveWorkspacePath({ args: ["--workspace", "portable/../novel"], env: { AINOVR_WORKSPACE: "environment-workspace", APPDATA: appData }, cwd }))
      .toBe(path.resolve(cwd, "novel"));
  });

  it("uses AINOVR_WORKSPACE when --workspace is absent", () => {
    expect(resolveWorkspacePath({ args: [], env: { AINOVR_WORKSPACE: "environment-workspace", APPDATA: appData }, cwd }))
      .toBe(path.resolve(cwd, "environment-workspace"));
  });

  it("uses the release AppData workspace when no explicit workspace is configured", () => {
    expect(resolveWorkspacePath({ args: [], env: { APPDATA: appData }, cwd }))
      .toBe(path.join(appData, "com.ainovr.app"));
  });

  it("rejects empty --workspace values instead of silently selecting another workspace", () => {
    expect(() => resolveWorkspacePath({ args: ["--workspace", "  "], env: { AINOVR_WORKSPACE: "environment-workspace", APPDATA: appData }, cwd }))
      .toThrow(/--workspace/i);
  });

  it("rejects a missing --workspace value", () => {
    expect(() => resolveWorkspacePath({ args: ["--workspace"], env: { APPDATA: appData }, cwd }))
      .toThrow(/--workspace/i);
  });

  it("rejects startup when AppData cannot be resolved", () => {
    expect(() => resolveWorkspacePath({ args: [], env: {}, cwd })).toThrow(/APPDATA/i);
  });
});
