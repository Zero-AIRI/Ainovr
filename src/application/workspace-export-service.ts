import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { TaskRecord, TaskRunner } from "@/application/task-runner";
import type { WorkspaceQueryService } from "@/application/workspace-application-service";
import type { ObjectStore } from "@/persistence/object-store";
import type { NodeWorkspaceExportRepository, WorkspaceExportView } from "@/persistence/node-workspace-export";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type ExportInput =
  | { schemaVersion: 1; kind: "project"; exportId: string; projectId: string }
  | { schemaVersion: 1; kind: "analysis"; exportId: string; referenceWorkId: string };

export interface WorkspaceExportService {
  startProjectExport(input: { command: Omit<CommandEnvelope, "tool" | "args">; taskId: string; projectId: string; exportId: string }): Promise<CommandResult>;
  startAnalysisExport(input: { command: Omit<CommandEnvelope, "tool" | "args">; taskId: string; referenceWorkId: string; exportId: string }): Promise<CommandResult>;
  run(taskId: string): Promise<TaskRecord | null>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}

/**
 * 项目/分析导出是领域任务而非通用文件工具：输入只有资源 ID 与导出 ID，
 * 数据只从 QueryService 的安全投影取得。分析包从不包含 SourceEdition 原文。
 */
export function createWorkspaceExportService(input: {
  commands: CommandService;
  queries: WorkspaceQueryService;
  tasks: TaskRunner;
  objects: ObjectStore;
  repository: NodeWorkspaceExportRepository;
  hostId: string;
  now?: () => number;
}): WorkspaceExportService {
  const now = input.now ?? Date.now;

  async function start(taskId: string, exportInput: ExportInput, command: Omit<CommandEnvelope, "tool" | "args">): Promise<CommandResult> {
    assertNonEmpty(taskId, "taskId");
    const object = await input.objects.put({ content: encoder.encode(JSON.stringify(exportInput)), mediaType: "application/vnd.ainovr.workspace-export-input+json" });
    return input.commands.execute({
      ...command,
      tool: "start_workspace_export",
      args: {
        taskId,
        resourceKey: exportInput.kind === "project"
          ? `project_export:${exportInput.projectId}:${exportInput.exportId}`
          : `analysis_export:${exportInput.referenceWorkId}:${exportInput.exportId}`,
        input: object,
      },
    });
  }

  return {
    startProjectExport({ command, taskId, projectId, exportId }) {
      assertNonEmpty(projectId, "projectId");
      assertNonEmpty(exportId, "exportId");
      return start(taskId, { schemaVersion: 1, kind: "project", projectId, exportId }, command);
    },

    startAnalysisExport({ command, taskId, referenceWorkId, exportId }) {
      assertNonEmpty(referenceWorkId, "referenceWorkId");
      assertNonEmpty(exportId, "exportId");
      return start(taskId, { schemaVersion: 1, kind: "analysis", referenceWorkId, exportId }, command);
    },

    async run(taskId) {
      const claimed = await input.tasks.claim(taskId, input.hostId);
      if (!claimed.claimed) return input.tasks.get(taskId);
      let leaseLost = false;
      const heartbeat = setInterval(() => {
        void input.tasks.heartbeat(taskId, input.hostId).catch(() => { leaseLost = true; });
      }, 20_000);
      try {
        const exportInput = await readInput(input.tasks, input.objects, taskId);
        await input.tasks.checkpoint(taskId, input.hostId, { schema_version: 1, stage: "assembling_export", kind: exportInput.kind, exportId: exportInput.exportId }, null);
        const output = await exportBundle(input.queries, input.repository, exportInput);
        if (leaseLost) throw new Error("工作区导出任务已失去 lease，结果不会提交。 ");
        const resultObject = await input.objects.put({ content: encoder.encode(JSON.stringify(toResult(output))), mediaType: "application/vnd.ainovr.workspace-export-result+json" });
        const committed = await input.commands.execute({
          schemaVersion: 1,
          commandId: `complete:workspace-export:${taskId}`,
          idempotencyKey: `complete:workspace-export:${taskId}`,
          correlationId: `task:${taskId}`,
          actor: { kind: "internal_agent", id: input.hostId },
          tool: "complete_workspace_export",
          args: { taskId, hostId: input.hostId, output: resultObject },
          createdAt: now(),
        });
        if (committed.kind !== "ok") throw new Error(`工作区导出结果提交失败：${committed.kind}`);
        return input.tasks.get(taskId);
      } catch (cause) {
        const task = await input.tasks.get(taskId);
        if (task?.status === "cancel_requested") await input.tasks.cancel(taskId, input.hostId).catch(() => undefined);
        else await input.tasks.fail(taskId, input.hostId, { code: "workspace_export_failed", message: safeError(cause), retryable: false }).catch(() => undefined);
        throw cause;
      } finally {
        clearInterval(heartbeat);
      }
    },

    getTask(taskId) {
      return input.tasks.get(taskId);
    },
  };
}

async function exportBundle(queries: WorkspaceQueryService, repository: NodeWorkspaceExportRepository, input: ExportInput): Promise<WorkspaceExportView> {
  if (input.kind === "project") {
    const project = await queries.getNovelProject(input.projectId);
    if (!project) throw new Error("要导出的原创项目不存在。 ");
    const documents = await queries.listProjectDocuments(input.projectId);
    const contents = await Promise.all(documents.map(async (document) => {
      const content = await queries.getProjectDocument({ projectId: input.projectId, documentId: document.documentId });
      if (!content) throw new Error("项目文档在导出期间不可读取。 ");
      return content;
    }));
    return repository.write({
      kind: "project",
      exportId: input.exportId,
      bundle: { schemaVersion: 1, project, documents: contents },
    });
  }

  const workbench = await queries.getReferenceWorkbench(input.referenceWorkId);
  if (!workbench) throw new Error("要导出的参考分析不存在。 ");
  return repository.write({
    kind: "analysis",
    exportId: input.exportId,
    // workbench 只含 SourceSpan hash/位置、证据与 Coverage，绝不含 SourceEdition 原文。
    bundle: { schemaVersion: 1, referenceWorkbench: workbench },
  });
}

async function readInput(tasks: TaskRunner, objects: ObjectStore, taskId: string): Promise<ExportInput> {
  const hash = await tasks.getInputObjectHash(taskId);
  if (!hash) throw new Error("工作区导出任务缺少输入对象。 ");
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(await objects.read(hash)));
  } catch {
    throw new Error("工作区导出任务输入无效。 ");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作区导出任务输入无效。 ");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.exportId !== "string" || !record.exportId.trim()) throw new Error("工作区导出任务输入无效。 ");
  if (record.kind === "project" && typeof record.projectId === "string" && record.projectId.trim()) return { schemaVersion: 1, kind: "project", exportId: record.exportId, projectId: record.projectId };
  if (record.kind === "analysis" && typeof record.referenceWorkId === "string" && record.referenceWorkId.trim()) return { schemaVersion: 1, kind: "analysis", exportId: record.exportId, referenceWorkId: record.referenceWorkId };
  throw new Error("工作区导出任务输入无效。 ");
}

function toResult(output: WorkspaceExportView): Record<string, unknown> {
  return { schemaVersion: 1, kind: "workspace_export_result", exportId: output.exportId, exportKind: output.kind, byteLength: output.byteLength };
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。 `);
}

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 500);
}
