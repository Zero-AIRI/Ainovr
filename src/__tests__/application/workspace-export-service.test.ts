import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createWorkspaceExportService } from "@/application/workspace-export-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver, type NodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createNodeWorkspaceExportRepository } from "@/persistence/node-workspace-export";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";

describe("工作区安全导出任务", () => {
  let workspacePath: string;
  let driver: NodeSqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-workspace-export-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("导出项目正文和安全分析索引，但绝不复制 settings 或参考原文", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const objects = await createNodeObjectStore({ workspacePath });
    const application = createWorkspaceApplicationService({ driver, schemas, objects });
    const tasks = createTaskRunner(driver);
    await application.commands.execute({
      schemaVersion: 1, commandId: "export_project", idempotencyKey: "export_project", correlationId: "export_project", actor: { kind: "human", id: "test" },
      tool: "create_novel_project", args: { projectId: "project-export", title: "导出测试作品", status: "planning", payload: { schema_version: 1 } }, createdAt: Date.now(),
    });
    const body = await objects.put({ content: new TextEncoder().encode("这是可以导出的原创正文。"), mediaType: "text/plain; charset=utf-8" });
    await application.commands.execute({
      schemaVersion: 1, commandId: "export_document", idempotencyKey: "export_document", correlationId: "export_document", actor: { kind: "human", id: "test" }, projectId: "project-export",
      tool: "commit_project_planning_document", args: { projectId: "project-export", documentId: "draft-export", documentType: "local_creation_draft", status: "draft", expectedRevision: null, payload: { schema_version: 1, kind: "local_creation_draft", title: "正文草稿" }, contentObject: body }, createdAt: Date.now(),
    });
    await writeFile(path.join(workspacePath, "data", "settings.json"), '{"apiKey":"export-secret-sentinel"}', "utf8");
    const references = createReferenceImportService({ driver, commands: application.commands, objects });
    await references.importText({
      command: { schemaVersion: 1, commandId: "export_reference", idempotencyKey: "export_reference", correlationId: "export_reference", actor: { kind: "human", id: "test" }, createdAt: Date.now() },
      referenceWorkId: "reference-export", sourceEditionId: "edition-export", title: "参考书", text: "不可出现在分析导出包中的参考原文。",
    });
    const exports = createWorkspaceExportService({
      commands: application.commands,
      queries: application.queries,
      tasks,
      objects,
      repository: createNodeWorkspaceExportRepository({ workspacePath }),
      hostId: "export-test-host",
    });

    await exports.startProjectExport({ command: commandBase("project"), taskId: "task_project_export", projectId: "project-export", exportId: "project-export-001" });
    await exports.run("task_project_export");
    await expect(exports.getTask("task_project_export")).resolves.toMatchObject({ status: "succeeded" });
    const projectBundle = await readFile(path.join(workspacePath, "data", "exports", "project-project-export-001", "bundle.json"), "utf8");
    expect(projectBundle).toContain("这是可以导出的原创正文。");
    expect(projectBundle).not.toContain("export-secret-sentinel");
    await expect(access(path.join(workspacePath, "data", "exports", "project-project-export-001", "settings.json"))).rejects.toThrow();

    await exports.startAnalysisExport({ command: commandBase("analysis"), taskId: "task_analysis_export", referenceWorkId: "reference-export", exportId: "analysis-export-001" });
    await exports.run("task_analysis_export");
    await expect(exports.getTask("task_analysis_export")).resolves.toMatchObject({ status: "succeeded" });
    const analysisBundle = await readFile(path.join(workspacePath, "data", "exports", "analysis-analysis-export-001", "bundle.json"), "utf8");
    expect(analysisBundle).toContain("reference-export");
    expect(analysisBundle).not.toContain("不可出现在分析导出包中的参考原文");
  });

  it("发现疑似 Secret 时拒绝导出且不留下最终目录", async () => {
    const repository = createNodeWorkspaceExportRepository({ workspacePath });
    await expect(repository.write({
      kind: "project", exportId: "unsafe-export", bundle: { apiKey: "should-not-export" },
    })).rejects.toThrow(/secret/i);
    await expect(access(path.join(workspacePath, "data", "exports", "project-unsafe-export"))).rejects.toThrow();
  });
});

function commandBase(id: string) {
  return {
    schemaVersion: 1 as const,
    commandId: `command_export_${id}`,
    idempotencyKey: `idempotency_export_${id}`,
    correlationId: `correlation_export_${id}`,
    actor: { kind: "human" as const, id: "test" },
    createdAt: Date.now(),
  };
}
