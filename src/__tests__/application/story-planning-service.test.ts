import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createApplicationMcpJsonRpcHandler } from "@/application/application-mcp-jsonrpc";
import { createStoryPlanningService } from "@/application/story-planning-service";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("StoryPlanning Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-story-planning-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });
  afterEach(async () => { await driver?.close(); await rm(workspacePath, { recursive: true, force: true }); });

  it("把原创意图、三个概念、人工选择与章节契约保存为不可变项目文档，不把模型原始输出写进审计", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project"), tool: "create_novel_project", args: { projectId: "project_001", title: "潮汐钟楼", status: "planning", payload: { schema_version: 1 } } });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });

    await expect(planning.saveProjectIntent({ command: command("intent"), projectId: "project_001", intent: { genre: "科幻悬疑", audience: "成年读者", experienceGoals: ["克制的未知感"], prohibitions: ["不使用既有作品专名"], targetScale: "中篇" } }))
      .resolves.toMatchObject({ kind: "ok", revision: 1 });
    const conceptsRaw = JSON.stringify({ concepts: [
      { id: "concept_1", title: "倒退的钟", premise: "钟楼倒走时会留下未寄出的信。", centralConflict: "守钟人必须决定是否进入钟楼", novelty: "时间倒流只显现为可核验的遗留物", endingDirection: "揭开选择的代价" },
      { id: "concept_2", title: "静默气象站", premise: "废弃气象站预报的不是天气。", centralConflict: "观测员与城市管理者争夺预报权", novelty: "预报改变的是人们的记忆", endingDirection: "保留一个无法验证的预报" },
      { id: "concept_3", title: "借来的黎明", premise: "港口每天借来一小时晨光。", centralConflict: "灯塔员发现晨光必须偿还", novelty: "光照成为稀缺的公共资源", endingDirection: "让城市主动面对黑暗" },
    ] });
    await expect(planning.submitStoryConcepts({ command: command("concepts"), projectId: "project_001", rawOutput: conceptsRaw })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(planning.reviewDocument({ command: { ...command("concepts_approve"), actor: { kind: "human", id: "user_001" } }, projectId: "project_001", documentId: "planning:project_001:story_concepts", expectedRevision: 1, status: "approved" })).resolves.toMatchObject({ kind: "ok", revision: 2 });
    await expect(planning.selectStoryConcept({ command: { ...command("select"), actor: { kind: "human", id: "user_001" } }, projectId: "project_001", conceptId: "concept_1" })).resolves.toMatchObject({ kind: "ok" });
    await expect(planning.saveStoryContract({ command: command("contract"), projectId: "project_001", contract: { corePromise: "每次异常都带来可验证代价", centralConflict: "进入钟楼是否值得", endingDirection: "主角承担一次不可逆选择", immutableBoundaries: ["不把异常解释为梦境"] } })).resolves.toMatchObject({ kind: "ok" });
    await expect(planning.saveStorySystem({ command: command("system"), projectId: "project_001", system: { worldRules: ["钟楼每次只倒走七分钟"], characterSystem: ["林霁只能依据可见证据行动"], causalityRules: ["每个异常都要留下代价"], informationRules: ["解释不得先于异常"] } })).resolves.toMatchObject({ kind: "ok" });
    await expect(planning.saveBookOutline({ command: command("outline"), projectId: "project_001", outline: { acts: [{ id: "act_1", purpose: "建立异常与选择", chapterRange: [1, 4] }], endingDependencies: ["钟楼的规则必须先被验证"] } })).resolves.toMatchObject({ kind: "ok" });
    await expect(planning.saveStagePlan({ command: command("stage"), projectId: "project_001", stage: { stageId: "stage_001", objective: "确认第一封信的来源", chapterIds: ["chapter_001", "chapter_002"], entryCondition: "林霁只掌握异常线索", exitCondition: "林霁确定钟楼与失踪相关", readerExpectation: "信件会揭开失踪代价" } })).resolves.toMatchObject({ kind: "ok" });
    await expect(planning.saveChapterContract({ command: command("chapter"), projectId: "project_001", contract: { chapterId: "chapter_001", ordinal: 1, entryState: ["林霁不知道失踪者去向"], exitState: ["林霁决定进入钟楼"], desire: "确认信件来源", pressure: "潮水将淹没入口", turningPoint: "指针开始倒转", mustNotHappen: ["不揭示全部真相"], readerPromiseAction: "establish", emotionalCycle: "由迟疑转为承担", nextChapterInterface: ["钟楼内部的第一条线索"] } })).resolves.toMatchObject({ kind: "ok" });

    await expect(planning.listDocuments("project_001")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ documentType: "project_intent", revision: 1 }),
      expect.objectContaining({ documentType: "story_concepts", status: "approved", revision: 2 }),
      expect.objectContaining({ documentType: "book_outline", revision: 1 }),
      expect.objectContaining({ documentType: "stage_plan", revision: 1 }),
      expect.objectContaining({ documentType: "chapter_contract", revision: 1 }),
    ]));
    await expect(driver.query<{ args_json: string }>({ sql: "SELECT args_json FROM commands WHERE tool = 'commit_project_planning_document'", params: [] }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ args_json: expect.stringContaining("rawOutputObjectHash") })]));
  });

  it("将 Agent 生成的规划留在待审核状态，只有人类按当前 revision 审核后才可进入后续规划", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("review_project"), tool: "create_novel_project", args: { projectId: "project_review", title: "待审核规划", status: "planning", payload: { schema_version: 1 } } });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });
    const concepts = JSON.stringify({ concepts: [
      { id: "concept_1", title: "候选一", premise: "异常一", centralConflict: "冲突一", novelty: "新意一", endingDirection: "结局一" },
      { id: "concept_2", title: "候选二", premise: "异常二", centralConflict: "冲突二", novelty: "新意二", endingDirection: "结局二" },
      { id: "concept_3", title: "候选三", premise: "异常三", centralConflict: "冲突三", novelty: "新意三", endingDirection: "结局三" },
    ] });

    await planning.submitStoryConcepts({ command: command("review_concepts"), projectId: "project_review", rawOutput: concepts });
    await expect(planning.listDocuments("project_review")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ documentId: "planning:project_review:story_concepts", documentType: "story_concepts", status: "pending_review", revision: 1 }),
    ]));
    await expect(planning.selectStoryConcept({ command: { ...command("review_select_before_approval"), actor: { kind: "human", id: "user_001" } }, projectId: "project_review", conceptId: "concept_1" }))
      .rejects.toThrow(/审核|批准/);

    await expect(planning.reviewDocument({ command: { ...command("review_concepts_approve"), actor: { kind: "human", id: "user_001" } }, projectId: "project_review", documentId: "planning:project_review:story_concepts", expectedRevision: 1, status: "approved" }))
      .resolves.toMatchObject({ kind: "ok", revision: 2 });
    await expect(planning.selectStoryConcept({ command: { ...command("review_select_after_approval"), actor: { kind: "human", id: "user_001" } }, projectId: "project_review", conceptId: "concept_1" }))
      .resolves.toMatchObject({ kind: "ok" });

    await planning.saveStoryContract({ command: command("review_contract"), projectId: "project_review", contract: { corePromise: "每次异常都带来代价", centralConflict: "是否进入钟楼", endingDirection: "承担选择", immutableBoundaries: ["不解释为梦境"] } });
    await expect(planning.listDocuments("project_review")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ documentId: "planning:project_review:story_contract", documentType: "story_contract", status: "pending_review", revision: 1 }),
    ]));
    await expect(planning.reviewDocument({ command: { ...command("review_contract_reject"), actor: { kind: "human", id: "user_001" } }, projectId: "project_review", documentId: "planning:project_review:story_contract", expectedRevision: 1, status: "rejected" }))
      .resolves.toMatchObject({ kind: "ok", revision: 2 });
  });

  it("没有人工选择概念时拒绝保存 StoryContract，章节契约拒绝旧方法卡字段", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_2"), tool: "create_novel_project", args: { projectId: "project_002", title: "测试", status: "planning", payload: { schema_version: 1 } } });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });
    await expect(planning.saveStoryContract({ command: command("contract_2"), projectId: "project_002", contract: { corePromise: "承诺", centralConflict: "冲突", endingDirection: "结局", immutableBoundaries: ["边界"] } })).rejects.toThrow(/选择/);
    await expect(planning.saveChapterContract({ command: command("chapter_2"), projectId: "project_002", contract: { chapterId: "chapter_002", ordinal: 1, entryState: ["进入"], exitState: ["退出"], desire: "欲望", pressure: "压力", turningPoint: "转折", mustNotHappen: [], readerPromiseAction: "establish", emotionalCycle: "变化", nextChapterInterface: ["接口"], mechanismCardIds: ["a"] } })).rejects.toThrow(/采用记录/);
  });

  it("两个原创项目可各自保存同类项目级规划，文档 ID 不会发生全局主键碰撞", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });
    for (const projectId of ["project_multi_a", "project_multi_b"]) {
      await application.commands.execute({ ...command(`create_${projectId}`), tool: "create_novel_project", args: { projectId, title: projectId, status: "planning", payload: { schema_version: 1 } } });
      await expect(planning.saveProjectIntent({ command: command(`intent_${projectId}`), projectId, intent: { genre: "科幻", audience: "成年读者", experienceGoals: ["悬念"], prohibitions: ["不复用参考专名"], targetScale: "中篇" } })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    }
    const [first, second] = await Promise.all([planning.listDocuments("project_multi_a"), planning.listDocuments("project_multi_b")]);
    expect(first).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: "planning:project_multi_a:project_intent" })]));
    expect(second).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: "planning:project_multi_b:project_intent" })]));
  });

  it("章节契约允许零方法，但不再承担方法卡选择", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_recipe"), tool: "create_novel_project", args: { projectId: "project_recipe", title: "机制选择", status: "planning", payload: { schema_version: 1 } } });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });
    await planning.submitStoryConcepts({ command: command("recipe_concepts"), projectId: "project_recipe", rawOutput: JSON.stringify({ concepts: [
      { id: "concept_1", title: "雾中电台", premise: "电台只在雾天播报明日事故。", centralConflict: "值班员必须决定是否公开预报", novelty: "预报会改变听众的共同记忆", endingDirection: "公开代价" },
      { id: "concept_2", title: "潮间信箱", premise: "退潮后出现寄给未来的信。", centralConflict: "邮差必须决定是否投递", novelty: "信件改变潮线", endingDirection: "停止投递" },
      { id: "concept_3", title: "回声井", premise: "井里传来尚未发生的告别。", centralConflict: "看守人是否封井", novelty: "回声需要现实支付", endingDirection: "选择保留回声" },
    ] }) });
    await planning.reviewDocument({ command: { ...command("recipe_concepts_approve"), actor: { kind: "human", id: "user_001" } }, projectId: "project_recipe", documentId: "planning:project_recipe:story_concepts", expectedRevision: 1, status: "approved" });
    await planning.selectStoryConcept({ command: { ...command("recipe_select"), actor: { kind: "human", id: "user_001" } }, projectId: "project_recipe", conceptId: "concept_1" });

    await expect(planning.saveChapterContract({ command: command("recipe_chapter"), projectId: "project_recipe", contract: chapterContract({ mechanismCardIds: ["mechanism_unadopted"] }) }))
      .rejects.toThrow(/采用记录/);
    await expect(planning.saveChapterContract({ command: command("recipe_chapter_empty"), projectId: "project_recipe", contract: chapterContract({}) }))
      .resolves.toMatchObject({ kind: "ok" });
  });

  it("滚动章节计划为每章保留独立的 ChapterContract revision，而不是覆盖上一章", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_rolling"), tool: "create_novel_project", args: { projectId: "project_rolling", title: "滚动章节", status: "planning", payload: { schema_version: 1 } } });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });

    await planning.saveChapterContract({ command: command("rolling_chapter_1"), projectId: "project_rolling", contract: chapterContract({ chapterId: "chapter_001", ordinal: 1 }) });
    await planning.saveChapterContract({ command: command("rolling_chapter_2"), projectId: "project_rolling", contract: chapterContract({ chapterId: "chapter_002", ordinal: 2 }) });

    await expect(planning.listDocuments("project_rolling")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ documentId: "planning:project_rolling:chapter_contract:chapter_001", documentType: "chapter_contract", revision: 1 }),
      expect.objectContaining({ documentId: "planning:project_rolling:chapter_contract:chapter_002", documentType: "chapter_contract", revision: 1 }),
    ]));
  });

  it("通过 MCP 暴露完整原创规划工具面，而非直接写项目文档表", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_mcp"), tool: "create_novel_project", args: { projectId: "project_mcp", title: "MCP 规划", status: "planning", payload: { schema_version: 1 } } });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });
    const handler = createApplicationMcpJsonRpcHandler({ application, planning });
    const names = (((await handler({ jsonrpc: "2.0", id: 1, method: "tools/list" }))?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["save_project_intent", "submit_story_concepts", "select_story_concept", "review_project_planning_document", "save_story_contract", "save_story_system", "save_book_outline", "save_stage_plan", "save_chapter_contract", "list_project_planning_documents"]));
    const saved = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "save_project_intent", arguments: { commandId: "mcp_intent", idempotencyKey: "mcp_intent", correlationId: "mcp_plan", projectId: "project_mcp", intent: { genre: "悬疑", audience: "成人", experienceGoals: ["未知感"], prohibitions: ["不仿写"], targetScale: "短篇" } } } });
    expect((saved?.result as { structuredContent: { kind: string } }).structuredContent).toMatchObject({ kind: "ok" });
  });

  it("不接受外部 MCP 参数伪造 desktop_ui 的 human actor；只有受信 sidecar transport 才能记录桌面人工", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_transport"), tool: "create_novel_project", args: { projectId: "project_transport", title: "传输审计", status: "planning", payload: { schema_version: 1 } } });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });
    const external = createApplicationMcpJsonRpcHandler({ application, planning });
    const intent = { genre: "悬疑", audience: "成人", experienceGoals: ["未知感"], prohibitions: ["不仿写"], targetScale: "短篇" };
    await external({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "save_project_intent", arguments: { commandId: "mcp_spoof", idempotencyKey: "mcp_spoof", correlationId: "mcp_transport", projectId: "project_transport", _transport: "desktop_ui", intent } } });
    await expect(driver.query<{ actor_json: string }>({ sql: "SELECT actor_json FROM commands WHERE command_id = ?", params: ["mcp_spoof"] })).resolves.toEqual([{ actor_json: '{"kind":"external_agent","id":"mcp"}' }]);

    const desktop = createApplicationMcpJsonRpcHandler({ application, planning, transport: "desktop_ui" });
    await desktop({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "save_project_intent", arguments: { commandId: "desktop_human", idempotencyKey: "desktop_human", correlationId: "mcp_transport", projectId: "project_transport", intent: { ...intent, genre: "科幻" } } } });
    await expect(driver.query<{ actor_json: string }>({ sql: "SELECT actor_json FROM commands WHERE command_id = ?", params: ["desktop_human"] })).resolves.toEqual([{ actor_json: '{"kind":"human","id":"desktop-ui"}' }]);
  });

  it("MCP 代用户选择概念时必须留下持久化确认，不能绕过 human_via_agent 审计", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute({ ...command("project_selection"), tool: "create_novel_project", args: { projectId: "project_selection", title: "概念选择", status: "planning", payload: { schema_version: 1 } } });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });
    await planning.submitStoryConcepts({ command: command("selection_concepts"), projectId: "project_selection", rawOutput: JSON.stringify({ concepts: [
      { id: "concept_1", title: "雾中电台", premise: "电台只在雾天播报明日事故。", centralConflict: "值班员必须决定是否公开预报", novelty: "预报会改变听众的共同记忆", endingDirection: "公开代价" },
      { id: "concept_2", title: "潮间信箱", premise: "退潮后出现寄给未来的信。", centralConflict: "邮差必须决定是否投递", novelty: "信件改变潮线", endingDirection: "停止投递" },
      { id: "concept_3", title: "回声井", premise: "井里传来尚未发生的告别。", centralConflict: "看守人是否封井", novelty: "回声需要现实支付", endingDirection: "选择保留回声" },
    ] }) });
    const handler = createApplicationMcpJsonRpcHandler({ application, planning });

    const review = await handler({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "review_project_planning_document", arguments: { commandId: "mcp_review", idempotencyKey: "mcp_review", correlationId: "mcp_plan", projectId: "project_selection", documentId: "planning:project_selection:story_concepts", expectedRevision: 1, status: "approved" } } });
    expect((review?.result as { structuredContent: { kind: string; confirmationId: string } }).structuredContent).toMatchObject({ kind: "needs_confirmation", confirmationId: "confirmation:mcp_review" });
    const reviewApproved = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approve_confirmation", arguments: { confirmationId: "confirmation:mcp_review", reason: "用户已审阅三个原创概念并允许继续选择。" } } });
    expect((reviewApproved?.result as { structuredContent: { kind: string; revision: number } }).structuredContent).toMatchObject({ kind: "ok", revision: 2 });

    const selection = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "select_story_concept", arguments: { commandId: "mcp_selection", idempotencyKey: "mcp_selection", correlationId: "mcp_plan", projectId: "project_selection", conceptId: "concept_1" } } });

    expect((selection?.result as { structuredContent: { kind: string; confirmationId: string } }).structuredContent).toMatchObject({ kind: "needs_confirmation", confirmationId: "confirmation:mcp_selection" });
    await expect(planning.listDocuments("project_selection")).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ documentType: "story_concept_selection" })]));
  });
});

function command(id: string): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: `command_${id}`, idempotencyKey: `idem_${id}`, correlationId: `correlation_${id}`, actor: { kind: "human", id: "user_001" }, createdAt: 1_700_000_000_000 };
}

function chapterContract(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    chapterId: "chapter_recipe", ordinal: 1, entryState: ["入口状态"], exitState: ["出口状态"], desire: "完成目标", pressure: "时间压力", turningPoint: "异常发生", mustNotHappen: [], readerPromiseAction: "establish", emotionalCycle: "迟疑转为行动", nextChapterInterface: ["下一步问题"], ...overrides,
  };
}
