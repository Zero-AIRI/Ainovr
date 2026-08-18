import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createLocalCreationService } from "@/application/local-creation-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("本地创作服务", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-local-creation-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("将本地模型正文作为可查询草稿原子提交，且 prompt 不进入命令审计", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute(projectCommand());
    const caller = { complete: vi.fn().mockResolvedValue({ text: "雨夜的港口只亮着一盏灯。", finishReason: "stop" }) };
    const creation = createLocalCreationService({
      driver,
      schemas,
      commands: application.commands,
      tasks: createTaskRunner(driver),
      objects: await createNodeObjectStore({ workspacePath }),
      caller,
      hostId: "test-host",
    });

    await expect(creation.start({
      command: commandBase(),
      taskId: "task_draft_001",
      documentId: "draft_001",
      projectId: "project_001",
      title: "第一章：雾港",
      prompt: "写一段原创悬疑小说开场，不要引用任何既有作品。",
      baseURL: "http://127.0.0.1:11434/v1",
      model: "qwen3.5:9b",
      maxTokens: 2048,
    })).resolves.toEqual({ kind: "accepted", taskId: "task_draft_001" });

    await creation.run("task_draft_001");

    await expect(creation.getDraft("draft_001")).resolves.toMatchObject({
      documentId: "draft_001",
      projectId: "project_001",
      title: "第一章：雾港",
      text: "雨夜的港口只亮着一盏灯。",
      model: "qwen3.5:9b",
    });
    await expect(creation.getTask("task_draft_001")).resolves.toMatchObject({ status: "succeeded" });
    await expect(driver.query<{ status: string }>({
      sql: "SELECT status FROM task_attempts WHERE task_id = ?",
      params: ["task_draft_001"],
    })).resolves.toEqual([{ status: "succeeded" }]);
    await expect(driver.query<{ event_type: string }>({
      sql: "SELECT event_type FROM task_events WHERE task_id = ? ORDER BY rowid ASC",
      params: ["task_draft_001"],
    })).resolves.toEqual([
      { event_type: "queued" },
      { event_type: "claimed" },
      { event_type: "checkpoint" },
      { event_type: "succeeded" },
    ]);
    expect(caller.complete).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: "http://127.0.0.1:11434/v1",
      model: "qwen3.5:9b",
      prompt: "写一段原创悬疑小说开场，不要引用任何既有作品。",
    }), expect.any(AbortSignal));

    const commands = await driver.query<{ args_json: string }>({
      sql: "SELECT args_json FROM commands WHERE tool = 'start_local_creation'",
      params: [],
    });
    expect(commands[0]?.args_json).not.toContain("原创悬疑小说开场");
  });

  it("配置 ModelResolver 后以角色路由覆盖调用方传入的 endpoint 与模型", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute(projectCommand());
    const caller = { complete: vi.fn().mockResolvedValue({ text: "路由正文。", finishReason: "stop" }) };
    const creation = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver), objects: await createNodeObjectStore({ workspacePath }), caller, hostId: "test-host",
      defaultModelRole: "writer",
      modelResolver: { resolve: vi.fn().mockResolvedValue({ role: "writer", providerProfileId: "local", baseURL: "http://localhost:11434/v1", model: "configured-writer", protocol: "chat_completions", contextWindowTokens: 4096, maxOutputTokens: 1024, safetyMarginRatio: 0.2, isCloud: false, cloudEscalation: "complex_only" }) },
    });
    await creation.start({ command: commandBase(), taskId: "task_routed", documentId: "draft_routed", projectId: "project_001", title: "路由", prompt: "写作", baseURL: "http://attacker.invalid/v1", model: "attacker", maxTokens: 256 });
    await creation.run("task_routed");
    expect(caller.complete).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "http://localhost:11434/v1", model: "configured-writer" }), expect.any(AbortSignal));
  });

  it("拒绝显式超过已解析 Provider/Workspace 上限的输出预算", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute(projectCommand());
    const creation = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver), objects: await createNodeObjectStore({ workspacePath }),
      caller: { complete: vi.fn() }, hostId: "test-host", defaultModelRole: "writer",
      modelResolver: { resolve: vi.fn().mockResolvedValue({ role: "writer", providerProfileId: "local", baseURL: "http://localhost:11434/v1", model: "configured-writer", protocol: "chat_completions", contextWindowTokens: 4096, maxOutputTokens: 1024, safetyMarginRatio: 0.2, isCloud: false, cloudEscalation: "complex_only" }) },
    });
    await expect(creation.start({
      command: commandBase(), taskId: "task_budget_rejected", documentId: "draft_budget_rejected", projectId: "project_001", title: "预算", prompt: "写作", baseURL: "http://localhost:11434/v1", model: "ignored", maxTokens: 2048,
    })).rejects.toThrow(/超过.*有效上限/);
  });

  it("在冻结任务前拒绝完整消息加输出和安全余量超过模型窗口的输入", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute(projectCommand());
    const creation = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver), objects: await createNodeObjectStore({ workspacePath }),
      caller: { complete: vi.fn() }, hostId: "test-host", defaultModelRole: "reader",
      modelResolver: { resolve: vi.fn().mockResolvedValue({ role: "reader", providerProfileId: "local", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", protocol: "ollama_native", contextWindowTokens: 4096, maxOutputTokens: 1024, safetyMarginRatio: 0.2, isCloud: false, cloudEscalation: "complex_only" }) },
    });
    await expect(creation.start({
      command: commandBase(), taskId: "task_context_rejected", documentId: "reader_context_rejected", projectId: "project_001", title: "超窗 Reader", prompt: "字".repeat(4_000), baseURL: "http://localhost:11434/v1", model: "ignored", maxTokens: 512, outputMode: "structured_json",
    })).rejects.toThrow(/上下文|窗口|预算/);
    await expect(creation.getTask("task_context_rejected")).resolves.toBeNull();
  });

  it("模型表示长度截断时失败，不生成可提交草稿", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute(projectCommand());
    const creation = createLocalCreationService({
      driver,
      schemas,
      commands: application.commands,
      tasks: createTaskRunner(driver),
      objects: await createNodeObjectStore({ workspacePath }),
      caller: { complete: vi.fn().mockResolvedValue({ text: "不完整", finishReason: "length" }) },
      hostId: "test-host",
    });
    await creation.start({
      command: commandBase(), taskId: "task_draft_002", documentId: "draft_002", projectId: "project_001", title: "截断草稿",
      prompt: "写作", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 2048,
    });

    await expect(creation.run("task_draft_002")).rejects.toThrow(/截断/);
    await expect(creation.getTask("task_draft_002")).resolves.toMatchObject({ status: "failed" });
    await expect(creation.getDraft("draft_002")).resolves.toBeNull();
  });

  it("创作正文校验失败时绝不自动重写", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute(projectCommand());
    const caller = { complete: vi.fn().mockResolvedValue({ text: "不符合章节契约的正文", finishReason: "stop" }) };
    const creation = createLocalCreationService({
      driver,
      schemas,
      commands: application.commands,
      tasks: createTaskRunner(driver),
      objects: await createNodeObjectStore({ workspacePath }),
      caller,
      hostId: "test-host",
      validateOutput: () => { throw new Error("Writer 正文未通过契约校验"); },
    });
    await creation.start({
      command: commandBase(), taskId: "task_draft_writer_no_retry", documentId: "draft_writer_no_retry", projectId: "project_001", title: "Writer", prompt: "写作正文", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 2048,
    });

    await expect(creation.run("task_draft_writer_no_retry")).rejects.toThrow(/Writer 正文/);
    expect(caller.complete).toHaveBeenCalledTimes(1);
    await expect(creation.getDraft("draft_writer_no_retry")).resolves.toBeNull();
    await expect(creation.getTask("task_draft_writer_no_retry")).resolves.toMatchObject({ status: "failed" });
  });

  it("结构化输出首次校验失败时，仅以修复提示重试一次并提交第二次的有效结果", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute(projectCommand());
    const validateOutput = vi.fn()
      .mockImplementationOnce(() => { throw new Error("Reader JSON 未通过严格范围校验"); })
      .mockImplementationOnce(() => undefined);
    const caller = { complete: vi.fn()
      .mockResolvedValueOnce({ text: "{无效 JSON}", finishReason: "stop" })
      .mockResolvedValueOnce({ text: "{\"issues\":[]}", finishReason: "stop" }) };
    const creation = createLocalCreationService({
      driver,
      schemas,
      commands: application.commands,
      tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }),
      objects: await createNodeObjectStore({ workspacePath }),
      caller,
      hostId: "test-host",
      validateOutput,
      now: () => 1_700_000_000_000,
    });
    await creation.start({
      command: commandBase(), taskId: "task_draft_003", documentId: "draft_003", projectId: "project_001", title: "Reader", prompt: "严格 JSON", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048,
      outputMode: "structured_json",
    });

    await expect(creation.run("task_draft_003")).resolves.toMatchObject({ status: "succeeded" });
    expect(validateOutput).toHaveBeenNthCalledWith(1, expect.objectContaining({ taskId: "task_draft_003", prompt: "严格 JSON" }), "{无效 JSON}");
    expect(validateOutput).toHaveBeenNthCalledWith(2, expect.objectContaining({ taskId: "task_draft_003" }), "{\"issues\":[]}");
    expect(caller.complete).toHaveBeenCalledTimes(2);
    expect(caller.complete).toHaveBeenNthCalledWith(2, expect.objectContaining({
      outputMode: "structured_json",
      prompt: expect.stringMatching(/上一次结构化输出未通过本地严格校验[\s\S]*不得通过删除必填字段、将必填字符串置空或将必填数组改为空来逃避校验/),
    }), expect.any(AbortSignal));
    await expect(creation.getDraft("draft_003")).resolves.toMatchObject({ text: "{\"issues\":[]}" });
    await expect(creation.getTask("task_draft_003")).resolves.toMatchObject({ status: "succeeded" });
  });

  it("结构化 Editor 修复不得把必填 replacement 置空来规避校验", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute(projectCommand());
    const validateOutput = vi.fn()
      .mockImplementationOnce(() => { throw new Error("replacement 必须是非空字符串。"); })
      .mockImplementationOnce(() => undefined);
    const caller = { complete: vi.fn()
      .mockResolvedValueOnce({ text: '{"replacements":[{"replacement":""}]}', finishReason: "stop" })
      .mockResolvedValueOnce({ text: '{"replacements":[{"replacement":"清晰的信号"}]}', finishReason: "stop" }) };
    const creation = createLocalCreationService({
      driver,
      schemas,
      commands: application.commands,
      tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }),
      objects: await createNodeObjectStore({ workspacePath }),
      caller,
      hostId: "test-host",
      validateOutput,
    });
    await creation.start({
      command: commandBase(), taskId: "task_editor_repair", documentId: "draft_editor_repair", projectId: "project_001", title: "Editor V2", prompt: "Editor JSON 契约：replacements 必须恰好有一个非空 replacement。", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 2048,
      outputMode: "structured_json", metadata: { schema_version: 1, kind: "chapter_editor_patch" },
    });

    await expect(creation.run("task_editor_repair")).resolves.toMatchObject({ status: "succeeded" });
    expect(caller.complete).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: expect.stringMatching(/不得通过删除必填字段、将必填字符串置空或将必填数组改为空来逃避校验[\s\S]*AINOVR_EDITOR_REPAIR_CONTRACT[\s\S]*replacement 必须是非空字符串/),
      outputMode: "structured_json",
    }), expect.any(AbortSignal));
  });

  it("结构化输出第二次校验仍失败时，任务失败且不提交草稿", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute(projectCommand());
    const validateOutput = vi.fn(() => { throw new Error("Reader JSON 未通过严格范围校验"); });
    const caller = { complete: vi.fn().mockResolvedValue({ text: "{无效 JSON}", finishReason: "stop" }) };
    const creation = createLocalCreationService({
      driver,
      schemas,
      commands: application.commands,
      tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }),
      objects: await createNodeObjectStore({ workspacePath }),
      caller,
      hostId: "test-host",
      validateOutput,
      now: () => 1_700_000_000_000,
    });
    await creation.start({
      command: commandBase(), taskId: "task_draft_003", documentId: "draft_003", projectId: "project_001", title: "Reader", prompt: "严格 JSON", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048,
      outputMode: "structured_json",
    });

    await expect(creation.run("task_draft_003")).rejects.toThrow(/严格范围/);
    expect(validateOutput).toHaveBeenCalledTimes(2);
    expect(caller.complete).toHaveBeenCalledTimes(2);
    await expect(creation.getTask("task_draft_003")).resolves.toMatchObject({ status: "failed" });
    await expect(creation.getDraft("draft_003")).resolves.toBeNull();
  });

  it("可将已校验输出交给正式领域提交回调，任务成功不再依赖通用草稿文档", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await application.commands.execute(projectCommand());
    const commitOutput = vi.fn(async ({ output }: { output: { sha256: string; byteLength: number; mediaType: string } }) => {
      await driver.execute({ sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?)", params: [output.sha256, output.byteLength, output.mediaType, Date.now(), Date.now()] });
    });
    const creation = createLocalCreationService({
      driver,
      schemas,
      commands: application.commands,
      tasks: createTaskRunner(driver),
      objects: await createNodeObjectStore({ workspacePath }),
      caller: { complete: vi.fn().mockResolvedValue({ text: "{\"issues\":[]}", finishReason: "stop" }) },
      hostId: "test-host",
      commitOutput,
    });
    await creation.start({
      command: commandBase(), taskId: "task_draft_004", documentId: "review_004", projectId: "project_001", title: "Reviewer", prompt: "严格 JSON", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048,
    });

    await expect(creation.run("task_draft_004")).resolves.toMatchObject({ status: "succeeded" });
    expect(commitOutput).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task_draft_004", text: "{\"issues\":[]}", output: expect.objectContaining({ sha256: expect.any(String) }) }));
    await expect(creation.getDraft("review_004")).resolves.toBeNull();
  });
});

function projectCommand(): CommandEnvelope {
  return {
    ...commandBase(),
    commandId: "command_project_001",
    idempotencyKey: "idem_project_001",
    tool: "create_novel_project",
    args: { projectId: "project_001", title: "雾港记录", status: "planning", payload: { schema_version: 1, intent: "原创悬疑" } },
  };
}

function commandBase(): Omit<CommandEnvelope, "tool" | "args"> {
  return {
    schemaVersion: 1,
    commandId: "command_draft_001",
    idempotencyKey: "idem_draft_001",
    correlationId: "correlation_draft_001",
    actor: { kind: "human", id: "user_001" },
    createdAt: 1_700_000_000_000,
  };
}
