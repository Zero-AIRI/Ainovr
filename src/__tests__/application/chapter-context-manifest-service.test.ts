import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createChapterContextManifestService } from "@/application/chapter-context-manifest-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ChapterContextManifest Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-chapter-manifest-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });
  afterEach(async () => { await driver?.close(); await rm(workspacePath, { recursive: true, force: true }); });

  it("冻结 Writer 六层上下文，只选显式允许的原创资产且不带入无关参考内容", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    await saveDocument(application, "story_contract", "planning:project_001:story_contract", { corePromise: "异常必有代价", centralConflict: "守钟还是开门", endingDirection: "承担选择", immutableBoundaries: ["不解释为梦"] });
    await saveDocument(application, "story_system", "planning:project_001:story_system", { worldRules: ["钟只倒走七分钟"], characterSystem: ["林霁只能依据证据行动"], causalityRules: ["每个异常留下代价"], informationRules: ["解释不得早于异常"] });
    await saveDocument(application, "chapter_contract", "planning:project_001:chapter_contract:chapter_001", { chapterId: "chapter_001", ordinal: 1, entryState: ["林霁不知道信的来源"], exitState: ["林霁决定进入钟楼"], desire: "确认信件来源", pressure: "潮水上涨", turningPoint: "指针倒转", mustNotHappen: ["不揭示全部真相"], readerPromiseAction: "establish", emotionalCycle: "迟疑转为承担", nextChapterInterface: ["钟楼内部线索"], mechanismCardIds: [] });
    await saveDocument(application, "creative_recipe", "production:creative_recipe:chapter_001", { chapterId: "chapter_001", chapterContractRevision: 1, mechanismCardIds: [], writerMechanisms: [], editorMechanisms: [] });
    await saveDocument(application, "untrusted_reference_copy", "other:reference", { title: "禁泄漏参考名", text: "任何 Writer 都不能看到这段内容" });
    const manifests = createChapterContextManifestService({ driver, commands: application.commands, objects });

    await expect(manifests.freeze({ command: command("manifest"), projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_001", tokenBudget: 4096, reservedOutputTokens: 1024 }))
      .resolves.toMatchObject({ kind: "ok", revision: 1 });
    const manifest = await manifests.get({ projectId: "project_001", manifestId: "manifest_001" });
    expect(manifest).toMatchObject({ projectId: "project_001", chapterId: "chapter_001", taskRole: "writer", conversationHistory: [] });
    expect(manifest?.layers.map((layer) => layer.name)).toEqual([
      "chapter_contract", "story_contract_and_system", "canon_and_character", "recent_accepted_text", "reader_state_and_promises", "creative_recipe",
    ]);
    expect(JSON.stringify(manifest)).not.toContain("禁泄漏参考名");
  });

  it("缺少必需的 StoryContract、StorySystem、ChapterContract 或 CreativeRecipe 时 fail closed", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_missing"), tool: "create_novel_project", args: { projectId: "project_missing", title: "缺失输入", status: "planning", payload: { schema_version: 1 } } });
    const manifests = createChapterContextManifestService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });

    await expect(manifests.freeze({ command: command("manifest_missing"), projectId: "project_missing", chapterId: "chapter_001", manifestId: "manifest_missing", tokenBudget: 4096, reservedOutputTokens: 1024 }))
      .rejects.toThrow(/ChapterContract|StoryContract|StorySystem|CreativeRecipe/);
  });

  it("规划或 Canon 等 Writer 层携带参考侧字段时拒绝冻结", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    await application.commands.execute({ ...command("project_tainted"), tool: "create_novel_project", args: { projectId: "project_001", title: "隔离测试", status: "planning", payload: { schema_version: 1 } } });
    await saveDocument(application, "story_contract", "planning:project_001:story_contract", { corePromise: "承诺", centralConflict: "冲突", endingDirection: "结局", immutableBoundaries: ["边界"], referenceTitle: "不应进入 Writer 的参考书" });
    await saveDocument(application, "story_system", "planning:project_001:story_system", { worldRules: ["规则"], characterSystem: ["人物"], causalityRules: ["因果"], informationRules: ["信息"] });
    await saveDocument(application, "chapter_contract", "planning:project_001:chapter_contract:chapter_001", { chapterId: "chapter_001", ordinal: 1, entryState: ["进入"], exitState: ["离开"], desire: "目标", pressure: "压力", turningPoint: "转折", mustNotHappen: [], readerPromiseAction: "establish", emotionalCycle: "变化", nextChapterInterface: ["接口"], mechanismCardIds: [] });
    await saveDocument(application, "creative_recipe", "production:creative_recipe:chapter_001", { chapterId: "chapter_001", chapterContractRevision: 1, mechanismCardIds: [], writerMechanisms: [], editorMechanisms: [] });

    const manifests = createChapterContextManifestService({ driver, commands: application.commands, objects });
    await expect(manifests.freeze({ command: command("manifest_tainted"), projectId: "project_001", chapterId: "chapter_001", manifestId: "manifest_tainted", tokenBudget: 4096, reservedOutputTokens: 1024 })).rejects.toThrow(/参考侧字段/);
  });

  it("MCP 只有在配置 ContextManifest 服务后才暴露冻结和读取入口", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const manifests = createChapterContextManifestService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });
    const handler = createApplicationMcpJsonRpcHandler({ application, manifests });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["freeze_chapter_context_manifest", "get_chapter_context_manifest"]));
  });
});

async function saveDocument(application: ReturnType<typeof createWorkspaceApplicationService>, kind: string, documentId: string, values: Record<string, unknown>): Promise<void> {
  const result = await application.commands.execute({
    ...command(`document_${documentId.replace(/[^a-z0-9]/gi, "_")}`), projectId: "project_001", tool: "commit_project_planning_document",
    args: { projectId: "project_001", documentId, documentType: kind, status: "approved", expectedRevision: null, payload: { schema_version: 1, kind, ...values } },
  });
  if (result.kind !== "ok") throw new Error(`测试文档未保存：${kind}`);
}

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
