import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReferenceFileImportService } from "@/application/reference-file-import-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver, type NodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";

describe("确认门控的参考文件导入", () => {
  let workspacePath: string;
  let externalPath: string;
  let driver: NodeSqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-reference-file-workspace-"));
    externalPath = await mkdtemp(path.join(tmpdir(), "ainovr-reference-file-source-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await Promise.all([rm(workspacePath, { recursive: true, force: true }), rm(externalPath, { recursive: true, force: true })]);
  });

  it("在批准前不读取外部文件，批准后以同一导入事务写入对象库并完成任务", async () => {
    const sourcePath = path.join(externalPath, "reference.txt");
    const sourceText = "第一章\n这是只应在确认后读取的测试参考原文。";
    await writeFile(sourcePath, sourceText, "utf8");
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const objects = await createNodeObjectStore({ workspacePath });
    const application = createWorkspaceApplicationService({ driver, schemas });
    const tasks = createTaskRunner(driver);
    const references = createReferenceImportService({ driver, commands: application.commands, objects });
    const files = createReferenceFileImportService({ commands: application.commands, tasks, objects, references, hostId: "reference-file-test" });

    const requested = await files.start({
      command: commandBase(), taskId: "task_reference_file_001", referenceWorkId: "reference_file_001", sourceEditionId: "edition_file_001", title: "测试参考", sourcePath,
    });
    expect(requested).toMatchObject({ kind: "needs_confirmation", risk: "reference_file_import" });
    await expect(references.getReferenceWork("reference_file_001")).resolves.toBeNull();
    await expect(files.getTask("task_reference_file_001")).resolves.toBeNull();
    await expect(readFile(sourcePath, "utf8")).resolves.toBe(sourceText);

    if (requested.kind !== "needs_confirmation") throw new Error("expected confirmation");
    await expect(application.commands.approveConfirmation({
      confirmationId: requested.confirmationId,
      actor: { kind: "human_via_agent", id: "test" },
      reason: "测试确认后的受控单文件导入。",
    })).resolves.toEqual({ kind: "accepted", taskId: "task_reference_file_001" });
    await files.run("task_reference_file_001");
    await expect(files.getTask("task_reference_file_001")).resolves.toMatchObject({ status: "succeeded" });
    await expect(references.getReferenceWork("reference_file_001")).resolves.toMatchObject({ sourceEditionId: "edition_file_001" });
    await expect(readFile(sourcePath, "utf8")).resolves.toBe(sourceText);
    const commandArgs = await driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE tool = 'import_reference_text'", params: [] });
    expect(commandArgs[0]?.args_json).not.toContain(sourceText);
  });

  it("拒绝非绝对路径、非 txt 文件和符号链接以避免退化为任意文件工具", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const objects = await createNodeObjectStore({ workspacePath });
    const application = createWorkspaceApplicationService({ driver, schemas });
    const files = createReferenceFileImportService({ commands: application.commands, tasks: createTaskRunner(driver), objects, references: createReferenceImportService({ driver, commands: application.commands, objects }), hostId: "reference-file-test" });
    await expect(files.start({ command: commandBase(), taskId: "task_relative", referenceWorkId: "reference_relative", sourceEditionId: "edition_relative", title: "相对路径", sourcePath: "reference.txt" })).rejects.toThrow(/absolute/i);
    const markdownPath = path.join(externalPath, "reference.md");
    await writeFile(markdownPath, "测试", "utf8");
    await expect(files.start({ command: commandBase("markdown"), taskId: "task_markdown", referenceWorkId: "reference_markdown", sourceEditionId: "edition_markdown", title: "非 txt", sourcePath: markdownPath })).rejects.toThrow(/\.txt/i);
  });
});

function commandBase(suffix = "base") {
  return {
    schemaVersion: 1 as const,
    commandId: `command_reference_file_${suffix}`,
    idempotencyKey: `idempotency_reference_file_${suffix}`,
    correlationId: `correlation_reference_file_${suffix}`,
    actor: { kind: "human" as const, id: "test" },
    createdAt: Date.now(),
  };
}
