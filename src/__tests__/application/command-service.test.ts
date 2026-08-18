import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCommandService, type CommandPlanner } from "@/application/command-service";
import type { CommandEnvelope } from "@/application/command-types";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("CommandService", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-command-service-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("命令、领域写入、幂等记录、审计和 change feed 在一个事务中提交", async () => {
    const service = createCommandService(driver, planner(), () => 1_700_000_000_000);
    const command = envelope({ commandId: "command_001", idempotencyKey: "idem_001", args: { key: "workspace_name", value: "测试工作区" } });

    const first = await service.execute(command);
    const repeated = await service.execute({ ...command, commandId: "command_retry", createdAt: 1_700_000_000_123 });

    expect(first).toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "workspace_meta", id: "workspace_name" }] });
    expect(repeated).toEqual(first);
    await expect(driver.query<{ value_json: string }>({ sql: "SELECT value_json FROM workspace_meta WHERE key = ?", params: ["workspace_name"] }))
      .resolves.toEqual([{ value_json: '{"schema_version":1,"value":"测试工作区"}' }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM commands", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM audit_events", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM change_feed", params: [] })).resolves.toEqual([{ count: 1 }]);
  });

  it("同一幂等键对应不同命令 Hash 时返回冲突，失败命令不得留下部分审计", async () => {
    const service = createCommandService(driver, planner(), () => 1_700_000_000_000);
    const original = envelope({ commandId: "command_001", idempotencyKey: "idem_001", args: { key: "first", value: "one" } });
    await service.execute(original);

    await expect(service.execute(envelope({ commandId: "command_002", idempotencyKey: "idem_001", args: { key: "second", value: "two" } })))
      .resolves.toEqual({ kind: "error", code: "idempotency_conflict", message: "同一 idempotencyKey 对应不同命令。", retryable: false });

    const failing = envelope({ commandId: "command_003", idempotencyKey: "idem_003", args: { key: "first", value: "duplicate" } });
    await expect(service.execute(failing)).resolves.toMatchObject({ kind: "error", retryable: false });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM commands", params: [] })).resolves.toEqual([{ count: 1 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM audit_events", params: [] })).resolves.toEqual([{ count: 1 }]);
  });

  it("apply_batch 在同一项目内把所有同步子命令、审计与变更通知放进一个事务", async () => {
    const service = createCommandService(driver, planner(), () => 1_700_000_000_000);
    const batch = envelope({
      commandId: "batch_001",
      idempotencyKey: "idem_batch_001",
      projectId: "project_001",
      args: {},
    });
    const commands = [
      envelope({ commandId: "batch_child_001", idempotencyKey: "idem_batch_child_001", projectId: "project_001", args: { key: "chapter_contract", value: "pending_review" } }),
      envelope({ commandId: "batch_child_002", idempotencyKey: "idem_batch_child_002", projectId: "project_001", args: { key: "story_system", value: "pending_review" } }),
    ];

    const first = await service.executeBatch({ command: batch, commands });
    const repeated = await service.executeBatch({ command: { ...batch, commandId: "batch_retry_001", createdAt: 1_700_000_000_123 }, commands });

    expect(first).toEqual({
      kind: "ok",
      resourceRefs: [
        { type: "workspace_meta", id: "chapter_contract" },
        { type: "workspace_meta", id: "story_system" },
      ],
    });
    expect(repeated).toEqual(first);
    await expect(driver.query<{ key: string }>({ sql: "SELECT key FROM workspace_meta ORDER BY key", params: [] }))
      .resolves.toEqual([{ key: "chapter_contract" }, { key: "story_system" }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM commands", params: [] })).resolves.toEqual([{ count: 3 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM audit_events", params: [] })).resolves.toEqual([{ count: 3 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM change_feed", params: [] })).resolves.toEqual([{ count: 3 }]);
  });

  it("apply_batch 的任一子命令失败时全部回滚，且不留下任何子命令审计", async () => {
    const service = createCommandService(driver, planner(), () => 1_700_000_000_000);
    const result = await service.executeBatch({
      command: envelope({ commandId: "batch_rollback_001", idempotencyKey: "idem_batch_rollback_001", projectId: "project_001", args: {} }),
      commands: [
        envelope({ commandId: "batch_rollback_child_001", idempotencyKey: "idem_batch_rollback_child_001", projectId: "project_001", args: { key: "same_key", value: "first" } }),
        envelope({ commandId: "batch_rollback_child_002", idempotencyKey: "idem_batch_rollback_child_002", projectId: "project_001", args: { key: "same_key", value: "second" } }),
      ],
    });

    expect(result).toMatchObject({ kind: "error", code: "command_transaction_failed" });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM workspace_meta", params: [] })).resolves.toEqual([{ count: 0 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM commands", params: [] })).resolves.toEqual([{ count: 0 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM audit_events", params: [] })).resolves.toEqual([{ count: 0 }]);
  });

  it("apply_batch 拒绝跨项目、嵌套或异步子命令", async () => {
    const service = createCommandService(driver, planner(), () => 1_700_000_000_000);
    const batch = envelope({ commandId: "batch_reject_001", idempotencyKey: "idem_batch_reject_001", projectId: "project_001", args: {} });

    await expect(service.executeBatch({
      command: batch,
      commands: [envelope({ commandId: "batch_cross_project", idempotencyKey: "idem_batch_cross_project", projectId: "project_002", args: { key: "other", value: "x" } })],
    })).resolves.toMatchObject({ kind: "blocked", diagnostics: [expect.objectContaining({ code: "batch_project_mismatch" })] });
    await expect(service.executeBatch({
      command: { ...batch, commandId: "batch_async_001", idempotencyKey: "idem_batch_async_001" },
      commands: [envelope({ commandId: "batch_async_child", idempotencyKey: "idem_batch_async_child", projectId: "project_001", tool: "start_async_test", args: {} })],
    })).resolves.toMatchObject({ kind: "blocked", diagnostics: [expect.objectContaining({ code: "batch_async_command" })] });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM commands", params: [] })).resolves.toEqual([{ count: 0 }]);
  });

  it("不允许外部 actor 用 batch 注入低层命令，也不允许非人类批准确认", async () => {
    const service = createCommandService(driver, planner(), () => 1_700_000_000_000);
    const risky = envelope({ commandId: "risky_001", idempotencyKey: "idem_risky_001", actor: { kind: "human_via_agent", id: "agent" }, tool: "set_sensitive_meta", args: { key: "publish_state", value: "approved" } });
    await expect(service.execute(risky)).resolves.toMatchObject({ kind: "needs_confirmation" });

    await expect(service.approveConfirmation({
      confirmationId: "confirmation:risky_001",
      actor: { kind: "external_agent", id: "forged" } as never,
      reason: "伪造批准。",
    })).resolves.toMatchObject({ kind: "blocked", diagnostics: [expect.objectContaining({ code: "confirmation_actor_not_authorized" })] });

    await expect(service.executeBatch({
      command: envelope({ commandId: "external_batch_001", idempotencyKey: "idem_external_batch_001", projectId: "project_001", actor: { kind: "external_agent", id: "forged" }, args: {} }),
      commands: [envelope({ commandId: "external_batch_child_001", idempotencyKey: "idem_external_batch_child_001", projectId: "project_001", actor: { kind: "external_agent", id: "forged" }, args: { key: "injected", value: "value" } })],
    })).resolves.toMatchObject({ kind: "blocked", diagnostics: [expect.objectContaining({ code: "batch_actor_not_authorized" })] });
  });

  it("批量命令不能绕过正式章节提交的高层前置校验，并在请求确认时通知 change feed", async () => {
    const service = createCommandService(driver, planner(), () => 1_700_000_000_000);
    await expect(service.executeBatch({
      command: envelope({ commandId: "sensitive_batch_001", idempotencyKey: "idem_sensitive_batch_001", projectId: "project_001", args: {} }),
      commands: [envelope({ commandId: "sensitive_batch_child_001", idempotencyKey: "idem_sensitive_batch_child_001", projectId: "project_001", tool: "commit_chapter_production", args: {} })],
    })).resolves.toMatchObject({ kind: "blocked", diagnostics: [expect.objectContaining({ code: "batch_sensitive_tool_not_allowed" })] });

    await service.execute(envelope({ commandId: "confirmation_feed_001", idempotencyKey: "idem_confirmation_feed_001", tool: "set_sensitive_meta", args: { key: "publish_state", value: "approved" } }));
    await expect(driver.query<{ topic: string; resource_id: string }>({ sql: "SELECT topic, resource_id FROM change_feed WHERE resource_type = 'confirmation'", params: [] }))
      .resolves.toEqual([{ topic: "confirmations", resource_id: "confirmation:confirmation_feed_001" }]);
  });

  it("apply_batch 对需确认的同步子命令只创建一条统一确认，并在批准后原子提交", async () => {
    const service = createCommandService(driver, planner(), () => 1_700_000_000_000);
    const actor = { kind: "human_via_agent" as const, id: "codex" };
    const batch = envelope({ commandId: "batch_confirmation_001", idempotencyKey: "idem_batch_confirmation_001", projectId: "project_001", actor, args: {} });
    const child = envelope({
      commandId: "batch_confirmation_child_001",
      idempotencyKey: "idem_batch_confirmation_child_001",
      projectId: "project_001",
      actor,
      tool: "set_sensitive_meta",
      args: { key: "publish_state", value: "approved" },
    });

    await expect(service.executeBatch({ command: batch, commands: [child] })).resolves.toEqual({
      kind: "needs_confirmation",
      confirmationId: "confirmation:batch_confirmation_001",
      risk: "planning_document_review",
      expiresAt: 1_700_086_400_000,
    });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM workspace_meta", params: [] })).resolves.toEqual([{ count: 0 }]);
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM commands", params: [] })).resolves.toEqual([{ count: 1 }]);

    await expect(service.approveConfirmation({
      confirmationId: "confirmation:batch_confirmation_001",
      actor,
      reason: "用户通过外部 Agent 批准该批量规划操作。",
    })).resolves.toEqual({ kind: "ok", resourceRefs: [{ type: "workspace_meta", id: "publish_state" }] });
    await expect(driver.query<{ value_json: string }>({ sql: "SELECT value_json FROM workspace_meta WHERE key = ?", params: ["publish_state"] }))
      .resolves.toEqual([{ value_json: '{"schema_version":1,"value":"approved"}' }]);
    await expect(driver.query<{ status: string; actor_json: string }>({ sql: "SELECT status, actor_json FROM confirmations WHERE confirmation_id = ?", params: ["confirmation:batch_confirmation_001"] }))
      .resolves.toEqual([{ status: "approved", actor_json: '{"kind":"human_via_agent","id":"codex"}' }]);
  });
});

