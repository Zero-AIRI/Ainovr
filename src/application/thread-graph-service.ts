import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import { parseThreadLinkingOutput } from "@/lib/analysis/evidence-validation";
import type { AnalysisThread } from "@/lib/analysis/types";
import type { ObjectStore } from "@/persistence/object-store";
import type { SqlDriver } from "@/persistence/sql-driver";

const encoder = new TextEncoder();

export interface ThreadGraphService {
  submit(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }): Promise<CommandResult>;
  getThreads(analysisProjectId: string): Promise<AnalysisThread[]>;
}

export interface CreateThreadGraphServiceOptions {
  driver: SqlDriver;
  commands: CommandService;
  objects: ObjectStore;
  now?: () => number;
}

/**
 * 跨单元 ThreadGraph 只接收 FactLedger 已支持的证据 span；它不传递模型会话，
 * 因此可把同一事件/物件在线性文本中的多个 episode 合成为一个可回溯线程。
 */
export function createThreadGraphService(options: CreateThreadGraphServiceOptions): ThreadGraphService {
  return {
    async submit(input) {
      if (!input.analysisProjectId.trim() || !input.rawOutput.trim()) throw new Error("analysisProjectId 与 rawOutput 必须是非空字符串。 ");
      const allowedSpanIds = await readFactEvidenceSpanIds(options.driver, input.analysisProjectId);
      const parsed = parseThreadLinkingOutput(input.rawOutput, allowedSpanIds);
      const rawOutput = await options.objects.put({ content: encoder.encode(input.rawOutput), mediaType: "application/json; charset=utf-8" });
      return options.commands.execute({
        ...input.command,
        tool: "commit_thread_graph",
        args: {
          analysisProjectId: input.analysisProjectId,
          rawOutput,
          threads: parsed.threads.map(toCommandThread),
        },
      });
    },

    async getThreads(analysisProjectId) {
      const rows = await options.driver.query<{ payload_json: string }>({
        sql: "SELECT payload_json FROM analysis_items WHERE analysis_project_id = ? ORDER BY created_at ASC, analysis_item_id ASC",
        params: [analysisProjectId],
      });
      const storedThreads = rows.flatMap((row) => readStoredThread(row.payload_json));
      if (storedThreads.length === 0) return [];
      const allowed = collectThreadEvidenceSpanIds(storedThreads);
      return parseThreadLinkingOutput(JSON.stringify({ threads: storedThreads }), allowed).threads;
    },
  };
}

async function readFactEvidenceSpanIds(driver: SqlDriver, analysisProjectId: string): Promise<string[]> {
  const rows = await driver.query<{ span_id: string; payload_json: string }>({
    sql: `SELECT evidence.span_id, item.payload_json
          FROM evidence_instances evidence
          INNER JOIN analysis_items item ON item.analysis_item_id = evidence.analysis_item_id
          WHERE item.analysis_project_id = ?`,
    params: [analysisProjectId],
  });
  const allowed = new Set<string>();
  for (const row of rows) {
    const payload = parseRecord(row.payload_json);
    if (payload.kind === "fact_ledger_entry" || (payload.kind === undefined && "fact" in payload)) allowed.add(row.span_id);
  }
  return [...allowed];
}

function readStoredThread(value: string): Record<string, unknown>[] {
  const payload = parseRecord(value);
  if (payload.kind !== "thread_graph_thread") return [];
  const thread = payload.thread;
  return thread && typeof thread === "object" && !Array.isArray(thread) ? [thread as Record<string, unknown>] : [];
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AnalysisItem payload 损坏。 ");
  return parsed as Record<string, unknown>;
}

/** 让 Command 载荷保持严格 JSON 的必填 null 字段，同时不保留模型原始文本。 */
export function toCommandThread(thread: AnalysisThread): Record<string, unknown> {
  return {
    id: thread.id,
    kind: thread.kind === "other" ? thread.rawLabel ?? "other" : thread.kind,
    title: thread.title,
    episodes: thread.episodes.map((episode) => ({
      id: episode.id,
      role: episode.role === "other" ? episode.rawLabel ?? "other" : episode.role,
      rawLabel: episode.rawLabel ?? null,
      summary: episode.summary,
      evidenceSpanIds: episode.evidenceSpanIds,
      ordinal: episode.ordinal,
    })),
    epistemicStatus: thread.epistemicStatus,
    lifecycle: thread.lifecycle,
  };
}

/** Command planner 的防御校验；服务层会另外以 FactLedger 证据集合执行严格校验。 */
export function parsePlannedThreads(value: unknown): AnalysisThread[] | null {
  if (!Array.isArray(value)) return null;
  const evidenceSpanIds = collectThreadEvidenceSpanIds(value);
  try {
    return parseThreadLinkingOutput(JSON.stringify({ threads: value }), evidenceSpanIds).threads;
  } catch {
    return null;
  }
}

function collectThreadEvidenceSpanIds(threads: readonly unknown[]): string[] {
  const result: string[] = [];
  for (const thread of threads) {
    if (!thread || typeof thread !== "object" || Array.isArray(thread)) continue;
    const episodes = (thread as Record<string, unknown>).episodes;
    if (!Array.isArray(episodes)) continue;
    for (const episode of episodes) {
      if (!episode || typeof episode !== "object" || Array.isArray(episode)) continue;
      const evidenceSpanIds = (episode as Record<string, unknown>).evidenceSpanIds;
      if (!Array.isArray(evidenceSpanIds)) continue;
      for (const spanId of evidenceSpanIds) if (typeof spanId === "string") result.push(spanId);
    }
  }
  return result;
}
