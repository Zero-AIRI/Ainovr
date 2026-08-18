import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { ReferenceImportService } from "@/application/reference-import-service";
import type { TaskRecord, TaskRunner } from "@/application/task-runner";
import type { ObjectStore } from "@/persistence/object-store";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;

interface FileImportInput {
  schemaVersion: 1;
  taskId: string;
  referenceWorkId: string;
  sourceEditionId: string;
  title: string;
  sourcePath: string;
}

export interface ReferenceFileImportService {
  start(input: Omit<FileImportInput, "schemaVersion"> & { command: Omit<CommandEnvelope, "tool" | "args"> }): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}

/**
 * 受确认约束的单文件导入。唯一允许的外部路径只会在 TaskRunner 已获批准后读取，
 * 且必须是常规 UTF-8 `.txt` 文件；读取内容随后交给已有 ReferenceImportService，
 * 不会提供任意目录浏览、写入或原文件修改能力。
 */
export function createReferenceFileImportService(input: {
  commands: CommandService;
  tasks: TaskRunner;
  objects: ObjectStore;
  references: ReferenceImportService;
  hostId: string;
  now?: () => number;
}): ReferenceFileImportService {
  const now = input.now ?? Date.now;
  return {
    async start({ command, taskId, referenceWorkId, sourceEditionId, title, sourcePath }) {
      assertStartInput({ taskId, referenceWorkId, sourceEditionId, title, sourcePath });
      const payload: FileImportInput = { schemaVersion: 1, taskId, referenceWorkId, sourceEditionId, title, sourcePath };
      const object = await input.objects.put({ content: encoder.encode(JSON.stringify(payload)), mediaType: "application/vnd.ainovr.reference-file-import-input+json" });
      return input.commands.execute({
        ...command,
        tool: "start_reference_file_import",
        args: { taskId, resourceKey: `reference_file_import:${referenceWorkId}:${sourceEditionId}`, input: object },
      });
    },

    async run(taskId) {
      const claim = await input.tasks.claim(taskId, input.hostId);
      if (!claim.claimed) return input.tasks.get(taskId);
      let leaseLost = false;
      const heartbeat = setInterval(() => void input.tasks.heartbeat(taskId, input.hostId).catch(() => { leaseLost = true; }), 20_000);
      try {
        const file = await readInput(input.tasks, input.objects, taskId);
        await input.tasks.checkpoint(taskId, input.hostId, { schema_version: 1, stage: "validating_reference_file", sourceEditionId: file.sourceEditionId }, null);
        const text = await readValidatedTextFile(file.sourcePath);
        if (leaseLost) throw new Error("参考文件导入任务已失去 lease，原文不会提交。 ");
        const result = await input.references.importText({
          command: { schemaVersion: 1, commandId: `commit:reference-file-import:${taskId}`, idempotencyKey: `commit:reference-file-import:${taskId}`, correlationId: `task:${taskId}`, actor: { kind: "internal_agent", id: input.hostId }, createdAt: now() },
          referenceWorkId: file.referenceWorkId,
          sourceEditionId: file.sourceEditionId,
          title: file.title,
          text,
          task: { taskId, hostId: input.hostId },
        });
        if (result.kind !== "ok") throw new Error(`参考文件导入提交失败：${result.kind}`);
        return input.tasks.get(taskId);
      } catch (cause) {
        const task = await input.tasks.get(taskId);
        if (task?.status === "cancel_requested") await input.tasks.cancel(taskId, input.hostId).catch(() => undefined);
        else await input.tasks.fail(taskId, input.hostId, { code: "reference_file_import_failed", message: safeError(cause), retryable: false }).catch(() => undefined);
        throw cause;
      } finally {
        clearInterval(heartbeat);
      }
    },

    getTask(taskId) { return input.tasks.get(taskId); },
  };
}

function assertStartInput(input: Omit<FileImportInput, "schemaVersion">): void {
  for (const [label, value] of Object.entries(input)) if (label !== "sourcePath" && label !== "schemaVersion" && (typeof value !== "string" || !value.trim())) throw new Error(`${label} 必须是非空字符串。 `);
  if (!path.isAbsolute(input.sourcePath)) throw new Error("sourcePath must be an absolute path.");
  if (path.extname(input.sourcePath).toLowerCase() !== ".txt") throw new Error("sourcePath must point to a .txt file.");
}

async function readInput(tasks: TaskRunner, objects: ObjectStore, taskId: string): Promise<FileImportInput> {
  const hash = await tasks.getInputObjectHash(taskId);
  if (!hash) throw new Error("参考文件导入任务缺少输入对象。 ");
  let value: unknown;
  try { value = JSON.parse(decoder.decode(await objects.read(hash))); } catch { throw new Error("参考文件导入任务输入无效。 "); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("参考文件导入任务输入无效。 ");
  const record = value as Record<string, unknown>;
  const fields = ["taskId", "referenceWorkId", "sourceEditionId", "title", "sourcePath"] as const;
  if (record.schemaVersion !== 1 || fields.some((key) => typeof record[key] !== "string" || !(record[key] as string).trim())) throw new Error("参考文件导入任务输入无效。 ");
  const parsed = { schemaVersion: 1 as const, taskId: record.taskId as string, referenceWorkId: record.referenceWorkId as string, sourceEditionId: record.sourceEditionId as string, title: record.title as string, sourcePath: record.sourcePath as string };
  assertStartInput(parsed);
  return parsed;
}

async function readValidatedTextFile(sourcePath: string): Promise<string> {
  const info = await lstat(sourcePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error("参考导入目标必须是存在的常规文件。 ");
  if (info.size < 1 || info.size > MAX_SOURCE_BYTES) throw new Error("参考文件大小必须介于 1 字节和 100 MiB 之间。 ");
  const content = await readFile(sourcePath);
  const after = await lstat(sourcePath).catch(() => null);
  if (!after?.isFile() || after.isSymbolicLink() || content.byteLength !== info.size || after.size !== info.size) throw new Error("参考文件在读取期间发生变化或已不再是常规文件。 ");
  try { return decoder.decode(content); } catch { throw new Error("参考文件必须是有效的 UTF-8 文本。 "); }
}

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 500);
}
