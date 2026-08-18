import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { AnalysisFactService } from "@/application/analysis-fact-service";
import type { TaskRecord, TaskRunner } from "@/application/task-runner";
import { FACT_EXTRACTION_JSON_SCHEMA } from "@/lib/analysis/analysis-json-schemas";
import { parseFactExtractionOutput } from "@/lib/analysis/evidence-validation";
import { sha256Hex } from "@/lib/sha256";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";
import type { ModelResolver } from "@/application/model-resolver";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface LocalFactExtractionRequest {
  baseURL: string;
  model: string;
  providerProfileId?: string;
  systemPrompt: string;
  prompt: string;
  maxTokens: number;
}

export interface LocalFactExtractionCaller {
  complete(input: LocalFactExtractionRequest, signal: AbortSignal): Promise<{ text: string; finishReason: string }>;
}

export interface StartLocalFactExtractionInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  taskId: string;
  analysisProjectId: string;
  analysisUnitId: string;
  baseURL: string;
  model: string;
  providerProfileId?: string;
  maxTokens?: number;
}

export interface ReconfigureLocalFactExtractionInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  taskId: string;
  baseURL: string;
  model: string;
  maxTokens?: number;
}

export interface LocalFactExtractionService {
  start(input: StartLocalFactExtractionInput): Promise<CommandResult>;
  /** 仅允许失败/取消任务显式替换无秘密本机路由和输出预算；taskId 与资源锁保持不变。 */
  reconfigure(input: ReconfigureLocalFactExtractionInput): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  cancel(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}

export interface CreateLocalFactExtractionServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  tasks: TaskRunner;
  objects: ObjectStore;
  facts: AnalysisFactService;
  caller: LocalFactExtractionCaller;
  hostId: string;
  modelResolver?: ModelResolver;
  now?: () => number;
}

/**
 * 本地优先的第一遍事实抽取。完整原文片段与 Prompt 永远只在对象库，SQLite 只保存
 * 经过 span 校验的事实索引；结构化输出最多修复一次，之后失败关闭并留下 Coverage。
 */
