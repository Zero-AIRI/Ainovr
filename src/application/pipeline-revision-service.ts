import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { CommandService } from "@/application/command-service";
import type { SqlDriver } from "@/persistence/sql-driver";

export interface PipelineStep { id: string; tool: string; enabled: boolean; config?: Record<string, unknown>; }
export interface PipelineRevision { pipelineId: string; name: string; status: string; revision: number; steps: PipelineStep[]; }

const FORBIDDEN_TOOLS = new Set(["apply_batch", "sql_query", "sql_execute", "sql_transaction", "read_data_file", "write_data_file"]);
const EXECUTABLE_CONFIGS: Readonly<Record<string, { required: readonly string[]; optional: readonly string[] }>> = {
  start_local_fact_extraction_batch: { required: ["analysisProjectId"], optional: ["maxTokens"] },
  start_chapter_writer_v1: { required: ["projectId", "chapterId", "manifestId", "documentId", "title"], optional: ["maxTokens"] },
  start_chapter_reader: { required: ["projectId", "chapterId", "manifestId", "documentId", "reportId", "title"], optional: ["maxTokens"] },
  start_chapter_reviewer: { required: ["projectId", "chapterId", "draftDocumentId", "reviewId", "readerManifestIds", "readerFeedbackDocumentIds", "title"], optional: ["maxTokens"] },
  start_chapter_editor: { required: ["projectId", "chapterId", "title", "targetDocumentId", "sourceDraftDocumentId", "reviewId", "selectedIssueIds", "rationale"], optional: ["maxTokens"] },
};
const LARGE_CONTENT_FIELD = /(?:^|[_-])(?:prompt|raw[_-]?output|original[_-]?text|excerpt|content|text)(?:$|[_-])/i;
/** A revision is declarative but must still name a real, reviewed domain operation. */
export const PIPELINE_DOMAIN_TOOLS = new Set([
  "import_reference_text", "create_analysis_corpus", "commit_structural_reading_map", "commit_analysis_facts", "commit_thread_graph", "commit_analysis_brief", "approve_analysis_brief", "commit_research_conclusions", "commit_independent_falsification", "commit_research_dossier", "commit_mechanism_candidate", "review_mechanism_asset", "commit_project_planning_document", "start_local_fact_extraction", "start_local_fact_extraction_batch", "start_local_creation", "start_chapter_writer_v1", "start_chapter_reader", "start_chapter_reviewer", "start_chapter_editor", "commit_local_creation_draft", "commit_chapter_production",
]);

export interface PipelineRevisionService {
  save(input: { command: Omit<CommandEnvelope, "tool" | "args">; pipelineId: string; name: string; steps: PipelineStep[]; status?: string; expectedRevision?: number | null }): Promise<CommandResult>;
  list(): Promise<PipelineRevision[]>;
}

export function createPipelineRevisionService(options: { driver: SqlDriver; commands: CommandService }): PipelineRevisionService {
  return {
    async save(input) {
      validate(input.pipelineId, input.name, input.steps);
      return options.commands.execute({ ...input.command, tool: "commit_pipeline_revision", args: {
        pipelineId: input.pipelineId, name: input.name, status: input.status ?? "draft", steps: input.steps, expectedRevision: input.expectedRevision ?? null,
      } });
    },
    async list() {
      const rows = await options.driver.query<{ pipeline_id: string; name: string; status: string; current_revision: number; payload_json: string }>({
        sql: "SELECT pipeline_id, name, status, current_revision, (SELECT payload_json FROM pipeline_revisions r WHERE r.pipeline_id = p.pipeline_id AND r.revision = p.current_revision) AS payload_json FROM pipelines p ORDER BY p.name, p.pipeline_id",
        params: [],
      });
      return rows.map((row) => {
        const payload = JSON.parse(row.payload_json) as { steps?: PipelineStep[] };
        return { pipelineId: row.pipeline_id, name: row.name, status: row.status, revision: row.current_revision, steps: payload.steps ?? [] };
      });
    },
  };
}

function validate(pipelineId: string, name: string, steps: PipelineStep[]): void {
  if (!pipelineId.trim() || !name.trim() || !Array.isArray(steps) || steps.length === 0 || steps.length > 32) throw new Error("PipelineRevision 的 ID、名称和步骤非法。 ");
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step || !step.id.trim() || !step.tool.trim() || ids.has(step.id) || FORBIDDEN_TOOLS.has(step.tool) || !PIPELINE_DOMAIN_TOOLS.has(step.tool)) throw new Error("PipelineRevision 包含非法、未登记或越权步骤。 ");
    assertNoSecret(step.config);
    assertSafeConfig(step.tool, step.config);
    ids.add(step.id);
  }
}

function assertNoSecret(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(assertNoSecret); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:api[_-]?key|secret|password|token)$/i.test(key)) throw new Error("PipelineRevision config 不得包含 Secret。 ");
    assertNoSecret(nested);
  }
}

/** PipelineRevision 存在 SQLite；任何完整 Prompt、原文或模型原始输出必须留在 ObjectStore。 */
function assertSafeConfig(tool: string, value: unknown): void {
  if (value === undefined) {
    const schema = EXECUTABLE_CONFIGS[tool];
    if (schema?.required.length) throw new Error("Pipeline 可执行步骤配置缺少必填字段。 ");
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pipeline 步骤配置必须是对象。 ");
  const config = value as Record<string, unknown>;
  if (containsLargeContentField(config)) throw new Error("Pipeline 步骤配置不得包含 Prompt、原文或模型原始输出。 ");
  const schema = EXECUTABLE_CONFIGS[tool];
  if (!schema) return;
  const allowed = new Set([...schema.required, ...schema.optional]);
  if (Object.keys(config).some((key) => !allowed.has(key)) || schema.required.some((key) => !(key in config))) throw new Error("Pipeline 可执行步骤配置包含未允许字段或缺少必填字段。 ");
}

function containsLargeContentField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsLargeContentField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => LARGE_CONTENT_FIELD.test(key) || containsLargeContentField(nested));
}
