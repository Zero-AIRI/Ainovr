import type { WorkspaceSettingsView } from "@/application/workspace-application-service";

/**
 * manual 只创建可观察、可恢复的 queued Task；显式 resume 始终允许执行。
 * supervised 与 autonomous 都可自动启动普通任务，但正式 Commit 和高风险命令
 * 继续由持久 confirmation 决定，不能由自动化模式绕过。
 */
export function shouldAutoStartTask(mode: WorkspaceSettingsView["automationMode"]): boolean {
  return mode !== "manual";
}