export function createLocalFactExtractionService(options: CreateLocalFactExtractionServiceOptions): LocalFactExtractionService {
  const now = options.now ?? Date.now;
  const running = new Map<string, AbortController>();
  return {
    async start(input) {
      const route = options.modelResolver ? await options.modelResolver.resolve({ role: "fact_extractor", complexity: "routine" }) : null;
      const payload = toStoredInput(route ? { ...input, baseURL: route.baseURL, model: route.model, providerProfileId: route.providerProfileId } : input);
      const inputObject = await options.objects.put({ content: encoder.encode(JSON.stringify(payload)), mediaType: "application/vnd.ainovr.local-fact-extraction-input+json" });
      return options.commands.execute({
        ...input.command,
        tool: "start_local_fact_extraction",
        args: { taskId: input.taskId, resourceKey: `local_fact_extraction:${input.analysisProjectId}:${input.analysisUnitId}`, input: inputObject },
      });
    },

    async reconfigure(input) {
      if (!input.taskId.trim()) throw new Error("taskId 必须是非空字符串。 ");
      const previous = await readStoredInput(options.tasks, options.objects, input.taskId);
      const route = options.modelResolver ? await options.modelResolver.resolve({ role: "fact_extractor", complexity: "routine" }) : null;
      const payload = toStoredInput({
        command: input.command,
        taskId: input.taskId,
        analysisProjectId: previous.analysisProjectId,
        analysisUnitId: previous.analysisUnitId,
        baseURL: route?.baseURL ?? input.baseURL,
        model: route?.model ?? input.model,
        ...(route?.providerProfileId ? { providerProfileId: route.providerProfileId } : {}),
        ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
      });
      const inputObject = await options.objects.put({ content: encoder.encode(JSON.stringify(payload)), mediaType: "application/vnd.ainovr.local-fact-extraction-input+json" });
      return options.commands.execute({
        ...input.command,
        tool: "reconfigure_local_fact_extraction",
        args: { taskId: input.taskId, input: inputObject },
      });
    },

    async run(taskId) {
      const claim = await options.tasks.claim(taskId, options.hostId);
      if (!claim.claimed) return options.tasks.get(taskId);
      const controller = new AbortController();
      running.set(taskId, controller);
      const heartbeat = setInterval(() => {
        void options.tasks.heartbeat(taskId, options.hostId).catch(() => controller.abort());
      }, 20_000);
      let latestOutput: string | null = null;
      let input: StoredInput | null = null;
      try {
        input = await readStoredInput(options.tasks, options.objects, taskId);
        const unit = await readUnit(options.driver, options.objects, input.analysisProjectId, input.analysisUnitId);
        const prompt = buildFactExtractionPrompt(unit.spans);
        const promptObject = await options.objects.put({ content: encoder.encode(JSON.stringify({ schema_version: 1, kind: "local_fact_extraction_prompt", taskId, analysisProjectId: input.analysisProjectId, analysisUnitId: input.analysisUnitId, prompt })), mediaType: "application/vnd.ainovr.local-fact-extraction-prompt+json" });
        await options.tasks.checkpoint(taskId, options.hostId, { schema_version: 1, stage: "calling_local_model", model: input.model, promptObjectHash: promptObject.sha256 }, null);
        let completion = await options.caller.complete({ baseURL: input.baseURL, model: input.model, providerProfileId: input.providerProfileId, systemPrompt: factSystemPrompt(), prompt, maxTokens: input.maxTokens }, controller.signal);
        let repairedForLength = false;
        if (completion.finishReason === "length") {
          repairedForLength = true;
          const repairMaxTokens = Math.min(16_384, Math.max(input.maxTokens + 256, input.maxTokens * 4));
          await options.tasks.checkpoint(taskId, options.hostId, { schema_version: 1, stage: "repairing_truncated_local_output", model: input.model, maxTokens: repairMaxTokens }, null);
          completion = await options.caller.complete({
            baseURL: input.baseURL,
            model: input.model,
            providerProfileId: input.providerProfileId,
            systemPrompt: factSystemPrompt(),
            prompt: `${prompt}\n\n上次输出预算不足而被截断。请在不丢失可核验事实的前提下，仅输出紧凑且符合 JSON Schema 的对象。`,
            maxTokens: repairMaxTokens,
          }, controller.signal);
        }
        latestOutput = completion.text;
        if (completion.finishReason !== "stop") throw new FactExtractionFailure("invalid_output", `本地模型输出被截断或异常结束（finish_reason=${completion.finishReason || "unknown"}）。`);
        const parsed = tryParseFacts(completion.text, unit.spans.map((span) => span.spanId));
        if (!parsed.ok) {
          if (repairedForLength) throw new FactExtractionFailure("invalid_output", parsed.message);
          const repaired = await options.caller.complete({
            baseURL: input.baseURL,
            model: input.model,
            providerProfileId: input.providerProfileId,
            systemPrompt: factSystemPrompt(),
            prompt: `${prompt}\n\n上次输出未通过严格校验：${parsed.message}\n请仅重新输出一个符合 JSON Schema 的对象。`,
            maxTokens: input.maxTokens,
          }, controller.signal);
          latestOutput = repaired.text;
          if (repaired.finishReason !== "stop") throw new FactExtractionFailure("invalid_output", `本地模型修复输出被截断或异常结束（finish_reason=${repaired.finishReason || "unknown"}）。`);
          const repairedParsed = tryParseFacts(repaired.text, unit.spans.map((span) => span.spanId));
          if (!repairedParsed.ok) throw new FactExtractionFailure("invalid_output", repairedParsed.message);
        }
        const committed = await options.facts.submit({
          command: { schemaVersion: 1, commandId: `commit:${taskId}`, idempotencyKey: `commit:${taskId}`, correlationId: `task:${taskId}`, actor: { kind: "internal_agent", id: options.hostId }, createdAt: now() },
          analysisProjectId: input.analysisProjectId,
          analysisUnitId: input.analysisUnitId,
          rawOutput: latestOutput,
          task: { taskId, hostId: options.hostId },
        });
        if (committed.kind !== "ok") throw new FactExtractionFailure("commit_failed", "FactLedger 事务未提交。", false);
        return options.tasks.get(taskId);
      } catch (cause) {
        const task = await options.tasks.get(taskId);
        if (task?.status === "cancel_requested") {
          await options.tasks.cancel(taskId, options.hostId).catch(() => undefined);
        } else if (task?.status === "running" && input) {
          const rawOutput = latestOutput === null ? null : await options.objects.put({ content: encoder.encode(latestOutput), mediaType: "application/json; charset=utf-8" });
          const failure = failureFrom(cause);
          const recorded = await options.commands.execute({
            schemaVersion: 1,
            commandId: `fail:${taskId}`,
            idempotencyKey: `fail:${taskId}`,
            correlationId: `task:${taskId}`,
            actor: { kind: "internal_agent", id: options.hostId },
            tool: "fail_local_fact_extraction",
            args: {
              taskId,
              hostId: options.hostId,
              analysisProjectId: input.analysisProjectId,
              analysisUnitId: input.analysisUnitId,
              failure: { code: failure.code, message: failure.message },
              ...(rawOutput ? { rawOutput } : {}),
            },
            createdAt: now(),
          }).catch(() => null);
          if (recorded?.kind !== "ok") {
            await options.tasks.fail(taskId, options.hostId, { code: failure.code, message: failure.message, retryable: false }).catch(() => undefined);
          }
        } else if (task?.status === "running") {
          const failure = failureFrom(cause);
          await options.tasks.fail(taskId, options.hostId, { code: failure.code, message: failure.message, retryable: false }).catch(() => undefined);
        }
        throw cause;
      } finally {
        clearInterval(heartbeat);
        running.delete(taskId);
      }
    },

    async cancel(taskId) {
      await options.tasks.requestCancel(taskId);
      running.get(taskId)?.abort();
    },

    getTask(taskId) {
      return options.tasks.get(taskId);
    },
  };
}

