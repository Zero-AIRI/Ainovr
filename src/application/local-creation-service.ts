import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { TaskRecord, TaskRunner } from "@/application/task-runner";
import { createProjectDocumentRepository } from "@/persistence/project-document-repository";
import type { ObjectReference, ObjectStore } from "@/persistence/object-store";
import type { PayloadSchemaRegistry } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";
import type { ModelResolver, ModelRole, ModelWireProtocol, ResolvedModelRoute } from "@/application/model-resolver";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type LocalCreationOutputMode = "creative_text" | "structured_json";

export interface LocalModelCompletionRequest {
  baseURL: string;
  model: string;
  providerProfileId?: string;
  protocol?: ModelWireProtocol;
  prompt: string;
  maxTokens: number;
  outputMode?: LocalCreationOutputMode;
}

export interface LocalModelCaller {
  complete(input: LocalModelCompletionRequest, signal: AbortSignal): Promise<{ text: string; finishReason: string }>;
}

export interface StartLocalCreationInput {
  command: Omit<CommandEnvelope, "tool" | "args">;
  taskId: string;
  documentId: string;
  projectId: string;
  title: string;
  prompt: string;
  baseURL: string;
  model: string;
  providerProfileId?: string;
  protocol?: ModelWireProtocol;
  /** 仅由受控 PipelineRun 传入的已冻结无 Secret 路由。 */
  frozenRoute?: ResolvedModelRoute;
  /** 仅由 ModelResolver 冻结，防止任务执行时悄然改变有效上下文边界。 */
  modelContextWindowTokens?: number;
  safetyMarginRatio?: number;
  maxTokens?: number;
  /** 仅保存小型、非秘密的产物索引；完整 Prompt 仍只进入对象库。 */
  metadata?: Record<string, unknown>;
  outputMode?: LocalCreationOutputMode;
}

export interface LocalCreationDraft {
  documentId: string;
  projectId: string;
  revision: number;
  title: string;
  text: string;
  model: string;
  taskId: string;
  metadata?: Record<string, unknown>;
}

/** 可选的结构化任务闸门；在对象写入与草稿提交之前运行。 */
export interface LocalCreationOutputValidationInput {
  taskId: string;
  documentId: string;
  projectId: string;
  title: string;
  prompt: string;
  baseURL: string;
  model: string;
  maxTokens: number;
  metadata?: Record<string, unknown>;
}

/** 将已通过模型输出校验的对象提交为特定领域结果，而非通用草稿。 */
export type LocalCreationCommitOutput = (input: LocalCreationOutputValidationInput & { text: string; output: ObjectReference }) => Promise<void>;

export interface LocalCreationService {
  start(input: StartLocalCreationInput): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  cancel(taskId: string): Promise<void>;
  getDraft(documentId: string): Promise<LocalCreationDraft | null>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}

export interface CreateLocalCreationServiceOptions {
  driver: SqlDriver;
  schemas: PayloadSchemaRegistry;
  commands: CommandService;
  tasks: TaskRunner;
  objects: ObjectStore;
  caller: LocalModelCaller;
  hostId: string;
  /** Runtime routing is authoritative when configured; raw endpoint/model
   * fields remain only for backwards-compatible local test harnesses. */
  modelResolver?: ModelResolver;
  defaultModelRole?: ModelRole;
  validateOutput?: (input: LocalCreationOutputValidationInput, text: string) => void | Promise<void>;
  commitOutput?: LocalCreationCommitOutput;
  now?: () => number;
}

/**
 * 新 Application Service 的最小创作垂直链。它只产出可审阅草稿：不得写 Canon、
 * 人物知识或 ReaderState；正式章节提交必须走后续 ProductionCommit 命令。
 */
