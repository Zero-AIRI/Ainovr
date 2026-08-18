import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createWorkspaceMaintenanceService } from "@/application/workspace-maintenance-service";
import { createWorkspaceExportService } from "@/application/workspace-export-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver, type NodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createNodeWorkspaceBackupRepository } from "@/persistence/node-workspace-backup";
import { createNodeWorkspaceExportRepository } from "@/persistence/node-workspace-export";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";

describe("工作区维护 MCP 工具", () => {
  let workspacePath: string;
  let driver: NodeSqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-workspace-maintenance-mcp-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("只公开固定标识的备份与恢复工具，并在恢复前持久确认", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const tasks = createTaskRunner(driver);
    const maintenance = createWorkspaceMaintenanceService({
      commands: application.commands,
      tasks,
      objects: await createNodeObjectStore({ workspacePath }),
      backups: createNodeWorkspaceBackupRepository({ workspacePath, driver }),
      hostId: "mcp-maintenance-test",
    });
    const handler = createApplicationMcpJsonRpcHandler({ application, tasks, maintenance });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = ((listed?.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> }).tools);
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["create_workspace_backup", "restore_workspace_backup", "resume_workspace_maintenance"]));
    expect(tools.find((tool) => tool.name === "restore_workspace_backup")?.inputSchema.properties).not.toHaveProperty("path");

    const backup = await handler({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "create_workspace_backup", arguments: { commandId: "mcp_backup_command", idempotencyKey: "mcp_backup_idem", correlationId: "mcp_backup_correlation", taskId: "mcp_backup_task", backupId: "backup-mcp-001" } },
    });
    expect((backup?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "accepted", taskId: "mcp_backup_task" });
    await expect(tasks.wait("mcp_backup_task", 30_000)).resolves.toMatchObject({ status: "succeeded" });

    const requested = await handler({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "restore_workspace_backup", arguments: { commandId: "mcp_restore_command", idempotencyKey: "mcp_restore_idem", correlationId: "mcp_restore_correlation", taskId: "mcp_restore_task", backupId: "backup-mcp-001", restoreId: "restore-mcp-001" } },
    });
    const requestedContent = (requested?.result as { structuredContent: { kind: string; confirmationId: string } }).structuredContent;
    expect(requestedContent).toMatchObject({ kind: "needs_confirmation" });
    const approved = await handler({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "approve_confirmation", arguments: { confirmationId: requestedContent.confirmationId, reason: "确认恢复到新的受控空目录。" } } });
    expect((approved?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "accepted", taskId: "mcp_restore_task" });
    await handler({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "resume_workspace_maintenance", arguments: { taskId: "mcp_restore_task" } } });
    await expect(tasks.wait("mcp_restore_task", 30_000)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("以领域 MCP 工具导出项目，不暴露导出路径参数", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const objects = await createNodeObjectStore({ workspacePath });
    const application = createWorkspaceApplicationService({ driver, schemas, objects });
    await application.commands.execute({
      schemaVersion: 1, commandId: "mcp_export_project", idempotencyKey: "mcp_export_project", correlationId: "mcp_export_project", actor: { kind: "human", id: "test" },
      tool: "create_novel_project", args: { projectId: "project-mcp-export", title: "MCP 导出", status: "planning", payload: { schema_version: 1 } }, createdAt: Date.now(),
    });
    const tasks = createTaskRunner(driver);
    const exporter = createWorkspaceExportService({
      commands: application.commands,
      queries: application.queries,
      tasks,
      objects,
      repository: createNodeWorkspaceExportRepository({ workspacePath }),
      hostId: "mcp-export-test",
    });
    const handler = createApplicationMcpJsonRpcHandler({ application, tasks, exporter });

    const listed = await handler({ jsonrpc: "2.0", id: 10, method: "tools/list" });
    const tools = ((listed?.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> }).tools);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["export_project", "export_analysis", "resume_workspace_export"]));
    expect(tools.find((tool) => tool.name === "export_project")?.inputSchema.properties).not.toHaveProperty("path");

    const started = await handler({
      jsonrpc: "2.0", id: 11, method: "tools/call",
      params: { name: "export_project", arguments: { commandId: "mcp_export_command", idempotencyKey: "mcp_export_idem", correlationId: "mcp_export_correlation", taskId: "mcp_export_task", projectId: "project-mcp-export", exportId: "mcp-export-001" } },
    });
    expect((started?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "accepted", taskId: "mcp_export_task" });
    await expect(tasks.wait("mcp_export_task", 30_000)).resolves.toMatchObject({ status: "succeeded" });
  });
});