interface StoredInput {
  schema_version: 1;
  taskId: string;
  analysisProjectId: string;
  analysisUnitId: string;
  baseURL: string;
  model: string;
  providerProfileId?: string;
  maxTokens: number;
}

interface UnitSpan {
  spanId: string;
  text: string;
}

function toStoredInput(input: StartLocalFactExtractionInput): StoredInput {
  for (const [key, value] of [["taskId", input.taskId], ["analysisProjectId", input.analysisProjectId], ["analysisUnitId", input.analysisUnitId], ["baseURL", input.baseURL], ["model", input.model]] as const) {
    if (!value.trim()) throw new Error(`${key} 必须是非空字符串。`);
  }
  const maxTokens = input.maxTokens ?? 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 16_384) throw new Error("maxTokens 必须介于 256 和 16384。 ");
  return { schema_version: 1, taskId: input.taskId, analysisProjectId: input.analysisProjectId, analysisUnitId: input.analysisUnitId, baseURL: input.baseURL, model: input.model, ...(input.providerProfileId ? { providerProfileId: input.providerProfileId } : {}), maxTokens };
}

async function readStoredInput(tasks: TaskRunner, objects: ObjectStore, taskId: string): Promise<StoredInput> {
  const inputHash = await tasks.getInputObjectHash(taskId);
  if (!inputHash) throw new Error("本地 FactExtractor 任务缺少输入对象。");
  const parsed: unknown = JSON.parse(decoder.decode(await objects.read(inputHash)));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("本地 FactExtractor 任务输入无效。");
  const record = parsed as Record<string, unknown>;
  if (record.schema_version !== 1 || ["taskId", "analysisProjectId", "analysisUnitId", "baseURL", "model"].some((key) => typeof record[key] !== "string" || !(record[key] as string).trim()) || (record.providerProfileId !== undefined && (typeof record.providerProfileId !== "string" || !record.providerProfileId.trim())) || !Number.isInteger(record.maxTokens)) throw new Error("本地 FactExtractor 任务输入无效。");
  return record as unknown as StoredInput;
}

