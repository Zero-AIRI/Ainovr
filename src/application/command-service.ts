import type { CommandEnvelope, CommandResult, DomainDiagnostic } from "@/application/command-types";
import { isAffectedRowsExpectationError, type SqlDriver, type SqlStatement, type TransactionStep } from "@/persistence/sql-driver";

export interface ChangeFeedEntry {
  topic: string;
  resourceType: string;
  resourceId: string;
  revision?: number;
}

/** 仅为带 expectedRevision 的命令声明可安全读取的当前 revision 投影。 */
export interface PlannedCommandConflict {
  expectedRevision: number;
  currentRevisionStatement: SqlStatement;
  resourceType: string;
  resourceId: string;
  message: string;
}

export type PlannedCommand =
  | { kind: "plan"; steps: TransactionStep[]; result: CommandResult; changes: ChangeFeedEntry[]; conflict?: PlannedCommandConflict }
  | { kind: "blocked"; diagnostics: DomainDiagnostic[] }
  | { kind: "needs_confirmation"; risk: string; expiresAt: number };

export interface CommandPlanner {
  plan(command: CommandEnvelope, context: { confirmed: boolean }): PlannedCommand;
}

export interface ApprovalInput {
  confirmationId: string;
  /** 确认只能由直接人类，或携带已获人类授权记录的 Agent 执行。 */
  actor: { kind: "human" | "human_via_agent"; id: string };
  reason: string;
}

/** `apply_batch` 的外层命令与子命令。所有子命令必须属于同一项目且可同步提交。 */
export interface CommandBatchInput {
  command: CommandEnvelope;
  commands: CommandEnvelope[];
}

export interface CommandService {
  execute(command: CommandEnvelope): Promise<CommandResult>;
  executeBatch(input: CommandBatchInput): Promise<CommandResult>;
  approveConfirmation(input: ApprovalInput): Promise<CommandResult>;
  rejectConfirmation(input: ApprovalInput): Promise<CommandResult>;
}

