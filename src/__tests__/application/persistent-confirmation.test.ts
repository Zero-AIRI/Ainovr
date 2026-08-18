import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCommandService, type CommandPlanner } from "@/application/command-service";
import type { CommandEnvelope } from "@/application/command-types";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("持久化 Confirmation", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-persistent-confirmation-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("确认前不执行领域写入；human_via_agent 批准后重新规划并原子提交", async () => {
    const time = 1_700_000_000_000;
    const service = createCommandService(driver, riskyPlanner(), () => time);
    const pending = await service.execute(envelope());

    expect(pending).toEqual({ kind: "needs_confirmation", confirmationId: "confirmation:command_001", risk: "overwrite", expiresAt: time + 60_000 });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM workspace_meta", params: [] })).resolves.toEqual([{ count: 0 }]);

    const approved = await service.approveConfirmation({
      confirmationId: "confirmation:command_001",
      actor: { kind: "human_via_agent", id: "codex" },
      reason: "用户在对话中明确批准。",
    });
    expect(approved).toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "workspace_meta", id: "dangerous" }] });
    await expect(driver.query<{ value_json: string }>({ sql: "SELECT value_json FROM workspace_meta WHERE key = ?", params: ["dangerous"] }))
      .resolves.toEqual([{ value_json: '{"schema_version":1,"value":"approved"}' }]);
    await expect(driver.query<{ status: string; actor_json: string; reason: string }>({ sql: "SELECT status, actor_json, reason FROM confirmations", params: [] }))
      .resolves.toEqual([{ status: "approved", actor_json: '{"kind":"human_via_agent","id":"codex"}', reason: "用户在对话中明确批准。" }]);
  });

  it("过期确认不得执行原命令", async () => {
    let time = 1_700_000_000_000;
    const service = createCommandService(driver, riskyPlanner(), () => time);
    await service.execute(envelope());
    time += 60_001;

    await expect(service.approveConfirmation({ confirmationId: "confirmation:command_001", actor: { kind: "human_via_agent", id: "codex" }, reason: "迟到批准" }))
      .resolves.toEqual({ kind: "blocked", diagnostics: [{ code: "confirmation_expired", message: "确认已过期。" }] });
    await expect(driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM workspace_meta", params: [] })).resolves.toEqual([{ count: 0 }]);
  });

  it("拒绝确认会持久化 human_via_agent 审计，并让后续同幂等命令返回拒绝结果", async () => {
    const service = createCommandService(driver, riskyPlanner(), () => 1_700_000_000_000);
    await service.execute(envelope());

    await expect(service.rejectConfirmation({
      confirmationId: "confirmation:command_001",
      actor: { kind: "human_via_agent", id: "codex" },
      reason: "不批准覆盖操作。",
    })).resolves.toEqual({ kind: "blocked", diagnostics: [{ code: "confirmation_rejected", message: "该命令已被拒绝。" }] });
    await expect(service.execute(envelope())).resolves.toEqual({ kind: "blocked", diagnostics: [{ code: "confirmation_rejected", message: "该命令已被拒绝。" }] });
    await expect(driver.query<{ status: string; actor_json: string; reason: string }>({
      sql: "SELECT status, actor_json, reason FROM confirmations",
      params: [],
    })).resolves.toEqual([{ status: "rejected", actor_json: '{"kind":"human_via_agent","id":"codex"}', reason: "不批准覆盖操作。" }]);
    await expect(driver.query<{ event_type: string }>({
      sql: "SELECT event_type FROM audit_events WHERE command_id = ? ORDER BY created_at ASC, event_id ASC",
      params: ["command_001"],
    })).resolves.toEqual([{ event_type: "confirmation_requested" }, { event_type: "confirmation_rejected" }]);
  });
});

function riskyPlanner(): CommandPlanner {
  return {
    plan(command, context) {
      if (!context.confirmed) return { kind: "needs_confirmation", risk: "overwrite", expiresAt: command.createdAt + 60_000 };
      if (command.expectedRevision !== 3) return { kind: "blocked", diagnostics: [{ code: "expected_revision_lost", message: "确认恢复时丢失了 expectedRevision。" }] };
      return {
        kind: "plan",
        steps: [{
          sql: "INSERT INTO workspace_meta (key, value_json, updated_at) VALUES (?, ?, ?)",
          params: ["dangerous", '{"schema_version":1,"value":"approved"}', command.createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        }],
        result: { kind: "ok", revision: 1, resourceRefs: [{ type: "workspace_meta", id: "dangerous" }] },
        changes: [{ topic: "workspace", resourceType: "workspace_meta", resourceId: "dangerous", revision: 1 }],
      };
    },
  };
}

function envelope(): CommandEnvelope {
  return {
    schemaVersion: 1,
    commandId: "command_001",
    idempotencyKey: "idem_001",
    correlationId: "correlation_001",
    actor: { kind: "human", id: "user_001" },
    expectedRevision: 3,
    tool: "dangerous_write",
    args: {},
    createdAt: 1_700_000_000_000,
  };
}
