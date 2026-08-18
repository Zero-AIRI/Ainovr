import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createWorkspaceMaintenanceService } from "@/application/workspace-maintenance-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver, type NodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createNodeWorkspaceBackupRepository } from "@/persistence/node-workspace-backup";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";

describe("工作区维护任务", () => {
  let workspacePath: string;
  let driver: NodeSqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-workspace-maintenance-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("由 CommandService 建立备份任务，并将恢复操作置于持久确认之后", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const tasks = createTaskRunner(driver);
    await writeFile(path.join(workspacePath, "data", "settings.json"), '{"apiKey":"maintenance-test-secret"}', "utf8");
    const maintenance = createWorkspaceMaintenanceService({
      commands: application.commands,
      tasks,
      objects: await createNodeObjectStore({ workspacePath }),
      backups: createNodeWorkspaceBackupRepository({ workspacePath, driver }),
      hostId: "maintenance-test-host",
    });

    await expect(maintenance.startBackup({
      command: commandBase("backup"),
      taskId: "task_backup_001",
      backupId: "backup-001",
    })).resolves.toEqual({ kind: "accepted", taskId: "task_backup_001" });
    await maintenance.run("task_backup_001");
    await expect(maintenance.getTask("task_backup_001")).resolves.toMatchObject({ status: "succeeded" });

    const restore = await maintenance.startRestore({
      command: commandBase("restore"),
      taskId: "task_restore_001",
      backupId: "backup-001",
      restoreId: "restore-001",
    });
    expect(restore).toMatchObject({ kind: "needs_confirmation", risk: "workspace_restore" });
    if (restore.kind !== "needs_confirmation") throw new Error("expected confirmation");
    await expect(application.commands.approveConfirmation({
      confirmationId: restore.confirmationId,
      actor: { kind: "human_via_agent", id: "test" },
      reason: "在新的受控空目录验证备份可恢复。",
    })).resolves.toEqual({ kind: "accepted", taskId: "task_restore_001" });
    await maintenance.run("task_restore_001");
    await expect(maintenance.getTask("task_restore_001")).resolves.toMatchObject({ status: "succeeded" });
    await expect(access(path.join(workspacePath, "data", "restores", "restore-001", "data", "settings.json"))).rejects.toThrow();

    const commandArgs = await driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands ORDER BY created_at, command_id", params: [] });
    expect(JSON.stringify(commandArgs)).not.toContain("maintenance-test-secret");
  });
});

function commandBase(id: string) {
  return {
    schemaVersion: 1 as const,
    commandId: `command_${id}`,
    idempotencyKey: `idempotency_${id}`,
    correlationId: `correlation_${id}`,
    actor: { kind: "human" as const, id: "test" },
    createdAt: Date.now(),
  };
}