/** 所有写入统一经这个 Application Service；确认前绝不执行领域 SQL。 */
export function createCommandService(driver: SqlDriver, planner: CommandPlanner, now: () => number = Date.now): CommandService {
  const execute = async (command: CommandEnvelope): Promise<CommandResult> => {
    const commandHash = await hashCommand(command);
    const existing = await lookupIdempotency(driver, command.idempotencyKey);
    if (existing) {
      if (existing.commandHash !== commandHash) return idempotencyConflict();
      return existing.result;
    }

    if (command.tool === "apply_batch") return executeBatchCommand(driver, planner, command, commandHash, now);

    const planned = planner.plan(command, { confirmed: false });
    if (planned.kind === "blocked") return planned;
    if (planned.kind === "needs_confirmation") return requestConfirmation(driver, command, commandHash, planned.risk, planned.expiresAt, now);
    return commitPlannedCommand(driver, command, commandHash, planned, now());
  };

  return {
    execute,

    executeBatch(input) {
      return execute({ ...input.command, tool: "apply_batch", args: { commands: input.commands } });
    },

    async approveConfirmation(input) {
      if (!isConfirmationActor(input.actor)) return confirmationActorNotAuthorized();
      const confirmation = await readConfirmation(driver, input.confirmationId);
      if (!confirmation) return { kind: "blocked", diagnostics: [{ code: "confirmation_not_found", message: "确认不存在。" }] };
      if (confirmation.status !== "pending") return { kind: "blocked", diagnostics: [{ code: "confirmation_not_pending", message: "确认不再处于待处理状态。" }] };
      const approvedAt = now();
      if (confirmation.expiresAt < approvedAt) {
        await driver.transaction([
          {
            sql: "UPDATE confirmations SET status = 'expired', resolved_at = ? WHERE confirmation_id = ? AND status = 'pending'",
            params: [approvedAt, input.confirmationId],
            expectAffectedRows: { min: 1, max: 1 },
          },
        ]).catch(() => undefined);
        return { kind: "blocked", diagnostics: [{ code: "confirmation_expired", message: "确认已过期。" }] };
      }
      const command = confirmation.command;
      const commandHash = await hashCommand(command);
      if (commandHash !== confirmation.commandHash) return { kind: "blocked", diagnostics: [{ code: "confirmation_hash_mismatch", message: "原命令已变化，无法批准。" }] };
      if (command.tool === "apply_batch") return approveBatchConfirmation(driver, planner, confirmation, input, now);
      const planned = planner.plan(command, { confirmed: true });
      if (planned.kind === "blocked") return planned;
      if (planned.kind === "needs_confirmation") return { kind: "blocked", diagnostics: [{ code: "confirmation_recheck_failed", message: "批准复核后仍需要新的确认。" }] };

      try {
        await driver.transaction([
          ...planned.steps,
          {
            sql: "UPDATE commands SET result_json = ? WHERE command_id = ? AND command_hash = ?",
            params: [JSON.stringify(planned.result), command.commandId, commandHash],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "UPDATE idempotency_records SET result_json = ? WHERE idempotency_key = ? AND command_hash = ?",
            params: [JSON.stringify(planned.result), command.idempotencyKey, commandHash],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "UPDATE confirmations SET status = 'approved', reason = ?, actor_json = ?, resolved_at = ? WHERE confirmation_id = ? AND status = 'pending' AND command_hash = ?",
            params: [input.reason, JSON.stringify(input.actor), approvedAt, input.confirmationId, commandHash],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "INSERT INTO audit_events (event_id, command_id, actor_json, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            params: [`approval:${input.confirmationId}`, command.commandId, JSON.stringify(input.actor), "confirmation_approved", JSON.stringify({ schema_version: 1, confirmationId: input.confirmationId, commandHash }), approvedAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
          ...changeSteps(planned.changes, approvedAt),
        ]);
        return planned.result;
      } catch (cause) {
        return conflictOrTransactionFailure(driver, planned, cause);
      }
    },

    async rejectConfirmation(input) {
      if (!isConfirmationActor(input.actor)) return confirmationActorNotAuthorized();
      const confirmation = await readConfirmation(driver, input.confirmationId);
      if (!confirmation) return { kind: "blocked", diagnostics: [{ code: "confirmation_not_found", message: "确认不存在。" }] };
      if (confirmation.status !== "pending") return { kind: "blocked", diagnostics: [{ code: "confirmation_not_pending", message: "确认不再处于待处理状态。" }] };
      const rejectedAt = now();
      if (confirmation.expiresAt < rejectedAt) {
        await expireConfirmation(driver, input.confirmationId, rejectedAt);
        return { kind: "blocked", diagnostics: [{ code: "confirmation_expired", message: "确认已过期。" }] };
      }
      const result = rejectedConfirmationResult();
      try {
        await driver.transaction([
          {
            sql: "UPDATE commands SET result_json = ? WHERE command_id = ? AND command_hash = ?",
            params: [JSON.stringify(result), confirmation.command.commandId, confirmation.commandHash],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "UPDATE idempotency_records SET result_json = ? WHERE idempotency_key = ? AND command_hash = ?",
            params: [JSON.stringify(result), confirmation.command.idempotencyKey, confirmation.commandHash],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "UPDATE confirmations SET status = 'rejected', reason = ?, actor_json = ?, resolved_at = ? WHERE confirmation_id = ? AND status = 'pending' AND command_hash = ?",
            params: [input.reason, JSON.stringify(input.actor), rejectedAt, input.confirmationId, confirmation.commandHash],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "INSERT INTO audit_events (event_id, command_id, actor_json, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            params: [`rejection:${input.confirmationId}`, confirmation.command.commandId, JSON.stringify(input.actor), "confirmation_rejected", JSON.stringify({ schema_version: 1, confirmationId: input.confirmationId, commandHash: confirmation.commandHash }), rejectedAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "INSERT INTO change_feed (topic, resource_type, resource_id, revision, created_at) VALUES (?, ?, ?, ?, ?)",
            params: ["confirmations", "confirmation", input.confirmationId, null, rejectedAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
        ]);
        return result;
      } catch {
        return transactionFailed();
      }
    },
  };
}

interface ParsedBatch {
  projectId: string;
  commands: CommandEnvelope[];
}

type PlannedBatch =
  | { kind: "plan"; commands: Array<{ command: CommandEnvelope; planned: Extract<PlannedCommand, { kind: "plan" }> }>; result: Extract<CommandResult, { kind: "ok" }>; changes: ChangeFeedEntry[] }
  | { kind: "blocked"; diagnostics: DomainDiagnostic[] }
  | { kind: "needs_confirmation"; risk: string; expiresAt: number };

async function executeBatchCommand(driver: SqlDriver, planner: CommandPlanner, command: CommandEnvelope, commandHash: string, now: () => number): Promise<CommandResult> {
  const parsed = parseBatch(command);
  if ("kind" in parsed) return parsed;
  const childKeys = await checkBatchChildKeys(driver, command, parsed.commands);
  if (childKeys) return childKeys;
  const planned = planBatch(planner, parsed, false);
  if (planned.kind === "blocked") return planned;
  if (planned.kind === "needs_confirmation") return requestConfirmation(driver, command, commandHash, planned.risk, planned.expiresAt, now);
  return commitPlannedBatch(driver, command, commandHash, planned, now());
}

async function approveBatchConfirmation(driver: SqlDriver, planner: CommandPlanner, confirmation: StoredConfirmation, input: ApprovalInput, now: () => number): Promise<CommandResult> {
  const command = confirmation.command;
  const parsed = parseBatch(command);
  if ("kind" in parsed) return parsed;
  const childKeys = await checkBatchChildKeys(driver, command, parsed.commands, true);
  if (childKeys) return childKeys;
  const planned = planBatch(planner, parsed, true);
  if (planned.kind === "blocked") return planned;
  if (planned.kind === "needs_confirmation") return { kind: "blocked", diagnostics: [{ code: "confirmation_recheck_failed", message: "批量命令批准复核后仍需要新的确认。" }] };
  const approvedAt = now();
  const commandHash = confirmation.commandHash;
  try {
    const childLedger = await batchChildLedgerSteps(planned, approvedAt);
    await driver.transaction([
      ...planned.commands.flatMap(({ planned: child }) => child.steps),
      ...childLedger,
      {
        sql: "UPDATE commands SET result_json = ? WHERE command_id = ? AND command_hash = ?",
        params: [JSON.stringify(planned.result), command.commandId, commandHash],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "UPDATE idempotency_records SET result_json = ? WHERE idempotency_key = ? AND command_hash = ?",
        params: [JSON.stringify(planned.result), command.idempotencyKey, commandHash],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "UPDATE confirmations SET status = 'approved', reason = ?, actor_json = ?, resolved_at = ? WHERE confirmation_id = ? AND status = 'pending' AND command_hash = ?",
        params: [input.reason, JSON.stringify(input.actor), approvedAt, input.confirmationId, commandHash],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO audit_events (event_id, command_id, actor_json, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params: [`approval:${input.confirmationId}`, command.commandId, JSON.stringify(input.actor), "confirmation_approved", JSON.stringify({ schema_version: 1, confirmationId: input.confirmationId, commandHash }), approvedAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      ...changeSteps([...planned.changes, batchChange(command)], approvedAt),
    ]);
    return planned.result;
  } catch {
    return transactionFailed();
  }
}

function parseBatch(command: CommandEnvelope): ParsedBatch | Extract<PlannedBatch, { kind: "blocked" }> {
  // 外部协议永远不得提供可执行的原始 CommandEnvelope。MCP/CLI 不暴露 batch；
  // 此 in-process 批处理仅保留给受信任的 Application 编排，仍会经过同一 planner。
  if (command.actor.kind === "external_agent") return batchBlocked("batch_actor_not_authorized", "外部 Agent 不可提交原始批量命令。请调用具体领域工具。 ");
  const sensitiveTools = new Set(["commit_chapter_production", "start_reference_file_import", "restore_workspace", "review_mechanism_asset", "commit_project_planning_document"]);
  const projectId = command.projectId;
  const raw = command.args.commands;
  if (typeof projectId !== "string" || !projectId.trim()) return batchBlocked("batch_project_required", "apply_batch 必须绑定一个非空 projectId。 ");
  if (!Array.isArray(raw) || raw.length === 0) return batchBlocked("batch_commands_required", "apply_batch 需要至少一个子命令。 ");
  if (raw.some((item) => !isCommandEnvelope(item))) return batchBlocked("batch_invalid_command", "apply_batch 子命令必须是完整且合法的 CommandEnvelope。 ");
  const commands = raw as CommandEnvelope[];
  if (commands.some((child) => sensitiveTools.has(child.tool))) return batchBlocked("batch_sensitive_tool_not_allowed", "敏感领域命令不能通过 apply_batch 执行，请调用对应领域服务。 ");
  if (commands.some((child) => child.tool === "apply_batch")) return batchBlocked("batch_nested_command", "apply_batch 不允许嵌套批量命令。 ");
  if (commands.some((child) => child.projectId !== projectId)) return batchBlocked("batch_project_mismatch", "apply_batch 的所有子命令必须属于外层的同一项目。 ");
  if (commands.some((child) => child.actor.kind !== command.actor.kind || child.actor.id !== command.actor.id)) return batchBlocked("batch_actor_mismatch", "apply_batch 的所有子命令必须使用与外层一致的 actor。 ");
  if (commands.some((child) => child.correlationId !== command.correlationId)) return batchBlocked("batch_correlation_mismatch", "apply_batch 的所有子命令必须使用与外层一致的 correlationId。 ");
  if (new Set(commands.map((child) => child.commandId)).size !== commands.length || new Set(commands.map((child) => child.idempotencyKey)).size !== commands.length) return batchBlocked("batch_duplicate_child", "apply_batch 子命令的 commandId 和 idempotencyKey 不可重复。 ");
  if (commands.some((child) => child.commandId === command.commandId || child.idempotencyKey === command.idempotencyKey)) return batchBlocked("batch_outer_key_collision", "apply_batch 外层命令不能与子命令复用 commandId 或 idempotencyKey。 ");
  return { projectId, commands };
}

function isConfirmationActor(actor: { kind: string; id: string }): actor is ApprovalInput["actor"] {
  return (actor.kind === "human" || actor.kind === "human_via_agent") && typeof actor.id === "string" && actor.id.trim().length > 0;
}

function confirmationActorNotAuthorized(): CommandResult {
  return { kind: "blocked", diagnostics: [{ code: "confirmation_actor_not_authorized", message: "确认只能由 human 或 human_via_agent 执行。" }] };
}

function planBatch(planner: CommandPlanner, batch: ParsedBatch, confirmed: boolean): PlannedBatch {
  const plannedCommands: Array<{ command: CommandEnvelope; planned: Extract<PlannedCommand, { kind: "plan" }> }> = [];
  const risks: Array<{ risk: string; expiresAt: number }> = [];
  for (const child of batch.commands) {
    const planned = planner.plan(child, { confirmed });
    if (planned.kind === "blocked") return planned;
    if (planned.kind === "needs_confirmation") {
      risks.push({ risk: planned.risk, expiresAt: planned.expiresAt });
      continue;
    }
    if (planned.result.kind !== "ok") return batchBlocked("batch_async_command", `apply_batch 只允许同步命令；${child.tool} 会创建异步任务。`);
    plannedCommands.push({ command: child, planned });
  }
  if (risks.length > 0) {
    if (confirmed) return batchBlocked("confirmation_recheck_failed", "批量命令批准复核后仍存在未满足的确认条件。 ");
    const highest = risks.reduce((current, candidate) => riskRank(candidate.risk) > riskRank(current.risk) ? candidate : current);
    return { kind: "needs_confirmation", risk: highest.risk, expiresAt: Math.min(...risks.map((item) => item.expiresAt)) };
  }
  // `plannedCommands` only receives synchronous `ok` results above, but the
  // shared PlannedCommand type also covers accepted/error outcomes. Keep the
  // narrowing explicit here so the batch result remains type-safe if the
  // planner grows another result variant later.
  const resourceRefs = plannedCommands.flatMap(({ planned }) => planned.result.kind === "ok" ? planned.result.resourceRefs : []);
  return {
    kind: "plan",
    commands: plannedCommands,
    result: { kind: "ok", resourceRefs: uniqueResourceRefs(resourceRefs) },
    changes: plannedCommands.flatMap(({ planned }) => planned.changes),
  };
}

async function checkBatchChildKeys(driver: SqlDriver, outer: CommandEnvelope, commands: CommandEnvelope[], outerAlreadyRecorded = false): Promise<Extract<PlannedBatch, { kind: "blocked" }> | null> {
  for (const child of commands) {
    const existing = await lookupIdempotency(driver, child.idempotencyKey);
    if (existing) return batchBlocked("batch_child_idempotency_exists", `子命令 ${child.commandId} 的 idempotencyKey 已被使用，不能纳入批量事务。`);
    const rows = await driver.query<{ command_id: string }>({ sql: "SELECT command_id FROM commands WHERE command_id = ?", params: [child.commandId] });
    if (rows.length > 0) return batchBlocked("batch_child_command_exists", `子命令 ${child.commandId} 已存在，不能纳入批量事务。`);
  }
  if (outerAlreadyRecorded) return null;
  const outerRows = await driver.query<{ command_id: string }>({ sql: "SELECT command_id FROM commands WHERE command_id = ?", params: [outer.commandId] });
  return outerRows.length > 0 ? batchBlocked("batch_command_exists", "apply_batch 的 commandId 已存在。 ") : null;
}

async function commitPlannedBatch(driver: SqlDriver, command: CommandEnvelope, commandHash: string, planned: Extract<PlannedBatch, { kind: "plan" }>, committedAt: number): Promise<CommandResult> {
  try {
    const childLedger = await batchChildLedgerSteps(planned, committedAt);
    await driver.transaction([
      ...planned.commands.flatMap(({ planned: child }) => child.steps),
      ...childLedger,
      ...ledgerSteps(command, commandHash, planned.result, committedAt, "command_batch_committed"),
      ...changeSteps([...planned.changes, batchChange(command)], committedAt),
    ]);
    return planned.result;
  } catch {
    return transactionFailed();
  }
}

async function batchChildLedgerSteps(planned: Extract<PlannedBatch, { kind: "plan" }>, committedAt: number): Promise<TransactionStep[]> {
  return (await Promise.all(planned.commands.map(async ({ command, planned: child }) => ledgerSteps(command, await hashCommand(command), child.result, committedAt, "batched_command_committed")))).flat();
}

function requestConfirmation(driver: SqlDriver, command: CommandEnvelope, commandHash: string, risk: string, expiresAt: number, now: () => number): Promise<CommandResult> {
  const confirmationId = `confirmation:${command.commandId}`;
  const result: CommandResult = { kind: "needs_confirmation", confirmationId, risk, expiresAt };
  const createdAt = now();
  return driver.transaction([
    ...ledgerSteps(command, commandHash, result, createdAt, "confirmation_requested"),
    {
      sql: "INSERT INTO confirmations (confirmation_id, command_id, command_hash, risk, status, reason, actor_json, expires_at, resolved_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
      params: [confirmationId, command.commandId, commandHash, risk, null, null, expiresAt, null],
      expectAffectedRows: { min: 1, max: 1 },
    },
    {
      sql: "INSERT INTO change_feed (topic, resource_type, resource_id, revision, created_at) VALUES (?, ?, ?, ?, ?)",
      params: ["confirmations", "confirmation", confirmationId, null, createdAt],
      expectAffectedRows: { min: 1, max: 1 },
    },
  ]).then(() => result).catch(() => transactionFailed());
}

function batchBlocked(code: string, message: string): Extract<PlannedBatch, { kind: "blocked" }> {
  return { kind: "blocked", diagnostics: [{ code, message }] };
}

function batchChange(command: CommandEnvelope): ChangeFeedEntry {
  return { topic: "commands", resourceType: "command_batch", resourceId: command.commandId };
}

function uniqueResourceRefs(resourceRefs: Array<{ type: string; id: string }>): Array<{ type: string; id: string }> {
  const seen = new Set<string>();
  return resourceRefs.filter((ref) => {
    const key = `${ref.type}\u0000${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function riskRank(risk: string): number {
  return ({ workspace_restore: 50, reference_file_import: 40, chapter_production_commit: 30, mechanism_adoption: 20, planning_document_review: 10, story_concept_selection: 10 } as Record<string, number>)[risk] ?? 1;
}

function isCommandEnvelope(value: unknown): value is CommandEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const actor = candidate.actor;
  return candidate.schemaVersion === 1
    && typeof candidate.commandId === "string" && candidate.commandId.trim().length > 0
    && typeof candidate.idempotencyKey === "string" && candidate.idempotencyKey.trim().length > 0
    && typeof candidate.correlationId === "string" && candidate.correlationId.trim().length > 0
    && typeof candidate.tool === "string" && candidate.tool.trim().length > 0
    && Number.isInteger(candidate.createdAt)
    && (!Object.prototype.hasOwnProperty.call(candidate, "projectId") || typeof candidate.projectId === "string")
    && typeof candidate.args === "object" && candidate.args !== null && !Array.isArray(candidate.args)
    && !!actor && typeof actor === "object" && !Array.isArray(actor)
    && ["human", "human_via_agent", "external_agent", "internal_agent", "system"].includes((actor as Record<string, unknown>).kind as string)
    && typeof (actor as Record<string, unknown>).id === "string" && ((actor as Record<string, unknown>).id as string).trim().length > 0;
}

async function commitPlannedCommand(driver: SqlDriver, command: CommandEnvelope, commandHash: string, planned: Extract<PlannedCommand, { kind: "plan" }>, committedAt: number): Promise<CommandResult> {
  try {
    await driver.transaction([...planned.steps, ...ledgerSteps(command, commandHash, planned.result, committedAt, "command_committed"), ...changeSteps(planned.changes, committedAt)]);
    return planned.result;
  } catch (cause) {
    return conflictOrTransactionFailure(driver, planned, cause);
  }
}

async function conflictOrTransactionFailure(driver: SqlDriver, planned: Extract<PlannedCommand, { kind: "plan" }>, cause: unknown): Promise<CommandResult> {
  const hint = planned.conflict;
  if (!hint || !isAffectedRowsExpectationError(cause)) return transactionFailed();
  try {
    const rows = await driver.query<{ current_revision: number }>(hint.currentRevisionStatement);
    const currentRevision = rows[0]?.current_revision;
    if (!Number.isInteger(currentRevision) || currentRevision === hint.expectedRevision) return transactionFailed();
    return {
      kind: "conflict",
      currentRevision,
      diagnostics: [{ code: "revision_conflict", message: hint.message }],
    };
  } catch {
    return transactionFailed();
  }
}

function ledgerSteps(command: CommandEnvelope, commandHash: string, result: CommandResult, createdAt: number, eventType: string): TransactionStep[] {
  return [
    {
      sql: "INSERT INTO commands (command_id, command_hash, idempotency_key, correlation_id, actor_json, project_id, expected_revision, tool, args_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [command.commandId, commandHash, command.idempotencyKey, command.correlationId, JSON.stringify(command.actor), command.projectId ?? null, command.expectedRevision ?? null, command.tool, JSON.stringify(command.args), JSON.stringify(result), createdAt],
      expectAffectedRows: { min: 1, max: 1 },
    },
    {
      sql: "INSERT INTO idempotency_records (idempotency_key, command_hash, result_json, created_at) VALUES (?, ?, ?, ?)",
      params: [command.idempotencyKey, commandHash, JSON.stringify(result), createdAt],
      expectAffectedRows: { min: 1, max: 1 },
    },
    {
      sql: "INSERT INTO audit_events (event_id, command_id, actor_json, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      params: [`audit:${command.commandId}`, command.commandId, JSON.stringify(command.actor), eventType, JSON.stringify({ schema_version: 1, tool: command.tool, commandHash, correlationId: command.correlationId }), createdAt],
      expectAffectedRows: { min: 1, max: 1 },
    },
  ];
}

function changeSteps(changes: ChangeFeedEntry[], createdAt: number): TransactionStep[] {
  return changes.map((change) => ({
    sql: "INSERT INTO change_feed (topic, resource_type, resource_id, revision, created_at) VALUES (?, ?, ?, ?, ?)",
    params: [change.topic, change.resourceType, change.resourceId, change.revision ?? null, createdAt],
    expectAffectedRows: { min: 1, max: 1 },
  }));
}

interface StoredIdempotencyRecord { commandHash: string; result: CommandResult }

async function lookupIdempotency(driver: SqlDriver, idempotencyKey: string): Promise<StoredIdempotencyRecord | null> {
  const rows = await driver.query<{ command_hash: string; result_json: string }>({ sql: "SELECT command_hash, result_json FROM idempotency_records WHERE idempotency_key = ?", params: [idempotencyKey] });
  const row = rows[0];
  return row ? { commandHash: row.command_hash, result: JSON.parse(row.result_json) as CommandResult } : null;
}

interface StoredConfirmation {
  status: string;
  expiresAt: number;
  commandHash: string;
  command: CommandEnvelope;
}

async function readConfirmation(driver: SqlDriver, confirmationId: string): Promise<StoredConfirmation | null> {
  const rows = await driver.query<{
    status: string; expires_at: number; command_hash: string; command_id: string; idempotency_key: string; correlation_id: string; actor_json: string; project_id: string | null; expected_revision: number | null; tool: string; args_json: string; created_at: number;
  }>({
    sql: `SELECT cf.status, cf.expires_at, cf.command_hash, c.command_id, c.idempotency_key, c.correlation_id, c.actor_json, c.project_id, c.expected_revision, c.tool, c.args_json, c.created_at
          FROM confirmations cf INNER JOIN commands c ON c.command_id = cf.command_id WHERE cf.confirmation_id = ?`,
    params: [confirmationId],
  });
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    expiresAt: row.expires_at,
    commandHash: row.command_hash,
    command: { schemaVersion: 1, commandId: row.command_id, idempotencyKey: row.idempotency_key, correlationId: row.correlation_id, actor: JSON.parse(row.actor_json) as CommandEnvelope["actor"], projectId: row.project_id ?? undefined, expectedRevision: row.expected_revision ?? undefined, tool: row.tool, args: JSON.parse(row.args_json) as Record<string, unknown>, createdAt: row.created_at },
  };
}

async function hashCommand(command: CommandEnvelope): Promise<string> {
  const source = stableJson({ schemaVersion: command.schemaVersion, actor: command.actor, projectId: command.projectId ?? null, expectedRevision: command.expectedRevision ?? null, tool: command.tool, args: command.args });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function transactionFailed(): CommandResult { return { kind: "error", code: "command_transaction_failed", message: "命令事务未提交。", retryable: false }; }
function idempotencyConflict(): CommandResult { return { kind: "error", code: "idempotency_conflict", message: "同一 idempotencyKey 对应不同命令。", retryable: false }; }
function rejectedConfirmationResult(): CommandResult { return { kind: "blocked", diagnostics: [{ code: "confirmation_rejected", message: "该命令已被拒绝。" }] }; }

async function expireConfirmation(driver: SqlDriver, confirmationId: string, expiredAt: number): Promise<void> {
  await driver.transaction([
    {
      sql: "UPDATE confirmations SET status = 'expired', resolved_at = ? WHERE confirmation_id = ? AND status = 'pending'",
      params: [expiredAt, confirmationId],
      expectAffectedRows: { min: 1, max: 1 },
    },
    {
      sql: "INSERT INTO change_feed (topic, resource_type, resource_id, revision, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM confirmations WHERE confirmation_id = ? AND status = 'expired' AND resolved_at = ?)",
      params: ["confirmations", "confirmation", confirmationId, null, expiredAt, confirmationId, expiredAt],
      expectAffectedRows: { min: 0, max: 1 },
    },
  ]).catch(() => undefined);
}
