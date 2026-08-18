import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createChapterWriterService } from "@/application/chapter-writer-service";
import { createChapterContextManifestService, type WriterContextManifest } from "@/application/chapter-context-manifest-service";
import { createLocalCreationService } from "@/application/local-creation-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterWriter Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-chapter-writer-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });
  afterEach(async () => { await driver?.close(); await rm(workspacePath, { recursive: true, force: true }); });

  it("仅使用已冻结的 Writer Manifest 组织本地模型 V1 草稿，完整 Prompt 不进审计", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const objects = await createNodeObjectStore({ workspacePath });
    const tasks = createTaskRunner(driver, { now: () => 1_700_000_000_000 });
    const local = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks, objects, hostId: "writer-test", now: () => 1_700_000_000_000,
      caller: { complete: async () => ({ text: "潮水退去，钟楼的指针开始倒走。", finishReason: "stop" }) },
    });
    const manifest: WriterContextManifest = {
      schema_version: 1, kind: "chapter_context_manifest", manifestId: "manifest_001", projectId: "project_001", chapterId: "chapter_001", taskRole: "writer", conversationHistory: [], tokenBudget: 4096, reservedOutputTokens: 1024, tokenEstimate: 128,
      layers: [
        { name: "chapter_contract", required: true, documentIds: ["planning:chapter_contract:chapter_001"], value: { desire: "确认信件来源" } },
        { name: "story_contract_and_system", required: true, documentIds: ["planning:story_contract", "planning:story_system"], value: {} },
        { name: "canon_and_character", required: false, documentIds: [], value: {} },
        { name: "recent_accepted_text", required: false, documentIds: [], value: {} },
        { name: "reader_state_and_promises", required: false, documentIds: [], value: {} },
        { name: "creative_recipe", required: true, documentIds: ["production:creative_recipe:chapter_001"], value: { writerMechanisms: [] } },
      ],
    };
    const manifests: Pick<ReturnType<typeof createChapterContextManifestService>, "get"> = { get: async () => manifest };
    const writer = createChapterWriterService({ local, manifests });

    await expect(writer.start({ command: command("writer_uncontrolled"), taskId: "writer_task_uncontrolled", documentId: "draft_arbitrary", projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", title: "第一章 V1", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048 }))
      .rejects.toThrow(/V1|受控|文档/);
    await expect(writer.start({ command: command("writer"), taskId: "writer_task_001", documentId: "production:chapter_draft:chapter_001:v1", projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", title: "第一章 V1", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048 }))
      .resolves.toEqual({ kind: "accepted", taskId: "writer_task_001" });
    await expect(writer.run("writer_task_001")).resolves.toMatchObject({ status: "succeeded" });
    await expect(writer.getDraft({ documentId: "production:chapter_draft:chapter_001:v1" })).resolves.toMatchObject({ text: "潮水退去，钟楼的指针开始倒走。", manifestId: "manifest_001", chapterId: "chapter_001" });
    await expect(driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE command_id = 'command_writer'", params: [] }))
      .resolves.toEqual([expect.objectContaining({ args_json: expect.not.stringContaining("确认信件来源") })]);
    const handler = createApplicationMcpJsonRpcHandler({ application, writer });
    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["start_chapter_writer_v1", "resume_chapter_writer_v1", "get_chapter_writer_draft"]));
  });

  it("Manifest 不存在或不属于目标章节时拒绝启动 Writer", async () => {
    const manifests: Pick<ReturnType<typeof createChapterContextManifestService>, "get"> = { get: async () => null };
    const writer = createChapterWriterService({ local: {} as ReturnType<typeof createLocalCreationService>, manifests });
    await expect(writer.start({ command: command("missing"), taskId: "task", documentId: "doc", projectId: "project_001", chapterId: "chapter_001", manifestId: "missing", title: "V1", baseURL: "http://localhost:11434/v1", model: "qwen3:8b" }))
      .rejects.toThrow(/Manifest/);
  });
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