function planner(): CommandPlanner {
  return {
    plan(command, context) {
      if (command.tool === "start_async_test") {
        return {
          kind: "plan",
          steps: [],
          result: { kind: "accepted", taskId: "task_async_001" },
          changes: [],
        };
      }
      if (command.tool === "set_sensitive_meta") {
        if (!context.confirmed) return { kind: "needs_confirmation", risk: "planning_document_review", expiresAt: command.createdAt + 86_400_000 };
        const key = typeof command.args.key === "string" ? command.args.key : "";
        const value = typeof command.args.value === "string" ? command.args.value : "";
        return {
          kind: "plan",
          steps: [{
            sql: "INSERT INTO workspace_meta (key, value_json, updated_at) VALUES (?, ?, ?)",
            params: [key, JSON.stringify({ schema_version: 1, value }), command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          }],
          result: { kind: "ok", revision: 1, resourceRefs: [{ type: "workspace_meta", id: key }] },
          changes: [{ topic: "workspace", resourceType: "workspace_meta", resourceId: key, revision: 1 }],
        };
      }
      if (command.tool !== "set_workspace_meta") return { kind: "blocked", diagnostics: [{ code: "unsupported_tool", message: "不支持的测试命令。" }] };
      const key = typeof command.args.key === "string" ? command.args.key : "";
      const value = typeof command.args.value === "string" ? command.args.value : "";
      return {
        kind: "plan",
        steps: [{
          sql: "INSERT INTO workspace_meta (key, value_json, updated_at) VALUES (?, ?, ?)",
          params: [key, JSON.stringify({ schema_version: 1, value }), command.createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        }],
        result: { kind: "ok", revision: 1, resourceRefs: [{ type: "workspace_meta", id: key }] },
        changes: [{ topic: "workspace", resourceType: "workspace_meta", resourceId: key, revision: 1 }],
      };
    },
  };
}

function envelope(overrides: Partial<CommandEnvelope> & Pick<CommandEnvelope, "commandId" | "idempotencyKey" | "args">): CommandEnvelope {
  return {
    schemaVersion: 1,
    correlationId: "correlation_001",
    actor: { kind: "human", id: "user_001" },
    tool: "set_workspace_meta",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}