export function createLocalCreationService(options: CreateLocalCreationServiceOptions): LocalCreationService {
  const now = options.now ?? Date.now;
  const documents = createProjectDocumentRepository(options.driver, options.schemas, now);
  const running = new Map<string, AbortController>();

  return {
    async start(input) {
      const route = input.frozenRoute ?? (options.modelResolver
        ? await options.modelResolver.resolve({ role: modelRoleFromMetadata(input.metadata) ?? options.defaultModelRole ?? "writer" })
        : null);
      const expectedRole = modelRoleFromMetadata(input.metadata) ?? options.defaultModelRole ?? "writer";
      if (route && route.role !== expectedRole) throw new Error("冻结的 Provider 路由与任务角色不匹配。 ");
      if (route && input.maxTokens !== undefined && input.maxTokens > route.maxOutputTokens) throw new Error(`请求输出预算 ${input.maxTokens} 超过当前 Provider/Workspace 有效上限 ${route.maxOutputTokens}。`);
      const payload = toInputPayload(route ? {
        ...input,
        baseURL: route.baseURL,
        model: route.model,
        providerProfileId: route.providerProfileId,
        protocol: route.protocol,
        modelContextWindowTokens: route.contextWindowTokens,
        safetyMarginRatio: route.safetyMarginRatio,
        ...(input.maxTokens === undefined ? { maxTokens: route.maxOutputTokens } : {}),
      } : input);
      assertPromptFitsModelWindow(payload, payload.prompt);
      const inputObject = await options.objects.put({ content: encoder.encode(JSON.stringify(payload)), mediaType: "application/vnd.ainovr.local-creation-input+json" });
      return options.commands.execute({
        ...input.command,
        projectId: input.projectId,
        tool: "start_local_creation",
        // 完整 prompt 仅在对象库；命令、审计和 change feed 只引用其 hash。
        args: { taskId: input.taskId, resourceKey: `local_creation:${input.projectId}:${input.documentId}`, input: inputObject },
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
      try {
        const input = await readInput(options.tasks, options.objects, taskId);
        await options.tasks.checkpoint(taskId, options.hostId, { schema_version: 1, stage: "calling_local_model", model: input.model }, null);
        let completion = await options.caller.complete({ baseURL: input.baseURL, model: input.model, providerProfileId: input.providerProfileId, protocol: input.protocol, prompt: input.prompt, maxTokens: input.maxTokens, outputMode: input.outputMode }, controller.signal);
        let text = completedText(completion);
        try {
          await options.validateOutput?.(input, text);
        } catch (cause) {
          // Writer 的自然语言正文绝不自动重写；只有结构化任务才允许一次、且仅一次
          // 向同一模型反馈校验错误的修复请求。第二次仍不通过则沿用原异常路径 fail closed。
          if (input.outputMode !== "structured_json") throw cause;
          await options.tasks.checkpoint(taskId, options.hostId, {
            schema_version: 1,
            stage: "repairing_structured_output",
            model: input.model,
            attempt: 1,
            diagnostic: safeTaskError(cause),
          }, null);
          const repairPrompt = structuredRepairPrompt(input.prompt, text, safeTaskError(cause), input.metadata);
          assertPromptFitsModelWindow(input, repairPrompt);
          completion = await options.caller.complete({
            baseURL: input.baseURL,
            model: input.model,
            providerProfileId: input.providerProfileId,
            protocol: input.protocol,
            prompt: repairPrompt,
            maxTokens: input.maxTokens,
            outputMode: input.outputMode,
          }, controller.signal);
          text = completedText(completion);
          await options.validateOutput?.(input, text);
        }
        const output = await options.objects.put({ content: encoder.encode(text), mediaType: "text/plain; charset=utf-8" });
        if (options.commitOutput) {
          await options.commitOutput({ ...input, text, output });
          await options.tasks.succeed(taskId, options.hostId, output.sha256);
          return options.tasks.get(taskId);
        }
        const result = await options.commands.execute({
          schemaVersion: 1,
          commandId: `commit:${taskId}`,
          idempotencyKey: `commit:${taskId}`,
          correlationId: `task:${taskId}`,
          actor: { kind: "internal_agent", id: options.hostId },
          projectId: input.projectId,
          tool: "commit_local_creation_draft",
          args: {
            taskId,
            hostId: options.hostId,
            documentId: input.documentId,
            projectId: input.projectId,
            title: input.title,
            output,
            payload: {
              schema_version: 1,
              kind: "local_creation_draft",
              taskId,
              provider: "local_openai_compatible",
              model: input.model,
              finishReason: completion.finishReason,
              generatedAt: now(),
              ...(input.metadata ? { contextMetadata: input.metadata } : {}),
            },
          },
          createdAt: now(),
        });
        if (result.kind !== "ok") throw new Error(`本地草稿提交失败：${result.kind === "error" ? result.message : "命令未完成"}`);
        return options.tasks.get(taskId);
      } catch (cause) {
        const task = await options.tasks.get(taskId);
        if (task?.status === "cancel_requested") {
          await options.tasks.cancel(taskId, options.hostId).catch(() => undefined);
        } else {
          await options.tasks.fail(taskId, options.hostId, { code: "local_creation_failed", message: safeTaskError(cause), retryable: false }).catch(() => undefined);
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

    async getDraft(documentId) {
      const document = await documents.get(documentId);
      if (!document || document.documentType !== "local_creation_draft" || !document.contentObjectHash) return null;
      const payload = document.payload;
      const title = typeof payload.title === "string" ? payload.title : "未命名草稿";
      const model = typeof payload.model === "string" ? payload.model : "";
      const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
      const metadata = record(payload.contextMetadata);
      return { documentId: document.documentId, projectId: document.projectId, revision: document.revision, title, model, taskId, text: decoder.decode(await options.objects.read(document.contentObjectHash)), ...(metadata ? { metadata } : {}) };
    },

    getTask(taskId) {
      return options.tasks.get(taskId);
    },
  };
}

interface StoredLocalCreationInput extends LocalCreationOutputValidationInput {
  schema_version: 1;
  outputMode: LocalCreationOutputMode;
  providerProfileId?: string;
  protocol?: ModelWireProtocol;
  modelContextWindowTokens?: number;
  safetyMarginRatio?: number;
}

function toInputPayload(input: StartLocalCreationInput): StoredLocalCreationInput {
  const strings: Array<[string, string]> = [["taskId", input.taskId], ["documentId", input.documentId], ["projectId", input.projectId], ["title", input.title], ["prompt", input.prompt], ["baseURL", input.baseURL], ["model", input.model]];
  for (const [key, value] of strings) if (!value.trim()) throw new Error(`${key} 必须是非空字符串。`);
  const maxTokens = input.maxTokens ?? 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 16_384) throw new Error("maxTokens 必须介于 256 和 16384。 ");
  if (input.metadata !== undefined && !record(input.metadata)) throw new Error("metadata 必须是对象。 ");
  const outputMode = input.outputMode ?? "creative_text";
  if (outputMode !== "creative_text" && outputMode !== "structured_json") throw new Error("outputMode 非法。 ");
  if ((input.modelContextWindowTokens === undefined) !== (input.safetyMarginRatio === undefined)) throw new Error("模型窗口与安全余量必须同时冻结。 ");
  if (input.modelContextWindowTokens !== undefined && (!Number.isInteger(input.modelContextWindowTokens) || input.modelContextWindowTokens < 1024 || typeof input.safetyMarginRatio !== "number" || input.safetyMarginRatio < 0 || input.safetyMarginRatio >= 1)) throw new Error("冻结的模型窗口或安全余量无效。 ");
  return { schema_version: 1, taskId: input.taskId, documentId: input.documentId, projectId: input.projectId, title: input.title, prompt: input.prompt, baseURL: input.baseURL, model: input.model, ...(input.providerProfileId ? { providerProfileId: input.providerProfileId } : {}), ...(input.protocol ? { protocol: input.protocol } : {}), ...(input.modelContextWindowTokens === undefined ? {} : { modelContextWindowTokens: input.modelContextWindowTokens, safetyMarginRatio: input.safetyMarginRatio! }), maxTokens, outputMode, ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {}) };
}

function modelRoleFromMetadata(metadata: Record<string, unknown> | undefined): ModelRole | null {
  const role = metadata?.modelRole;
  return role === "writer" || role === "reader" || role === "reviewer" || role === "editor" || role === "fact_extractor" ? role : null;
}

async function readInput(tasks: TaskRunner, objects: ObjectStore, taskId: string): Promise<StoredLocalCreationInput> {
  const hash = await tasks.getInputObjectHash(taskId);
  if (!hash) throw new Error("本地创作任务缺少输入对象。");
  const parsed: unknown = JSON.parse(decoder.decode(await objects.read(hash)));
  if (!isStoredInput(parsed)) throw new Error("本地创作任务输入无效。");
  return parsed;
}

function isStoredInput(value: unknown): value is StoredLocalCreationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema_version === 1
    && ["taskId", "documentId", "projectId", "title", "prompt", "baseURL", "model"].every((key) => typeof record[key] === "string" && (record[key] as string).trim())
    && (record.providerProfileId === undefined || (typeof record.providerProfileId === "string" && record.providerProfileId.trim().length > 0))
    && (record.protocol === undefined || record.protocol === "chat_completions" || record.protocol === "responses" || record.protocol === "ollama_native")
    && ((record.modelContextWindowTokens === undefined && record.safetyMarginRatio === undefined) || (Number.isInteger(record.modelContextWindowTokens) && Number(record.modelContextWindowTokens) >= 1024 && typeof record.safetyMarginRatio === "number" && Number(record.safetyMarginRatio) >= 0 && Number(record.safetyMarginRatio) < 1))
    && Number.isInteger(record.maxTokens) && Number(record.maxTokens) >= 256 && Number(record.maxTokens) <= 16_384
    && (record.outputMode === "creative_text" || record.outputMode === "structured_json")
    && (record.metadata === undefined || !!recordValue(record.metadata));
}

/** 所有生产角色最终经此处调用模型；在任务入队前统一关闭超窗路径。 */
function assertPromptFitsModelWindow(input: Pick<StoredLocalCreationInput, "prompt" | "maxTokens" | "outputMode" | "modelContextWindowTokens" | "safetyMarginRatio">, prompt: string): void {
  if (input.modelContextWindowTokens === undefined || input.safetyMarginRatio === undefined) return;
  const usableContext = Math.floor(input.modelContextWindowTokens * (1 - input.safetyMarginRatio));
  const inputTokens = estimatePromptTokens(prompt) + messageEnvelopeTokens(input.outputMode);
  if (inputTokens + input.maxTokens > usableContext) throw new Error(`完整模型请求超出有效上下文窗口：输入约 ${inputTokens} + 输出 ${input.maxTokens} > 可用 ${usableContext}。`);
}

function estimatePromptTokens(text: string): number {
  let latinRun = 0;
  let total = 0;
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) latinRun += 1;
    else { total += 1; latinRun = 0; }
  }
  return Math.max(1, total + Math.ceil(latinRun / 4));
}

