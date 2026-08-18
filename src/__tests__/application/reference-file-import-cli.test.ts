import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReferenceFileImportService } from "@/application/reference-file-import-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { executeWorkspaceCli } from "@/cli/workspace-cli";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver, type NodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";

describe("参考文件导入 CLI 入口", () => {
  let workspacePath: string;
  let externalPath: string;
  let driver: NodeSqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-reference-file-cli-"));
    externalPath = await mkdtemp(path.join(tmpdir(), "ainovr-reference-file-cli-source-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await Promise.all([rm(workspacePath, { recursive: true, force: true }), rm(externalPath, { recursive: true, force: true })]);
  });

  it("请求阶段只返回确认，批准后 resume 命令完成领域导入", async () => {
    const sourcePath = path.join(externalPath, "cli.txt");
    await writeFile(sourcePath, "CLI 文件导入。", "utf8");
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const objects = await createNodeObjectStore({ workspacePath });
    const application = createWorkspaceApplicationService({ driver, schemas, objects });
    const tasks = createTaskRunner(driver);
    const references = createReferenceImportService({ driver, commands: application.commands, objects });
    const referenceFileImport = createReferenceFileImportService({ commands: application.commands, tasks, objects, references, hostId: "cli-reference-file-test" });
    const args = { commandId: "cli_file_cmd", idempotencyKey: "cli_file_idem", correlationId: "cli_file_corr", taskId: "cli_file_task", referenceWorkId: "cli_file_work", sourceEditionId: "cli_file_edition", title: "CLI 文件", sourcePath };

    const requested = await executeWorkspaceCli(application, "import-reference-file", args, { references, referenceFileImport }) as { kind: "needs_confirmation"; confirmationId: string; risk: string };
    expect(requested).toMatchObject({ kind: "needs_confirmation", risk: "reference_file_import" });
    if (requested.kind !== "needs_confirmation") throw new Error("expected confirmation");
    await expect(application.commands.approveConfirmation({ confirmationId: requested.confirmationId, actor: { kind: "human", id: "cli-test" }, reason: "确认导入该文件。" })).resolves.toEqual({ kind: "accepted", taskId: "cli_file_task" });
    await expect(executeWorkspaceCli(application, "resume-reference-file-import", { taskId: "cli_file_task" }, { references, referenceFileImport })).resolves.toMatchObject({ status: "succeeded" });
    await expect(references.getReferenceWork("cli_file_work")).resolves.toMatchObject({ sourceEditionId: "cli_file_edition" });
  });
});
