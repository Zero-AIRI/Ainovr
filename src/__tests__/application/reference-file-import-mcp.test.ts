import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createReferenceFileImportService } from "@/application/reference-file-import-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver, type NodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";

describe("参考文件导入 MCP 入口", () => {
  let workspacePath: string;
  let externalPath: string;
  let driver: NodeSqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-reference-file-mcp-"));
    externalPath = await mkdtemp(path.join(tmpdir(), "ainovr-reference-file-mcp-source-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await Promise.all([rm(workspacePath, { recursive: true, force: true }), rm(externalPath, { recursive: true, force: true })]);
  });

  it("公开确认门控请求与恢复工具，并以 human_via_agent 批准后完成导入", async () => {
    const sourcePath = path.join(externalPath, "book.txt");
    const text = "MCP 参考文本\n只在批准后读取。";
    await writeFile(sourcePath, text, "utf8");
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const objects = await createNodeObjectStore({ workspacePath });
    const application = createWorkspaceApplicationService({ driver, schemas, objects });
    const tasks = createTaskRunner(driver);
    const references = createReferenceImportService({ driver, commands: application.commands, objects });
    const files = createReferenceFileImportService({ commands: application.commands, tasks, objects, references, hostId: "mcp-reference-file-test" });
    const handler = createApplicationMcpJsonRpcHandler({ application, tasks, references, referenceFileImport: files });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const toolList = (listed?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(toolList).toEqual(expect.arrayContaining(["request_reference_file_import", "resume_reference_file_import"]));

    const requested = await handler({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "request_reference_file_import", arguments: { commandId: "mcp_file_cmd", idempotencyKey: "mcp_file_idem", correlationId: "mcp_file_corr", taskId: "mcp_file_task", referenceWorkId: "mcp_file_work", sourceEditionId: "mcp_file_edition", title: "MCP 文件", sourcePath } },
    });
    const pending = (requested?.result as { structuredContent: { kind: string; confirmationId: string } }).structuredContent;
    expect(pending).toMatchObject({ kind: "needs_confirmation", risk: "reference_file_import" });
    await expect(tasks.get("mcp_file_task")).resolves.toBeNull();
    await expect(readFile(sourcePath, "utf8")).resolves.toBe(text);

    const approved = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "approve_confirmation", arguments: { confirmationId: pending.confirmationId, reason: "确认读取该绝对路径下的 UTF-8 参考文本。" } } });
    expect((approved?.result as { structuredContent: unknown }).structuredContent).toEqual({ kind: "accepted", taskId: "mcp_file_task" });
    await handler({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "resume_reference_file_import", arguments: { taskId: "mcp_file_task" } } });
    await expect(tasks.wait("mcp_file_task", 30_000)).resolves.toMatchObject({ status: "succeeded" });
    await expect(references.getReferenceWork("mcp_file_work")).resolves.toMatchObject({ sourceEditionId: "mcp_file_edition" });

    const located = await handler({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "find_source_text", arguments: { sourceEditionId: "mcp_file_edition", query: "批准后" } } });
    expect((located?.result as { structuredContent: unknown }).structuredContent).toEqual([{ startByte: new TextEncoder().encode("MCP 参考文本\n只在").byteLength, endByte: new TextEncoder().encode("MCP 参考文本\n只在批准后").byteLength }]);
  });
});
