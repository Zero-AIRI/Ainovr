import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createCreativeRecipeService } from "@/application/creative-recipe-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import type { TransferMechanismCard } from "@/lib/analysis/transfer-card";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("CreativeRecipe Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-creative-recipe-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });
  afterEach(async () => { await driver?.close(); await rm(workspacePath, { recursive: true, force: true }); });

  it("仅把当前项目已采纳的去来源化卡片冻结到本章 Recipe，拒绝缺失或未采纳的选择", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    await application.commands.execute({
      ...command("contract"), projectId: "project_001", tool: "commit_project_planning_document",
      args: {
        projectId: "project_001", documentId: "planning:project_001:chapter_contract:chapter_001", documentType: "chapter_contract", status: "approved", expectedRevision: null,
        payload: { schema_version: 1, kind: "chapter_contract", chapterId: "chapter_001", ordinal: 1, entryState: ["入口"], exitState: ["出口"], desire: "确认信件来源", pressure: "潮水上涨", turningPoint: "时针倒转", mustNotHappen: [], readerPromiseAction: "establish", emotionalCycle: "迟疑转为行动", nextChapterInterface: ["进入钟楼"], mechanismCardIds: ["mechanism_safe"] },
      },
    });
    const safeCard: TransferMechanismCard = { id: "mechanism_safe", title: "异常先于解释", targetEffect: "建立可验证期待", scope: "distributed", when: ["场景首次出现异常"], operations: ["先呈现异常痕迹"], avoid: ["先解释原因"], applicability: ["信息受限场景"], targetLayers: ["draft", "editor"] };
    const recipes = createCreativeRecipeService({ driver, commands: application.commands, mechanisms: { listAdopted: async () => [safeCard] } });

    await expect(recipes.create({ command: command("recipe"), projectId: "project_001", chapterId: "chapter_001" }))
      .resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(recipes.get({ projectId: "project_001", chapterId: "chapter_001" })).resolves.toEqual(expect.objectContaining({
      chapterId: "chapter_001", mechanismCardIds: ["mechanism_safe"], writerMechanisms: [safeCard],
    }));
    const stored = await recipes.get({ projectId: "project_001", chapterId: "chapter_001" });
    expect(JSON.stringify(stored)).not.toMatch(/source|provenance|span|evidence|原文/i);

    await application.commands.execute({
      ...command("contract_missing"), projectId: "project_001", tool: "commit_project_planning_document",
      args: {
        projectId: "project_001", documentId: "planning:project_001:chapter_contract:chapter_002", documentType: "chapter_contract", status: "approved", expectedRevision: null,
        payload: { schema_version: 1, kind: "chapter_contract", chapterId: "chapter_002", ordinal: 2, entryState: ["入口"], exitState: ["出口"], desire: "确认", pressure: "时间", turningPoint: "变化", mustNotHappen: [], readerPromiseAction: "reinforce", emotionalCycle: "压迫升级", nextChapterInterface: ["下一场"], mechanismCardIds: ["mechanism_unadopted"] },
      },
    });
    await expect(recipes.create({ command: command("recipe_missing"), projectId: "project_001", chapterId: "chapter_002" }))
      .rejects.toThrow(/采纳|去来源化/);
  });

  it("MCP 仅在配置 Recipe Application Service 时暴露生产配方工具", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const recipes = createCreativeRecipeService({ driver, commands: application.commands, mechanisms: { listAdopted: async () => [] } });
    const handler = createApplicationMcpJsonRpcHandler({ application, recipes });

    const listed = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["create_creative_recipe", "get_creative_recipe"]));
  });
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}
