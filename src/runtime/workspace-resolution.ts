import path from "node:path";

export interface WorkspaceResolutionInput {
  args: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
}

/** Resolves the one workspace shared by the desktop sidecar, CLI, and stdio MCP. */
export function resolveWorkspacePath(input: WorkspaceResolutionInput): string {
  const explicit = workspaceArgument(input.args);
  if (explicit !== undefined) return path.resolve(input.cwd, explicit);

  const environmentWorkspace = input.env.AINOVR_WORKSPACE?.trim();
  if (environmentWorkspace) return path.resolve(input.cwd, environmentWorkspace);

  const appData = input.env.APPDATA?.trim();
  if (!appData) throw new Error("无法解析 Ainovr 工作区：未提供 --workspace、AINOVR_WORKSPACE 或 APPDATA。");
  return path.resolve(appData, "com.ainovr.app");
}

function workspaceArgument(args: readonly string[]): string | undefined {
  const index = args.indexOf("--workspace");
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value?.trim()) throw new Error("--workspace 必须提供非空目录。");
  return value.trim();
}