async function readUnit(driver: SqlDriver, objects: ObjectStore, analysisProjectId: string, analysisUnitId: string): Promise<{ spans: UnitSpan[] }> {
  const rows = await driver.query<{
    span_id: string; start_byte: number; end_byte: number; exact_text_hash: string; normalized_object_hash: string;
  }>({
    sql: `SELECT span.span_id, span.start_byte, span.end_byte, span.exact_text_hash, edition.normalized_object_hash
          FROM source_spans span
          INNER JOIN analysis_units unit ON unit.analysis_unit_id = span.analysis_unit_id
          INNER JOIN analysis_projects project ON project.segmentation_id = unit.segmentation_id
          INNER JOIN source_editions edition ON edition.source_edition_id = span.source_edition_id
          WHERE project.analysis_project_id = ? AND unit.analysis_unit_id = ? AND unit.status = 'prepared'
          ORDER BY span.start_byte ASC, span.span_id ASC`,
    params: [analysisProjectId, analysisUnitId],
  });
  if (rows.length === 0) throw new Error("AnalysisUnit 不存在、未准备好或没有可抽取 SourceSpan。");
  const objectHash = rows[0]!.normalized_object_hash;
  if (rows.some((row) => row.normalized_object_hash !== objectHash)) throw new Error("AnalysisUnit 跨越多个 SourceEdition，无法安全抽取。");
  const content = await objects.read(objectHash);
  const spans = rows.map((row) => {
    const text = decoder.decode(content.slice(row.start_byte, row.end_byte));
    if (sha256Hex(text) !== row.exact_text_hash) throw new Error(`SourceSpan ${row.span_id} exactTextHash 校验失败。`);
    return { spanId: row.span_id, text };
  });
  return { spans };
}

function buildFactExtractionPrompt(spans: UnitSpan[]): string {
  return [
    "你只能从下列 SourceSpan 中提取可观察事实。",
    "每个 evidenceSpanIds 只能使用列出的 spanId；没有可靠事实时返回 {\"facts\":[]}。",
    "每个计算单元最多 16 条事实；每条只引用最多 4 个 spanId。合并重复或同义信息，优先保留状态变化、因果锚点、人物知识、物件状态与未闭合问题。statement 最多 160 个字符，不要复述原文。",
    "字段一致性：kind 为 other 时才填写 rawLabel（且必须非空）；其余核心 kind 的 rawLabel 必须为 null。",
    "不得猜测作者意图，不得把氛围或慢节奏自动解释为叙事功能；必须区分 observed、inferred、hypothesis、unknown 等认识状态。",
    "只输出一个 JSON 对象，不要 Markdown、解释或代码围栏。",
    `JSON Schema：${JSON.stringify(FACT_EXTRACTION_JSON_SCHEMA)}`,
    `SourceSpan：${JSON.stringify(spans)}`,
  ].join("\n\n");
}

function factSystemPrompt(): string {
  return [
    "你是 Ainovr V2 参考分析的局部事实抽取器。",
    "只输出可观察事实，所有支持性事实必须引用输入中真实存在的 spanId。",
    "允许 facts 为空；不得猜测作者意图，不将原文改写为生产指令。",
    "严格只输出一个 JSON 对象。",
  ].join("\n");
}

function tryParseFacts(rawOutput: string, allowedSpanIds: string[]): { ok: true } | { ok: false; message: string } {
  try {
    parseFactExtractionOutput(rawOutput, allowedSpanIds);
    return { ok: true };
  } catch (cause) {
    return { ok: false, message: safeError(cause) };
  }
}

class FactExtractionFailure extends Error {
  constructor(readonly code: "invalid_output" | "commit_failed", message: string, readonly retryable = false) {
    super(message);
  }
}

function failureFrom(cause: unknown): { code: "invalid_output" | "failed_request" | "commit_failed"; message: string } {
  if (cause instanceof FactExtractionFailure) return { code: cause.code, message: safeError(cause) };
  return { code: "failed_request", message: safeError(cause) };
}

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 500);
}