function messageEnvelopeTokens(outputMode: LocalCreationOutputMode): number {
  // Local/Ollama/OpenAI-compatible/Routed caller 都发送 system + user message；结构化模式还带 JSON 约束。
  return outputMode === "structured_json" ? 192 : 160;
}

function record(value: unknown): Record<string, unknown> | null {
  return recordValue(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeTaskError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 500);
}

function completedText(completion: { text: string; finishReason: string }): string {
  if (completion.finishReason !== "stop") throw new Error(`本地模型输出被截断或异常结束（finish_reason=${completion.finishReason || "unknown"}），草稿未提交。`);
  const text = completion.text.trim();
  if (!text) throw new Error("本地模型返回空正文，草稿未提交。");
  return text;
}

/**
 * 保留原始冻结任务输入，再附加失败输出及机器可读诊断。该 Prompt 只在进程内发送给
 * 已选本机模型，绝不写入命令、审计或普通草稿 payload。
 */
function structuredRepairPrompt(originalPrompt: string, invalidOutput: string, diagnostic: string, metadata?: Record<string, unknown>): string {
  const editorRepairContract = metadata?.kind === "chapter_editor_patch"
    ? [
      "<AINOVR_EDITOR_REPAIR_CONTRACT>",
      "这是定向 Editor 补丁任务。replacements 必须恰好包含一个对象，且只能包含 issueId 和 replacement。",
      "issueId 必须保留原任务指定的问题 ID；replacement 必须是非空字符串，只替换原任务已定位的引文区间，禁止输出空字符串、空数组或整章改写。",
      "</AINOVR_EDITOR_REPAIR_CONTRACT>",
    ]
    : [];
  return [
    originalPrompt,
    "<AINOVR_STRUCTURED_OUTPUT_REPAIR>",
    "上一次结构化输出未通过本地严格校验。请保留原任务的所有固定 ID、枚举和引用约束，只输出一个修复后的 JSON 对象。",
    "严格遵循原任务 JSON 契约的必填字段、类型与基数；不得通过删除必填字段、将必填字符串置空或将必填数组改为空来逃避校验。字段或数组是否允许为空只能由原任务契约决定。",
    ...editorRepairContract,
    `校验错误：${diagnostic}`,
    "上一次输出：",
    invalidOutput,
    "</AINOVR_STRUCTURED_OUTPUT_REPAIR>",
  ].join("\n");
}
