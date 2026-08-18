import type { CommandEnvelope } from "@/application/command-types";
import type { AnalysisCorpusService } from "@/application/analysis-corpus-service";
import type { AnalysisFactService } from "@/application/analysis-fact-service";
import type { StructuralReadingMapService } from "@/application/structural-reading-map-service";
import type { LocalFactExtractionService } from "@/application/local-fact-extraction-service";
import type { LocalFactExtractionBatchService } from "@/application/local-fact-extraction-batch-service";
import type { ThreadGraphService } from "@/application/thread-graph-service";
import type { AnalysisBriefService } from "@/application/analysis-brief-service";
import type { ResearchConclusionService } from "@/application/research-conclusion-service";
import type { IndependentFalsificationService } from "@/application/independent-falsification-service";
import type { ResearchDossierService } from "@/application/research-dossier-service";
import type { EvidenceWorkbenchService } from "@/application/evidence-workbench-service";
import type { MechanismAssetService } from "@/application/mechanism-asset-service";
import type { StoryPlanningService } from "@/application/story-planning-service";
import type { CreativeRecipeService } from "@/application/creative-recipe-service";
import type { ChapterContextManifestService } from "@/application/chapter-context-manifest-service";
import type { ChapterReaderManifestService } from "@/application/chapter-reader-manifest-service";
import type { ChapterReviewService } from "@/application/chapter-review-service";
import type { ChapterEditorService } from "@/application/chapter-editor-service";
import type { ChapterEditorTaskService } from "@/application/chapter-editor-task-service";
import type { ChapterReaderService } from "@/application/chapter-reader-service";
import type { ChapterReviewerService } from "@/application/chapter-reviewer-service";
import type { ChapterProductionCommitService, CanonPatch, CharacterKnowledgePatch, ReaderPromisePatch } from "@/application/chapter-production-commit-service";
import type { ChapterWriterService } from "@/application/chapter-writer-service";
import type { LocalCreationService } from "@/application/local-creation-service";
import type { ReferenceImportService } from "@/application/reference-import-service";
import type { ReferenceFileImportService } from "@/application/reference-file-import-service";
import type { TaskRunner } from "@/application/task-runner";
import type { WorkspaceApplicationService } from "@/application/workspace-application-service";
import type { WorkspaceMaintenanceService } from "@/application/workspace-maintenance-service";
import type { WorkspaceExportService } from "@/application/workspace-export-service";
import type { PipelineRevisionService } from "@/application/pipeline-revision-service";

export interface ApplicationMcpJsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

const STRING = { type: "string", minLength: 1 };
const TOOLS: ToolDefinition[] = [
  { name: "get_workspace_status", description: "读取 SQLite 工作区 revision、change sequence 和项目数。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "get_capabilities", description: "读取当前 stdio 控制面的能力声明。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "list_changes", description: "按 SQLite change sequence 增量读取领域变更。", inputSchema: { type: "object", properties: { after: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["after"], additionalProperties: false } },
  { name: "list_actionable_tasks", description: "读取可取消、可重试或等待确认的任务投影。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  {
    name: "create_novel_project",
    description: "通过 CommandService 创建原创项目；相同重试必须复用 idempotencyKey。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, title: STRING, status: STRING, payload: { type: "object" } },
      required: ["commandId", "idempotencyKey", "correlationId", "projectId", "title", "status", "payload"],
      additionalProperties: false,
    },
  },
  { name: "get_novel_project", description: "通过 QueryService 读取原创项目当前 revision。", inputSchema: { type: "object", properties: { projectId: STRING }, required: ["projectId"], additionalProperties: false } },
  { name: "list_novel_projects", description: "通过 QueryService 列出原创项目当前 revision。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "get_project_workbench", description: "读取原创项目的短 Canon、ReaderPromise、章节版本与当前生产游标；不返回参考侧资料、对象路径或完整正文。", inputSchema: { type: "object", properties: { projectId: STRING }, required: ["projectId"], additionalProperties: false } },
  { name: "list_project_documents", description: "列出项目当前文档索引；正文继续保留在 ObjectStore。", inputSchema: { type: "object", properties: { projectId: STRING }, required: ["projectId"], additionalProperties: false } },
  { name: "get_document", description: "读取指定项目文档的当前 revision；不接受对象路径或任意文件路径。", inputSchema: { type: "object", properties: { projectId: STRING, documentId: STRING }, required: ["projectId", "documentId"], additionalProperties: false } },
  { name: "get_reference_workbench", description: "读取参考分析的证据索引和 Coverage 处置；不返回参考原文。", inputSchema: { type: "object", properties: { referenceWorkId: STRING }, required: ["referenceWorkId"], additionalProperties: false } },
  { name: "list_pending_mechanism_assets", description: "读取待人工采纳的机制候选短投影；不返回原文、SourceSpan 或模型原始输出。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "list_pending_planning_documents", description: "读取待人类审核的原创规划索引；不返回完整 Prompt。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "list_coverage_gaps", description: "读取全工作区未 complete 的 Coverage 处置和原因；不返回参考原文。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "list_provider_profiles", description: "读取非秘密 Provider 与角色路由；不返回 API Key。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "save_provider_profile", description: "版本化保存非秘密 Provider 与角色路由；不接受 API Key，更新必须携带 expectedRevision。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, providerProfileId: STRING, name: STRING, baseURL: STRING, defaultModel: STRING, routes: { type: "array", items: { type: "object", properties: { role: STRING, model: STRING }, required: ["role", "model"], additionalProperties: false } }, expectedRevision: { type: "integer", minimum: 1 } }, required: ["commandId", "idempotencyKey", "correlationId", "providerProfileId", "name", "baseURL", "defaultModel", "routes"], additionalProperties: false } },
  { name: "get_workspace_settings", description: "读取非秘密的 DataPolicy、上下文/输出预算和自动化模式。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "get_evidence_excerpt", description: "只按已登记 EvidenceInstance 读取有上限的原文摘录。", inputSchema: { type: "object", properties: { evidenceInstanceId: STRING }, required: ["evidenceInstanceId"], additionalProperties: false } },
  { name: "save_workspace_settings", description: "版本化保存非秘密 DataPolicy、上下文/输出预算和自动化模式；更新必须携带 expectedRevision。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, automationMode: { type: "string", enum: ["manual", "supervised", "autonomous"] }, contextWindowTokens: { type: "integer", minimum: 1024, maximum: 1000000 }, maxOutputTokens: { type: "integer", minimum: 256, maximum: 999999 }, safetyMarginRatio: { type: "number", minimum: 0, exclusiveMaximum: 1 }, cloudEscalation: { type: "string", enum: ["never", "complex_only", "always"] }, expectedRevision: { type: "integer", minimum: 1 } }, required: ["commandId", "idempotencyKey", "correlationId", "automationMode", "contextWindowTokens", "maxOutputTokens", "safetyMarginRatio", "cloudEscalation"], additionalProperties: false } },
];
const PIPELINE_TOOLS: ToolDefinition[] = [
  { name: "list_pipeline_revisions", description: "读取可编辑的领域 PipelineRevision 列表。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "save_pipeline_revision", description: "保存受领域工具白名单约束的线性 PipelineRevision。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, pipelineId: STRING, name: STRING, status: STRING, expectedRevision: { type: "integer", minimum: 1 }, steps: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: { id: STRING, tool: STRING, enabled: { type: "boolean" }, config: { type: "object" } }, required: ["id", "tool", "enabled"], additionalProperties: false } } }, required: ["commandId", "idempotencyKey", "correlationId", "pipelineId", "name", "steps"], additionalProperties: false } },
  { name: "start_pipeline_run", description: "冻结当前 PipelineRevision 并创建可审计的人工复核运行；仅具备显式宿主映射的步骤可启动，其余仍须由对应领域工具完成。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, runId: STRING, pipelineId: STRING, projectId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "runId", "pipelineId"], additionalProperties: false } },
  { name: "list_pipeline_runs", description: "读取最近受控 PipelineRun 与每一步的人类复核 checkpoint。", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, required: [], additionalProperties: false } },
  { name: "get_pipeline_run", description: "读取一个冻结 PipelineRun 及其节点复核状态。", inputSchema: { type: "object", properties: { runId: STRING }, required: ["runId"], additionalProperties: false } },
  { name: "complete_pipeline_run_step", description: "记录人类已通过对应领域工具完成并复核的冻结步骤；不执行任意 JSON 命令。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, runId: STRING, stepId: STRING, note: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["commandId", "idempotencyKey", "correlationId", "runId", "stepId", "note"], additionalProperties: false } },
  { name: "execute_pipeline_run_step", description: "仅执行冻结 PipelineRun 中具有显式强类型宿主映射的步骤；执行结果必须经人工复核，绝不将 Pipeline JSON 解释为任意命令。", inputSchema: { type: "object", properties: { runId: STRING, stepId: STRING }, required: ["runId", "stepId"], additionalProperties: false } },
];
const TASK_TOOLS: ToolDefinition[] = [
  { name: "get_task", description: "读取持久任务和 checkpoint。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
  { name: "wait_task", description: "最多等待 30 秒，返回任务最新状态。", inputSchema: { type: "object", properties: { taskId: STRING, timeoutMs: { type: "integer", minimum: 0, maximum: 30000 } }, required: ["taskId"], additionalProperties: false } },
  { name: "cancel_task", description: "请求取消正在运行的任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
  { name: "retry_task", description: "重新排队已失败或已取消的任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
];
const CONFIRMATION_TOOLS: ToolDefinition[] = [
  { name: "list_pending_confirmations", description: "读取待确认命令，不返回 Secret 或原始数据库。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "get_confirmation", description: "读取单个确认的安全摘要，不返回原命令参数。", inputSchema: { type: "object", properties: { confirmationId: STRING }, required: ["confirmationId"], additionalProperties: false } },
  { name: "approve_confirmation", description: "记录 human_via_agent 批准并重新校验后执行原命令。", inputSchema: { type: "object", properties: { confirmationId: STRING, reason: STRING }, required: ["confirmationId", "reason"], additionalProperties: false } },
  { name: "reject_confirmation", description: "记录 human_via_agent 拒绝；原命令不会执行。", inputSchema: { type: "object", properties: { confirmationId: STRING, reason: STRING }, required: ["confirmationId", "reason"], additionalProperties: false } },
];
const LOCAL_CREATION_TOOLS: ToolDefinition[] = [
  {
    name: "start_local_creation",
    description: "启动只使用本机回环 OpenAI 兼容模型的原创草稿任务。完整 prompt 仅存对象库；模型截断时草稿不会提交。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, documentId: STRING, projectId: STRING, title: STRING, prompt: STRING, baseURL: STRING, model: STRING, maxTokens: { type: "integer", minimum: 256, maximum: 16384 } },
      required: ["commandId", "idempotencyKey", "correlationId", "taskId", "documentId", "projectId", "title", "prompt"],
      additionalProperties: false,
    },
  },
  { name: "get_local_creation_draft", description: "读取由本地创作任务提交的具体草稿版本。", inputSchema: { type: "object", properties: { documentId: STRING }, required: ["documentId"], additionalProperties: false } },
  { name: "resume_local_creation", description: "由当前 MCP 宿主接管并继续已排队的本地创作任务。失败任务须先 retry_task。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
];
const WORKSPACE_MAINTENANCE_TOOLS: ToolDefinition[] = [
  {
    name: "create_workspace_backup",
    description: "通过持久 TaskRunner 创建 SQLite 在线备份与对象库副本；只写入当前工作区 data/backups，不读取 settings.json。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, backupId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "taskId", "backupId"], additionalProperties: false },
  },
  {
    name: "restore_workspace_backup",
    description: "请求将已验证备份恢复到当前工作区 data/restores 下的新空目录；需要持久 human_via_agent 确认，不接受路径参数。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, backupId: STRING, restoreId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "taskId", "backupId", "restoreId"], additionalProperties: false },
  },
  { name: "resume_workspace_maintenance", description: "由当前 MCP 宿主接管已排队的工作区备份或恢复任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
];
const WORKSPACE_EXPORT_TOOLS: ToolDefinition[] = [
  {
    name: "export_project",
    description: "将已登记原创项目导出到当前工作区 data/exports；通过 QueryService 读取，不接受路径，也会拒绝疑似 Secret。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, projectId: STRING, exportId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "taskId", "projectId", "exportId"], additionalProperties: false },
  },
  {
    name: "export_analysis",
    description: "导出参考分析的证据、位置和 Coverage 索引，不包含 SourceEdition 原文或 settings。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, referenceWorkId: STRING, exportId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "taskId", "referenceWorkId", "exportId"], additionalProperties: false },
  },
  { name: "resume_workspace_export", description: "由当前 MCP 宿主接管已排队的项目或分析导出任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
];
const REFERENCE_TOOLS: ToolDefinition[] = [
  { name: "list_reference_works", description: "列出已导入的参考作品及其 SourceEdition 安全元数据。", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "get_reference_work", description: "读取参考作品的对象 hash、token 估算和位置映射引用。", inputSchema: { type: "object", properties: { referenceWorkId: STRING }, required: ["referenceWorkId"], additionalProperties: false } },
  {
    name: "import_reference_text",
    description: "导入调用者明确提供的一份 UTF-8 参考文本；不接受任意路径，正文只进入对象库。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, referenceWorkId: STRING, sourceEditionId: STRING, title: STRING, text: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "referenceWorkId", "sourceEditionId", "title", "text"], additionalProperties: false },
  },
  {
    name: "request_reference_file_import",
    description: "请求导入一份外部绝对路径 UTF-8 .txt 文件；路径只在持久 human_via_agent 确认后由受控任务读取。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, referenceWorkId: STRING, sourceEditionId: STRING, title: STRING, sourcePath: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "taskId", "referenceWorkId", "sourceEditionId", "title", "sourcePath"], additionalProperties: false },
  },
  { name: "resume_reference_file_import", description: "由当前 MCP 宿主接管已批准的参考文件导入任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
  { name: "find_source_text", description: "仅在已登记 SourceEdition 内定位调用者提供的短文本锚点；只返回 UTF-8 字节区间，不回显原文或暴露对象路径。", inputSchema: { type: "object", properties: { sourceEditionId: STRING, query: { type: "string", minLength: 1, maxLength: 512 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["sourceEditionId", "query"], additionalProperties: false } },
  { name: "get_source_excerpt", description: "按规范化 UTF-8 半开字节区间读取参考原文摘录。", inputSchema: { type: "object", properties: { sourceEditionId: STRING, startByte: { type: "integer", minimum: 0 }, endByte: { type: "integer", minimum: 0 } }, required: ["sourceEditionId", "startByte", "endByte"], additionalProperties: false } },
];
const ANALYSIS_TOOLS: ToolDefinition[] = [
  {
    name: "update_analysis_segmentation",
    description: "依据模型上下文、输出及已渲染 Prompt 预算冻结 V2 AnalysisCorpus；不以固定字数切原文。",
    inputSchema: {
      type: "object",
      properties: {
        commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING, segmentationId: STRING, sourceEditionId: STRING,
        boundary: { type: "string", enum: ["complete", "volume", "fragment"] },
        byteRange: { type: "object", properties: { startByte: { type: "integer", minimum: 0 }, endByte: { type: "integer", minimum: 1 } }, required: ["startByte", "endByte"], additionalProperties: false },
        budget: { type: "object", properties: { contextWindowTokens: { type: "integer", minimum: 1 }, safetyMarginRatio: { type: "number", minimum: 0, exclusiveMaximum: 1 }, reservedOutputTokens: { type: "integer", minimum: 0 }, renderedSystemPromptTokens: { type: "integer", minimum: 0 }, renderedSchemaTokens: { type: "integer", minimum: 0 }, envelopeTokens: { type: "integer", minimum: 0 } }, required: ["contextWindowTokens", "safetyMarginRatio", "reservedOutputTokens", "renderedSystemPromptTokens", "renderedSchemaTokens", "envelopeTokens"], additionalProperties: false },
      },
      required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId", "segmentationId", "sourceEditionId", "boundary", "budget"],
      additionalProperties: false,
    },
  },
  { name: "get_analysis_overview", description: "读取 V2 AnalysisCorpus 的预算、计算单元和 SourceSpan 覆盖范围。", inputSchema: { type: "object", properties: { analysisProjectId: STRING }, required: ["analysisProjectId"], additionalProperties: false } },
  { name: "get_source_span", description: "读取可重新校验 exactTextHash 的单个证据 SourceSpan。", inputSchema: { type: "object", properties: { spanId: STRING }, required: ["spanId"], additionalProperties: false } },
];
const FACT_LEDGER_TOOLS: ToolDefinition[] = [
  {
    name: "submit_analysis_facts",
    description: "提交当前 AnalysisUnit 的严格 JSON FactLedger。原始模型输出只进入对象库；无效 spanId 会在任何领域写入前被拒绝。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING, analysisUnitId: STRING, rawOutput: STRING },
      required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId", "analysisUnitId", "rawOutput"],
      additionalProperties: false,
    },
  },
  { name: "get_fact_ledger", description: "读取计算单元的已校验证据事实和关联 SourceSpan ID，不返回模型原始输出。", inputSchema: { type: "object", properties: { analysisProjectId: STRING, analysisUnitId: STRING }, required: ["analysisProjectId", "analysisUnitId"], additionalProperties: false } },
];
const READING_MAP_TOOLS: ToolDefinition[] = [
  {
    name: "create_structural_reading_map",
    description: "从冻结 AnalysisCorpus 的单元/span 元数据创建结构化 ReadingMap；不读取或复制原文正文，不臆测角色与事件。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId"], additionalProperties: false },
  },
  { name: "get_structural_reading_map", description: "读取结构化 ReadingMap 的可验证范围、span 统计与显式弃权状态。", inputSchema: { type: "object", properties: { analysisProjectId: STRING }, required: ["analysisProjectId"], additionalProperties: false } },
];
const LOCAL_FACT_EXTRACTION_TOOLS: ToolDefinition[] = [
  {
    name: "start_local_fact_extraction",
    description: "为一个冻结 AnalysisUnit 启动本机回环模型的严格 FactLedger 提取任务；模型原始输出只进入对象库，最多自动修复一次。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, analysisProjectId: STRING, analysisUnitId: STRING, baseURL: STRING, model: STRING, maxTokens: { type: "integer", minimum: 256, maximum: 16384 } },
      required: ["commandId", "idempotencyKey", "correlationId", "taskId", "analysisProjectId", "analysisUnitId"],
      additionalProperties: false,
    },
  },
  { name: "resume_local_fact_extraction", description: "由当前 MCP 宿主接管并继续已排队的本地 FactExtractor 任务；失败任务须先 retry_task。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
  { name: "reconfigure_local_fact_extraction", description: "仅对失败或取消的 FactExtractor 任务重新选择已配置模型或输出预算；保留同一 taskId 与资源锁，并产生新审计命令。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, baseURL: STRING, model: STRING, maxTokens: { type: "integer", minimum: 256, maximum: 16384 } }, required: ["commandId", "idempotencyKey", "correlationId", "taskId"], additionalProperties: false } },
];
const LOCAL_FACT_EXTRACTION_BATCH_TOOLS: ToolDefinition[] = [
  {
    name: "start_local_fact_extraction_batch",
    description: "为一个冻结 AnalysisCorpus 启动可恢复的本机 FactLedger 批任务；每个单元独立校验，失败单元会保留 Coverage 处置。请保持 MCP companion 存活，或改用 CLI 宿主运行长任务。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, analysisProjectId: STRING, baseURL: STRING, model: STRING, maxTokens: { type: "integer", minimum: 256, maximum: 16384 } },
      required: ["commandId", "idempotencyKey", "correlationId", "taskId", "analysisProjectId"],
      additionalProperties: false,
    },
  },
  { name: "resume_local_fact_extraction_batch", description: "由保持存活的 MCP companion 接管已排队的本地事实批任务；失败或取消任务须先经 retry_task 进入队列。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
];
const THREAD_GRAPH_TOOLS: ToolDefinition[] = [
  {
    name: "submit_thread_graph",
    description: "提交严格 JSON 的跨单元 ThreadGraph；每个 episode 仅能使用 FactLedger 已验证的 SourceSpan 证据。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING, rawOutput: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId", "rawOutput"], additionalProperties: false },
  },
  { name: "get_thread_graph", description: "读取当前 AnalysisProject 的跨单元 ThreadGraph，不返回模型原始输出。", inputSchema: { type: "object", properties: { analysisProjectId: STRING }, required: ["analysisProjectId"], additionalProperties: false } },
];
const ANALYSIS_BRIEF_TOOLS: ToolDefinition[] = [
  {
    name: "submit_analysis_brief",
    description: "提交最多五项的严格 JSON AnalysisBrief；问题先进入待确认状态，尚不能启动解释型分析。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING, rawOutput: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId", "rawOutput"], additionalProperties: false },
  },
  { name: "get_analysis_brief", description: "读取研究问题及其 pending_review / approved 状态。", inputSchema: { type: "object", properties: { analysisProjectId: STRING }, required: ["analysisProjectId"], additionalProperties: false } },
  {
    name: "approve_analysis_brief",
    description: "在用户明确批准后，将 AnalysisBrief 转为可用于解释型分析的 approved 状态。",
    inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId"], additionalProperties: false },
  },
];
const RESEARCH_CONCLUSION_TOOLS: ToolDefinition[] = [
  { name: "submit_research_conclusions", description: "为已批准 ResearchQuestion 提交严格 JSON 结论；原始模型 JSON 只进入对象库。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING, researchQuestionId: STRING, rawOutput: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId", "researchQuestionId", "rawOutput"], additionalProperties: false } },
  { name: "get_research_conclusions", description: "读取指定 ResearchQuestion 的可回溯结论、观察、证据与生产用途。", inputSchema: { type: "object", properties: { analysisProjectId: STRING, researchQuestionId: STRING }, required: ["analysisProjectId", "researchQuestionId"], additionalProperties: false } },
];
const INDEPENDENT_FALSIFICATION_TOOLS: ToolDefinition[] = [
  { name: "get_falsification_work_item", description: "读取隔离反证任务：只包含待检验命题与合法 SourceSpan 检索范围。", inputSchema: { type: "object", properties: { analysisProjectId: STRING, conclusionId: STRING }, required: ["analysisProjectId", "conclusionId"], additionalProperties: false } },
  { name: "submit_independent_falsification", description: "提交独立反证结果；完整模型信封只进入对象库。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING, conclusionId: STRING, rawOutput: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId", "conclusionId", "rawOutput"], additionalProperties: false } },
  { name: "get_independent_falsification", description: "读取一个结论的独立反证状态与反例边界。", inputSchema: { type: "object", properties: { analysisProjectId: STRING, conclusionId: STRING }, required: ["analysisProjectId", "conclusionId"], additionalProperties: false } },
];
const RESEARCH_DOSSIER_TOOLS: ToolDefinition[] = [
  { name: "create_research_dossier", description: "在 FactLedger、ThreadGraph 与已批准 AnalysisBrief 均完成后，冻结不含参考原文的 ResearchDossier。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId"], additionalProperties: false } },
  { name: "get_research_dossier", description: "读取最新 ResearchDossier 的事实数、线程数和证据定位索引；不包含参考正文。", inputSchema: { type: "object", properties: { analysisProjectId: STRING }, required: ["analysisProjectId"], additionalProperties: false } },
];
const EVIDENCE_WORKBENCH_TOOLS: ToolDefinition[] = [
  { name: "get_analysis_evidence", description: "按研究问题、结论或 SourceSpan 读取可核验的证据定位索引；不返回参考原文。", inputSchema: { type: "object", properties: { analysisProjectId: STRING, researchQuestionId: STRING, conclusionId: STRING, spanId: STRING }, required: ["analysisProjectId"], additionalProperties: false } },
  { name: "list_analysis_coverage", description: "读取每个分析模块和计算单元的 Coverage 处置及遗漏原因。", inputSchema: { type: "object", properties: { analysisProjectId: STRING, module: STRING, analysisUnitId: STRING }, required: ["analysisProjectId"], additionalProperties: false } },
];
const MECHANISM_ASSET_TOOLS: ToolDefinition[] = [
  { name: "propose_mechanism_candidate", description: "从当前 AnalysisProject 已反证的结论编译机制候选；模型原始 JSON 与中性示范只进入对象库。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, analysisProjectId: STRING, rawOutput: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "analysisProjectId", "rawOutput"], additionalProperties: false } },
  { name: "list_mechanism_candidates", description: "读取机制候选及其分析侧质量状态，不读取原文对象。", inputSchema: { type: "object", properties: { analysisProjectId: STRING }, required: [], additionalProperties: false } },
  { name: "get_mechanism_asset", description: "读取单张机制卡、revision 和人工采纳历史。", inputSchema: { type: "object", properties: { mechanismAssetId: STRING }, required: ["mechanismAssetId"], additionalProperties: false } },
  { name: "review_mechanism_asset", description: "以 human_via_agent 发起机制采纳/拒绝；采纳写入前必须经过持久化确认。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, mechanismAssetId: STRING, expectedRevision: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["adopted", "editor_only", "rejected"] } }, required: ["commandId", "idempotencyKey", "correlationId", "projectId", "mechanismAssetId", "expectedRevision", "status"], additionalProperties: false } },
  { name: "list_adopted_mechanisms", description: "只读取某原创项目的去来源化 Writer 机制投影。", inputSchema: { type: "object", properties: { projectId: STRING }, required: ["projectId"], additionalProperties: false } },
];
const STORY_PLANNING_TOOLS: ToolDefinition[] = [
  { name: "save_project_intent", description: "保存原创 ProjectIntent。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, intent: { type: "object" } }, required: ["commandId", "idempotencyKey", "correlationId", "projectId", "intent"], additionalProperties: false } },
  { name: "submit_story_concepts", description: "提交恰好三个明显不同的 StoryConcept；原始模型 JSON 只入对象库。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, rawOutput: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "projectId", "rawOutput"], additionalProperties: false } },
  { name: "select_story_concept", description: "以 human_via_agent 选择一个概念；会进入持久化确认。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, conceptId: STRING }, required: ["commandId", "idempotencyKey", "correlationId", "projectId", "conceptId"], additionalProperties: false } },
  { name: "review_project_planning_document", description: "以 human_via_agent 按当前 revision 批准或驳回待审核规划；会进入持久化确认。", inputSchema: { type: "object", properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, documentId: STRING, expectedRevision: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["approved", "rejected"] } }, required: ["commandId", "idempotencyKey", "correlationId", "projectId", "documentId", "expectedRevision", "status"], additionalProperties: false } },
  planningDocumentTool("story_contract", "contract"),
  planningDocumentTool("story_system", "system"),
  planningDocumentTool("book_outline", "outline"),
  planningDocumentTool("stage_plan", "stage"),
  planningDocumentTool("chapter_contract", "contract"),
  { name: "list_project_planning_documents", description: "读取项目当前规划文档 revision。", inputSchema: { type: "object", properties: { projectId: STRING }, required: ["projectId"], additionalProperties: false } },
];

const CREATIVE_RECIPE_TOOLS: ToolDefinition[] = [
  {
    name: "create_creative_recipe",
    description: "从当前 ChapterContract 选择的、已采纳且去来源化的机制冻结本章 CreativeRecipe。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, chapterId: STRING },
      required: ["commandId", "idempotencyKey", "correlationId", "projectId", "chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_creative_recipe",
    description: "读取本章已冻结的 CreativeRecipe；不返回参考作品身份、原文、证据或 provenance。",
    inputSchema: { type: "object", properties: { projectId: STRING, chapterId: STRING }, required: ["projectId", "chapterId"], additionalProperties: false },
  },
];

const CHAPTER_CONTEXT_MANIFEST_TOOLS: ToolDefinition[] = [
  {
    name: "freeze_chapter_context_manifest",
    description: "冻结 Writer 的六层章节上下文；必需原创资产缺失、来源字段泄漏或超出预算时 fail closed。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, chapterId: STRING, manifestId: STRING, tokenBudget: { type: "integer", minimum: 2 }, reservedOutputTokens: { type: "integer", minimum: 1 } },
      required: ["commandId", "idempotencyKey", "correlationId", "projectId", "chapterId", "manifestId", "tokenBudget", "reservedOutputTokens"],
      additionalProperties: false,
    },
  },
  {
    name: "get_chapter_context_manifest",
    description: "读取已经冻结的 Writer ContextManifest；不返回参考作品、原文、证据或 provenance。",
    inputSchema: { type: "object", properties: { projectId: STRING, manifestId: STRING }, required: ["projectId", "manifestId"], additionalProperties: false },
  },
];

const CHAPTER_READER_MANIFEST_TOOLS: ToolDefinition[] = [
  {
    name: "freeze_chapter_reader_manifest",
    description: "为沉浸型、低耐心或逻辑敏感 Reader 冻结隔离上下文；只包含待评正文、已知读者状态和必要上文。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, chapterId: STRING, draftDocumentId: STRING, manifestId: STRING, readerKind: { type: "string", enum: ["immersive", "low_patience", "logic_sensitive"] }, tokenBudget: { type: "integer", minimum: 2 } },
      required: ["commandId", "idempotencyKey", "correlationId", "projectId", "chapterId", "draftDocumentId", "manifestId", "readerKind", "tokenBudget"],
      additionalProperties: false,
    },
  },
  {
    name: "get_chapter_reader_manifest",
    description: "读取已冻结的独立 Reader Manifest；其中不包含作者未来规划、机制或参考侧资料。",
    inputSchema: { type: "object", properties: { projectId: STRING, manifestId: STRING }, required: ["projectId", "manifestId"], additionalProperties: false },
  },
];

const CHAPTER_REVIEW_TOOLS: ToolDefinition[] = [
  {
    name: "submit_chapter_review",
    description: "提交独立 Reviewer 的严格 JSON 结果；每个问题必须绑定本次正文的 UTF-8 精确区间和逐字引文，赞美不作为通过依据。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, chapterId: STRING, draftDocumentId: STRING, reviewId: STRING, readerManifestIds: { type: "array", items: STRING, minItems: 3, maxItems: 3, uniqueItems: true }, readerFeedbackDocumentIds: { type: "array", items: STRING, minItems: 3, maxItems: 3, uniqueItems: true }, rawOutput: STRING },
      required: ["commandId", "idempotencyKey", "correlationId", "projectId", "chapterId", "draftDocumentId", "reviewId", "readerManifestIds", "readerFeedbackDocumentIds", "rawOutput"],
      additionalProperties: false,
    },
  },
  {
    name: "get_chapter_review",
    description: "读取一个已验证的章节 Reviewer 报告及其精确问题区间。",
    inputSchema: { type: "object", properties: { projectId: STRING, reviewId: STRING }, required: ["projectId", "reviewId"], additionalProperties: false },
  },
];

const CHAPTER_EDITOR_TOOLS: ToolDefinition[] = [
  {
    name: "create_chapter_editor_draft",
    description: "基于一个已验证 Reviewer 报告定向生成 Editor V2/V3 草稿；改动必须完全位于所选问题的精确范围，不能整章重写或自动接受。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, chapterId: STRING, documentId: STRING, title: STRING, sourceDraftDocumentId: STRING, reviewId: STRING, selectedIssueIds: { type: "array", items: STRING, minItems: 1, uniqueItems: true }, editedText: STRING, rationale: STRING },
      required: ["commandId", "idempotencyKey", "correlationId", "projectId", "chapterId", "documentId", "title", "sourceDraftDocumentId", "reviewId", "selectedIssueIds", "editedText", "rationale"],
      additionalProperties: false,
    },
  },
  {
    name: "get_chapter_editor_draft",
    description: "读取 Editor V2/V3 草稿的父版本、Review、差异范围、理由和正文。",
    inputSchema: { type: "object", properties: { documentId: STRING }, required: ["documentId"], additionalProperties: false },
  },
];

const CHAPTER_EDITOR_TASK_TOOLS: ToolDefinition[] = [
  {
    name: "start_chapter_editor",
    description: "启动本机定向 Editor：只替换一个已验证 Reviewer 问题的精确区间，正式 V2/V3 草稿提交成功后任务才会成功。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, projectId: STRING, chapterId: STRING, title: STRING, targetDocumentId: STRING, sourceDraftDocumentId: STRING, reviewId: STRING, selectedIssueIds: { type: "array", items: STRING, minItems: 1, maxItems: 1, uniqueItems: true }, rationale: STRING, baseURL: STRING, model: STRING, maxTokens: { type: "integer", minimum: 256, maximum: 16384 } },
      required: ["commandId", "idempotencyKey", "correlationId", "taskId", "projectId", "chapterId", "title", "targetDocumentId", "sourceDraftDocumentId", "reviewId", "selectedIssueIds", "rationale"],
      additionalProperties: false,
    },
  },
  { name: "resume_chapter_editor", description: "由当前 MCP 宿主接管已排队的定向 Editor 任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
];

const CHAPTER_READER_TOOLS: ToolDefinition[] = [
  {
    name: "start_chapter_reader",
    description: "基于一个冻结的 Reader Manifest 启动独立本机 Reader 任务；结构化反馈在 UTF-8 区间校验通过前不会提交。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, documentId: STRING, reportId: STRING, projectId: STRING, chapterId: STRING, manifestId: STRING, title: STRING, baseURL: STRING, model: STRING, maxTokens: { type: "integer", minimum: 256, maximum: 16384 } },
      required: ["commandId", "idempotencyKey", "correlationId", "taskId", "documentId", "reportId", "projectId", "chapterId", "manifestId", "title"],
      additionalProperties: false,
    },
  },
  { name: "resume_chapter_reader", description: "由当前 MCP 宿主接管已排队的独立 Reader 任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
  { name: "get_chapter_reader_feedback", description: "读取已验证的独立 Reader 反馈与精确正文区间。", inputSchema: { type: "object", properties: { documentId: STRING }, required: ["documentId"], additionalProperties: false } },
];

const CHAPTER_REVIEWER_TOOLS: ToolDefinition[] = [
  {
    name: "start_chapter_reviewer",
    description: "用三个隔离 Reader 的已验证反馈启动本机 Reviewer；仅当严格 JSON 报告成功正式提交后任务才会成功。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, projectId: STRING, chapterId: STRING, draftDocumentId: STRING, reviewId: STRING, readerManifestIds: { type: "array", items: STRING, minItems: 3, maxItems: 3, uniqueItems: true }, readerFeedbackDocumentIds: { type: "array", items: STRING, minItems: 3, maxItems: 3, uniqueItems: true }, title: STRING, baseURL: STRING, model: STRING, maxTokens: { type: "integer", minimum: 256, maximum: 16384 } },
      required: ["commandId", "idempotencyKey", "correlationId", "taskId", "projectId", "chapterId", "draftDocumentId", "reviewId", "readerManifestIds", "readerFeedbackDocumentIds", "title"],
      additionalProperties: false,
    },
  },
  { name: "resume_chapter_reviewer", description: "由当前 MCP 宿主接管已排队的独立 Reviewer 任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
  { name: "get_chapter_reviewer_review", description: "读取由本机 Reviewer 任务正式提交的精确章节评审报告。", inputSchema: { type: "object", properties: { projectId: STRING, reviewId: STRING }, required: ["projectId", "reviewId"], additionalProperties: false } },
];

const CHAPTER_PRODUCTION_TOOLS: ToolDefinition[] = [
  {
    name: "commit_chapter",
    description: "以 human_via_agent 选择一个已存在的 V1/V2/V3 草稿作为正式章节；会持久化确认，再原子提交正文、Canon、人物知识、ReaderState、ReaderPromise 和 OutlineDrift。",
    inputSchema: {
      type: "object",
      properties: {
        commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, chapterId: STRING, chapterOrdinal: { type: "integer", minimum: 1 }, draftDocumentId: STRING, productionCommitId: STRING,
        chapterDelta: { type: "object" }, canonPatches: { type: "array" }, characterKnowledgePatches: { type: "array" }, readerState: { type: "object" }, readerPromiseUpdates: { type: "array" }, outlineDrift: { type: "object" },
      },
      required: ["commandId", "idempotencyKey", "correlationId", "projectId", "chapterId", "chapterOrdinal", "draftDocumentId", "productionCommitId", "chapterDelta", "canonPatches", "characterKnowledgePatches", "readerState", "readerPromiseUpdates", "outlineDrift"],
      additionalProperties: false,
    },
  },
  {
    name: "get_accepted_chapter",
    description: "读取当前已接受章节正文及其 ChapterDelta、Manifest 标识和版本。",
    inputSchema: { type: "object", properties: { projectId: STRING, chapterId: STRING }, required: ["projectId", "chapterId"], additionalProperties: false },
  },
];

const CHAPTER_WRITER_TOOLS: ToolDefinition[] = [
  {
    name: "start_chapter_writer_v1",
    description: "只使用冻结的 Writer ContextManifest 启动本机模型 Writer V1；生成结果仅为待审阅草稿，不会写 Canon 或正式章节。",
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, taskId: STRING, documentId: STRING, projectId: STRING, chapterId: STRING, manifestId: STRING, title: STRING, baseURL: STRING, model: STRING, maxTokens: { type: "integer", minimum: 256, maximum: 16384 } },
      required: ["commandId", "idempotencyKey", "correlationId", "taskId", "documentId", "projectId", "chapterId", "manifestId", "title"],
      additionalProperties: false,
    },
  },
  { name: "resume_chapter_writer_v1", description: "由当前 MCP 宿主接管已排队的 Writer V1 任务。", inputSchema: { type: "object", properties: { taskId: STRING }, required: ["taskId"], additionalProperties: false } },
  { name: "get_chapter_writer_draft", description: "读取 Writer V1 待审阅正文及其 Manifest 标识。", inputSchema: { type: "object", properties: { documentId: STRING }, required: ["documentId"], additionalProperties: false } },
];

function planningDocumentTool(kind: string, field: string): ToolDefinition {
  return {
    name: `save_${kind}`,
    description: `保存 ${kind} 规划文档。`,
    inputSchema: {
      type: "object",
      properties: { commandId: STRING, idempotencyKey: STRING, correlationId: STRING, projectId: STRING, [field]: { type: "object" } },
      required: ["commandId", "idempotencyKey", "correlationId", "projectId", field],
      additionalProperties: false,
    },
  };
}

export interface ApplicationMcpOptions {
  application: WorkspaceApplicationService;
  tasks?: TaskRunner;
  creation?: LocalCreationService;
  maintenance?: WorkspaceMaintenanceService;
  exporter?: WorkspaceExportService;
  references?: ReferenceImportService;
  referenceFileImport?: ReferenceFileImportService;
  corpus?: AnalysisCorpusService;
  facts?: AnalysisFactService;
  maps?: StructuralReadingMapService;
  factExtraction?: LocalFactExtractionService;
  batchFactExtraction?: LocalFactExtractionBatchService;
  threads?: ThreadGraphService;
  brief?: AnalysisBriefService;
  conclusions?: ResearchConclusionService;
  falsification?: IndependentFalsificationService;
  dossier?: ResearchDossierService;
  workbench?: EvidenceWorkbenchService;
  mechanisms?: MechanismAssetService;
  planning?: StoryPlanningService;
  recipes?: CreativeRecipeService;
  manifests?: ChapterContextManifestService;
  readerManifests?: ChapterReaderManifestService;
  reviews?: ChapterReviewService;
  editor?: ChapterEditorService;
  editorTasks?: ChapterEditorTaskService;
  readers?: ChapterReaderService;
  reviewer?: ChapterReviewerService;
  production?: ChapterProductionCommitService;
  writer?: ChapterWriterService;
  pipelines?: PipelineRevisionService;
}

/** 新 MCP 语义层：没有 SQL、settings、文件或 Zustand 访问入口。 */
export function createApplicationMcpJsonRpcHandler(input: WorkspaceApplicationService | ApplicationMcpOptions) {
  const { application, tasks, creation, maintenance, exporter, references, referenceFileImport, corpus, facts, maps, factExtraction, batchFactExtraction, threads, brief, conclusions, falsification, dossier, workbench, mechanisms, planning, recipes, manifests, readerManifests, reviews, editor, editorTasks, readers, reviewer, production, writer, pipelines } = "application" in input ? input : { application: input };
  const tools = [
    ...TOOLS, ...CONFIRMATION_TOOLS, ...(pipelines ? PIPELINE_TOOLS : []), ...(tasks ? TASK_TOOLS : []), ...(creation ? LOCAL_CREATION_TOOLS : []), ...(maintenance ? WORKSPACE_MAINTENANCE_TOOLS : []), ...(exporter ? WORKSPACE_EXPORT_TOOLS : []), ...(factExtraction ? LOCAL_FACT_EXTRACTION_TOOLS : []), ...(batchFactExtraction ? LOCAL_FACT_EXTRACTION_BATCH_TOOLS : []), ...(references || referenceFileImport ? REFERENCE_TOOLS : []), ...(corpus ? ANALYSIS_TOOLS : []), ...(maps ? READING_MAP_TOOLS : []), ...(facts ? FACT_LEDGER_TOOLS : []), ...(threads ? THREAD_GRAPH_TOOLS : []), ...(brief ? ANALYSIS_BRIEF_TOOLS : []), ...(conclusions ? RESEARCH_CONCLUSION_TOOLS : []), ...(falsification ? INDEPENDENT_FALSIFICATION_TOOLS : []), ...(dossier ? RESEARCH_DOSSIER_TOOLS : []), ...(workbench ? EVIDENCE_WORKBENCH_TOOLS : []), ...(mechanisms ? MECHANISM_ASSET_TOOLS : []), ...(planning ? STORY_PLANNING_TOOLS : []), ...(recipes ? CREATIVE_RECIPE_TOOLS : []), ...(manifests ? CHAPTER_CONTEXT_MANIFEST_TOOLS : []), ...(readerManifests ? CHAPTER_READER_MANIFEST_TOOLS : []), ...(readers ? CHAPTER_READER_TOOLS : []), ...(reviewer ? CHAPTER_REVIEWER_TOOLS : []), ...(reviews ? CHAPTER_REVIEW_TOOLS : []), ...(editor ? CHAPTER_EDITOR_TOOLS : []), ...(editorTasks ? CHAPTER_EDITOR_TASK_TOOLS : []), ...(production ? CHAPTER_PRODUCTION_TOOLS : []), ...(writer ? CHAPTER_WRITER_TOOLS : []),
  ];
  return async (request: ApplicationMcpJsonRpcRequest): Promise<Record<string, unknown> | null> => {
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return error(request?.id ?? null, -32600, "Invalid Request");
    if (request.id === undefined || request.method.startsWith("notifications/")) return null;
    if (request.method === "initialize") return success(request.id, { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "ainovr", version: "0.2.0" } });
    if (request.method === "ping") return success(request.id, {});
    if (request.method === "tools/list") return success(request.id, { tools });
    if (request.method !== "tools/call") return error(request.id, -32601, `Method not found：${request.method}`);

    const params = record(request.params);
    const name = typeof params?.name === "string" ? params.name : "";
    const args = record(params?.arguments);
    if (!args) return error(request.id, -32602, "tools/call arguments 必须是对象");
    try {
      const output = await callTool(application, tasks, creation, maintenance, exporter, references, referenceFileImport, corpus, facts, maps, factExtraction, batchFactExtraction, threads, brief, conclusions, falsification, dossier, workbench, mechanisms, planning, recipes, manifests, readerManifests, reviews, editor, editorTasks, readers, reviewer, production, writer, pipelines, name, args);
      return success(request.id, { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output, isError: false });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "MCP tool failed";
      return success(request.id, { content: [{ type: "text", text: message }], structuredContent: { error: message }, isError: true });
    }
  };
}

async function callTool(application: WorkspaceApplicationService, tasks: TaskRunner | undefined, creation: LocalCreationService | undefined, maintenance: WorkspaceMaintenanceService | undefined, exporter: WorkspaceExportService | undefined, references: ReferenceImportService | undefined, referenceFileImport: ReferenceFileImportService | undefined, corpus: AnalysisCorpusService | undefined, facts: AnalysisFactService | undefined, maps: StructuralReadingMapService | undefined, factExtraction: LocalFactExtractionService | undefined, batchFactExtraction: LocalFactExtractionBatchService | undefined, threads: ThreadGraphService | undefined, brief: AnalysisBriefService | undefined, conclusions: ResearchConclusionService | undefined, falsification: IndependentFalsificationService | undefined, dossier: ResearchDossierService | undefined, workbench: EvidenceWorkbenchService | undefined, mechanisms: MechanismAssetService | undefined, planning: StoryPlanningService | undefined, recipes: CreativeRecipeService | undefined, manifests: ChapterContextManifestService | undefined, readerManifests: ChapterReaderManifestService | undefined, reviews: ChapterReviewService | undefined, editor: ChapterEditorService | undefined, editorTasks: ChapterEditorTaskService | undefined, readers: ChapterReaderService | undefined, reviewer: ChapterReviewerService | undefined, production: ChapterProductionCommitService | undefined, writer: ChapterWriterService | undefined, pipelines: PipelineRevisionService | undefined, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "get_workspace_status") return application.queries.getWorkspaceStatus();
  if (name === "get_capabilities") return application.queries.getCapabilities();
  if (name === "list_changes") {
    const after = args.after;
    if (!Number.isInteger(after) || (after as number) < 0) throw new Error("after 必须是非负整数");
    const limit = args.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) throw new Error("limit 必须介于 1 和 100");
    return application.queries.listChanges(after as number, limit as number | undefined);
  }
  if (name === "list_actionable_tasks") return application.queries.listActionableTasks();
  if (name === "list_pending_confirmations") return application.queries.listPendingConfirmations();
  if (name === "get_confirmation") return application.queries.getConfirmation(requiredString(args, "confirmationId"));
  if (name === "approve_confirmation") {
    return application.commands.approveConfirmation({
      confirmationId: requiredString(args, "confirmationId"),
      actor: { kind: "human_via_agent", id: "mcp" },
      reason: requiredString(args, "reason"),
    });
  }
  if (name === "reject_confirmation") {
    return application.commands.rejectConfirmation({
      confirmationId: requiredString(args, "confirmationId"),
      actor: { kind: "human_via_agent", id: "mcp" },
      reason: requiredString(args, "reason"),
    });
  }
  if (name === "get_novel_project") {
    const projectId = requiredString(args, "projectId");
    return application.queries.getNovelProject(projectId);
  }
  if (name === "list_novel_projects") return application.queries.listNovelProjects();
  if (name === "get_project_workbench") return application.queries.getProjectWorkbench(requiredString(args, "projectId"));
  if (name === "list_project_documents") return application.queries.listProjectDocuments(requiredString(args, "projectId"));
  if (name === "get_document") return application.queries.getProjectDocument({ projectId: requiredString(args, "projectId"), documentId: requiredString(args, "documentId") });
  if (name === "get_reference_workbench") return application.queries.getReferenceWorkbench(requiredString(args, "referenceWorkId"));
  if (name === "list_pending_mechanism_assets") return application.queries.listPendingMechanismAssets();
  if (name === "list_pending_planning_documents") return application.queries.listPendingPlanningDocuments();
  if (name === "list_coverage_gaps") return application.queries.listCoverageGaps();
  if (name === "list_provider_profiles") return application.queries.listProviderProfiles();
  if (name === "get_workspace_settings") return application.queries.getWorkspaceSettings();
  if (name === "get_evidence_excerpt") return application.queries.getEvidenceExcerpt(requiredString(args, "evidenceInstanceId"));
  if (name === "list_pipeline_revisions") { if (!pipelines) throw new Error("PipelineRevision 服务未配置。"); return pipelines.list(); }
  if (name === "save_pipeline_revision") {
    if (!pipelines) throw new Error("PipelineRevision 服务未配置。");
    const expectedRevision = args.expectedRevision;
    return pipelines.save({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      pipelineId: requiredString(args, "pipelineId"), name: requiredString(args, "name"), status: typeof args.status === "string" ? args.status : undefined,
      steps: args.steps as never, expectedRevision: expectedRevision === undefined ? null : expectedRevision as number,
    });
  }
  if (name === "start_pipeline_run") {
    if (!pipelines) throw new Error("PipelineRevision 服务未配置。");
    return application.pipelineRuns.start({ command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() }, runId: requiredString(args, "runId"), pipelineId: requiredString(args, "pipelineId"), projectId: typeof args.projectId === "string" ? args.projectId : null });
  }
  if (name === "list_pipeline_runs") {
    if (!pipelines) throw new Error("PipelineRevision 服务未配置。");
    return application.pipelineRuns.list(args.limit === undefined ? 20 : requiredIntegerInRange(args, "limit", 1, 100));
  }
  if (name === "get_pipeline_run") {
    if (!pipelines) throw new Error("PipelineRevision 服务未配置。 ");
    return application.pipelineRuns.get(requiredString(args, "runId"));
  }
  if (name === "complete_pipeline_run_step") {
    if (!pipelines) throw new Error("PipelineRevision 服务未配置。");
    return application.pipelineRuns.completeStep({ command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "human_via_agent", id: "mcp" }, createdAt: Date.now() }, runId: requiredString(args, "runId"), stepId: requiredString(args, "stepId"), note: requiredString(args, "note") });
  }
  if (name === "execute_pipeline_run_step") {
    if (!pipelines) throw new Error("当前 MCP companion 未配置 PipelineRevision 服务。 ");
    const runId = requiredString(args, "runId"); const stepId = requiredString(args, "stepId");
    const run = await application.pipelineRuns.get(runId);
    const step = run?.nodes.find((item) => item.stepId === stepId);
    if (!run || !step || step.status !== "pending" || !step.enabled) throw new Error("PipelineRun 步骤不存在、未启用或已完成。 ");
    const taskId = `pipeline:${runId}:${stepId}`;
    const command = { schemaVersion: 1 as const, commandId: `pipeline-execute:${runId}:${stepId}`, idempotencyKey: `pipeline-execute:${runId}:${stepId}`, correlationId: `pipeline-run:${runId}`, actor: { kind: "internal_agent" as const, id: "mcp-pipeline" }, createdAt: Date.now() };
    if (step.tool === "start_local_fact_extraction_batch") {
      if (!batchFactExtraction) throw new Error("当前 MCP companion 未配置 FactExtractor 批任务宿主。 ");
      const config = pipelineConfig(step.config, ["analysisProjectId"], ["maxTokens"]);
      const analysisProjectId = requiredString(config, "analysisProjectId");
      const maxTokens = config.maxTokens === undefined ? undefined : requiredIntegerInRange(config, "maxTokens", 256, 16_384);
      const started = await batchFactExtraction.start({ command, taskId, analysisProjectId, baseURL: "http://configured-route.invalid/v1", model: "configured-route", ...(maxTokens === undefined ? {} : { maxTokens }) });
      if (started.kind === "accepted") void batchFactExtraction.run(taskId).catch(() => undefined);
      return { runId, stepId, taskId, command: started };
    }
    if (step.tool === "start_chapter_writer_v1") {
      if (!writer) throw new Error("当前 MCP companion 未配置 ChapterWriter 宿主。 ");
      const config = pipelineConfig(step.config, ["projectId", "chapterId", "manifestId", "documentId", "title"], ["maxTokens"]);
      const maxTokens = config.maxTokens === undefined ? undefined : requiredIntegerInRange(config, "maxTokens", 256, 16_384);
      const started = await writer.start({ command, taskId, projectId: requiredString(config, "projectId"), chapterId: requiredString(config, "chapterId"), manifestId: requiredString(config, "manifestId"), documentId: requiredString(config, "documentId"), title: requiredString(config, "title"), baseURL: "http://configured-route.invalid/v1", model: "configured-route", ...(maxTokens === undefined ? {} : { maxTokens }) });
      if (started.kind === "accepted") void writer.run(taskId).catch(() => undefined);
      return { runId, stepId, taskId, command: started };
    }
    if (step.tool === "start_chapter_reader") {
      if (!readers) throw new Error("当前 MCP companion 未配置 ChapterReader 宿主。 ");
      const config = pipelineConfig(step.config, ["projectId", "chapterId", "manifestId", "documentId", "reportId", "title"], ["maxTokens"]);
      const maxTokens = config.maxTokens === undefined ? undefined : requiredIntegerInRange(config, "maxTokens", 256, 16_384);
      const started = await readers.start({ command, taskId, projectId: requiredString(config, "projectId"), chapterId: requiredString(config, "chapterId"), manifestId: requiredString(config, "manifestId"), documentId: requiredString(config, "documentId"), reportId: requiredString(config, "reportId"), title: requiredString(config, "title"), baseURL: "http://configured-route.invalid/v1", model: "configured-route", ...(maxTokens === undefined ? {} : { maxTokens }) });
      if (started.kind === "accepted") void readers.run(taskId).catch(() => undefined);
      return { runId, stepId, taskId, command: started };
    }
    if (step.tool === "start_chapter_reviewer") {
      if (!reviewer) throw new Error("当前 MCP companion 未配置 ChapterReviewer 宿主。 ");
      const config = pipelineConfig(step.config, ["projectId", "chapterId", "draftDocumentId", "reviewId", "readerManifestIds", "readerFeedbackDocumentIds", "title"], ["maxTokens"]);
      const maxTokens = config.maxTokens === undefined ? undefined : requiredIntegerInRange(config, "maxTokens", 256, 16_384);
      const started = await reviewer.start({ command, taskId, projectId: requiredString(config, "projectId"), chapterId: requiredString(config, "chapterId"), draftDocumentId: requiredString(config, "draftDocumentId"), reviewId: requiredString(config, "reviewId"), readerManifestIds: requiredStringArray(config, "readerManifestIds"), readerFeedbackDocumentIds: requiredStringArray(config, "readerFeedbackDocumentIds"), title: requiredString(config, "title"), baseURL: "http://configured-route.invalid/v1", model: "configured-route", ...(maxTokens === undefined ? {} : { maxTokens }) });
      if (started.kind === "accepted") void reviewer.run(taskId).catch(() => undefined);
      return { runId, stepId, taskId, command: started };
    }
    if (step.tool === "start_chapter_editor") {
      if (!editorTasks) throw new Error("当前 MCP companion 未配置 ChapterEditor 宿主。 ");
      const config = pipelineConfig(step.config, ["projectId", "chapterId", "title", "targetDocumentId", "sourceDraftDocumentId", "reviewId", "selectedIssueIds", "rationale"], ["maxTokens"]);
      const maxTokens = config.maxTokens === undefined ? undefined : requiredIntegerInRange(config, "maxTokens", 256, 16_384);
      const started = await editorTasks.start({ command, taskId, projectId: requiredString(config, "projectId"), chapterId: requiredString(config, "chapterId"), title: requiredString(config, "title"), targetDocumentId: requiredString(config, "targetDocumentId"), sourceDraftDocumentId: requiredString(config, "sourceDraftDocumentId"), reviewId: requiredString(config, "reviewId"), selectedIssueIds: requiredStringArray(config, "selectedIssueIds"), rationale: requiredString(config, "rationale"), baseURL: "http://configured-route.invalid/v1", model: "configured-route", ...(maxTokens === undefined ? {} : { maxTokens }) });
      if (started.kind === "accepted") void editorTasks.run(taskId).catch(() => undefined);
      return { runId, stepId, taskId, command: started };
    }
    throw new Error(`Pipeline 步骤 ${step.tool} 尚无受控宿主执行器；请调用对应领域工具后记录人工复核。 `);
  }
  if (name === "save_workspace_settings") {
    const expectedRevision = args.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1)) throw new Error("expectedRevision 必须是正整数。 ");
    return application.commands.execute({
      schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" },
      ...(expectedRevision === undefined ? {} : { expectedRevision: expectedRevision as number }), tool: "save_workspace_settings",
      args: { automationMode: requiredString(args, "automationMode"), contextWindowTokens: requiredPositiveInteger(args, "contextWindowTokens"), maxOutputTokens: requiredPositiveInteger(args, "maxOutputTokens"), safetyMarginRatio: requiredRatio(args, "safetyMarginRatio"), cloudEscalation: requiredString(args, "cloudEscalation") }, createdAt: Date.now(),
    });
  }
  if (name === "save_provider_profile") {
    const expectedRevision = args.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1)) throw new Error("expectedRevision 必须是正整数。 ");
    return application.commands.execute({
      schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" },
      ...(expectedRevision === undefined ? {} : { expectedRevision: expectedRevision as number }), tool: "save_provider_profile",
      args: { providerProfileId: requiredString(args, "providerProfileId"), name: requiredString(args, "name"), baseURL: requiredString(args, "baseURL"), defaultModel: requiredString(args, "defaultModel"), routes: requiredRecords(args, "routes") }, createdAt: Date.now(),
    });
  }
  if (name === "create_novel_project") {
    const payload = record(args.payload);
    if (!payload) throw new Error("payload 必须是对象");
    const command: CommandEnvelope = {
      schemaVersion: 1,
      commandId: requiredString(args, "commandId"),
      idempotencyKey: requiredString(args, "idempotencyKey"),
      correlationId: requiredString(args, "correlationId"),
      actor: { kind: "external_agent", id: "mcp" },
      tool: "create_novel_project",
      args: { projectId: requiredString(args, "projectId"), title: requiredString(args, "title"), status: requiredString(args, "status"), payload },
      createdAt: Date.now(),
    };
    return application.commands.execute(command);
  }
  if (name === "get_task") return tasks?.get(requiredString(args, "taskId")) ?? unavailableTaskRunner();
  if (name === "wait_task") {
    const timeout = typeof args.timeoutMs === "number" ? args.timeoutMs : 30_000;
    return tasks?.wait(requiredString(args, "taskId"), timeout) ?? unavailableTaskRunner();
  }
  if (name === "cancel_task") {
    if (!tasks) return unavailableTaskRunner();
    const taskId = requiredString(args, "taskId");
    if (creation) await creation.cancel(taskId);
    else await application.taskActions.requestCancel(taskId);
    return tasks.get(taskId);
  }
  if (name === "retry_task") {
    if (!tasks) return unavailableTaskRunner();
    const taskId = requiredString(args, "taskId");
    await application.taskActions.retry(taskId);
    return tasks.get(taskId);
  }
  if (name === "start_local_creation") {
    if (!creation) throw new Error("当前 MCP companion 未配置本地创作服务。");
    const result = await creation.start({
      command: {
        schemaVersion: 1,
        commandId: requiredString(args, "commandId"),
        idempotencyKey: requiredString(args, "idempotencyKey"),
        correlationId: requiredString(args, "correlationId"),
        actor: { kind: "external_agent", id: "mcp" },
        createdAt: Date.now(),
      },
      taskId: requiredString(args, "taskId"),
      documentId: requiredString(args, "documentId"),
      projectId: requiredString(args, "projectId"),
      title: requiredString(args, "title"),
      prompt: requiredString(args, "prompt"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind === "accepted") void creation.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "get_local_creation_draft") {
    if (!creation) throw new Error("当前 MCP companion 未配置本地创作服务。");
    return creation.getDraft(requiredString(args, "documentId"));
  }
  if (name === "resume_local_creation") {
    if (!creation) throw new Error("当前 MCP companion 未配置本地创作服务。");
    const taskId = requiredString(args, "taskId");
    void creation.run(taskId).catch(() => undefined);
    return creation.getTask(taskId);
  }
  if (name === "create_workspace_backup") {
    if (!maintenance) throw new Error("当前 MCP companion 未配置工作区备份恢复服务。 ");
    const result = await maintenance.startBackup({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"), backupId: requiredString(args, "backupId"),
    });
    if (result.kind === "accepted") void maintenance.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "restore_workspace_backup") {
    if (!maintenance) throw new Error("当前 MCP companion 未配置工作区备份恢复服务。 ");
    return maintenance.startRestore({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"), backupId: requiredString(args, "backupId"), restoreId: requiredString(args, "restoreId"),
    });
  }
  if (name === "resume_workspace_maintenance") {
    if (!maintenance) throw new Error("当前 MCP companion 未配置工作区备份恢复服务。 ");
    const taskId = requiredString(args, "taskId");
    void maintenance.run(taskId).catch(() => undefined);
    return maintenance.getTask(taskId);
  }
  if (name === "export_project") {
    if (!exporter) throw new Error("当前 MCP companion 未配置工作区导出服务。 ");
    const result = await exporter.startProjectExport({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"), projectId: requiredString(args, "projectId"), exportId: requiredString(args, "exportId"),
    });
    if (result.kind === "accepted") void exporter.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "export_analysis") {
    if (!exporter) throw new Error("当前 MCP companion 未配置工作区导出服务。 ");
    const result = await exporter.startAnalysisExport({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"), referenceWorkId: requiredString(args, "referenceWorkId"), exportId: requiredString(args, "exportId"),
    });
    if (result.kind === "accepted") void exporter.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "resume_workspace_export") {
    if (!exporter) throw new Error("当前 MCP companion 未配置工作区导出服务。 ");
    const taskId = requiredString(args, "taskId");
    void exporter.run(taskId).catch(() => undefined);
    return exporter.getTask(taskId);
  }
  if (name === "start_local_fact_extraction") {
    if (!factExtraction) throw new Error("当前 MCP companion 未配置本地 FactExtractor 服务。");
    const result = await factExtraction.start({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"),
      analysisProjectId: requiredString(args, "analysisProjectId"),
      analysisUnitId: requiredString(args, "analysisUnitId"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind === "accepted") void factExtraction.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "resume_local_fact_extraction") {
    if (!factExtraction) throw new Error("当前 MCP companion 未配置本地 FactExtractor 服务。");
    const taskId = requiredString(args, "taskId");
    void factExtraction.run(taskId).catch(() => undefined);
    return factExtraction.getTask(taskId);
  }
  if (name === "reconfigure_local_fact_extraction") {
    if (!factExtraction) throw new Error("当前 MCP companion 未配置本地 FactExtractor 服务。");
    const result = await factExtraction.reconfigure({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind === "accepted") void factExtraction.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "start_local_fact_extraction_batch") {
    if (!batchFactExtraction) throw new Error("当前 MCP companion 未配置本地 FactExtractor 批服务。 ");
    const result = await batchFactExtraction.start({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"),
      analysisProjectId: requiredString(args, "analysisProjectId"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind === "accepted") void batchFactExtraction.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "resume_local_fact_extraction_batch") {
    if (!batchFactExtraction) throw new Error("当前 MCP companion 未配置本地 FactExtractor 批服务。 ");
    const taskId = requiredString(args, "taskId");
    void batchFactExtraction.run(taskId).catch(() => undefined);
    return batchFactExtraction.getTask(taskId);
  }
  if (name === "list_reference_works") {
    if (!references) throw new Error("当前 MCP companion 未配置参考文本服务。");
    return references.listReferenceWorks();
  }
  if (name === "get_reference_work") {
    if (!references) throw new Error("当前 MCP companion 未配置参考文本服务。");
    return references.getReferenceWork(requiredString(args, "referenceWorkId"));
  }
  if (name === "import_reference_text") {
    if (!references) throw new Error("当前 MCP companion 未配置参考文本服务。");
    return references.importText({
      command: {
        schemaVersion: 1,
        commandId: requiredString(args, "commandId"),
        idempotencyKey: requiredString(args, "idempotencyKey"),
        correlationId: requiredString(args, "correlationId"),
        actor: { kind: "external_agent", id: "mcp" },
        createdAt: Date.now(),
      },
      referenceWorkId: requiredString(args, "referenceWorkId"),
      sourceEditionId: requiredString(args, "sourceEditionId"),
      title: requiredString(args, "title"),
      text: requiredString(args, "text"),
    });
  }
  if (name === "request_reference_file_import") {
    if (!referenceFileImport) throw new Error("当前 MCP companion 未配置参考文件导入服务。");
    return referenceFileImport.start({
      command: {
        schemaVersion: 1,
        commandId: requiredString(args, "commandId"),
        idempotencyKey: requiredString(args, "idempotencyKey"),
        correlationId: requiredString(args, "correlationId"),
        actor: { kind: "external_agent", id: "mcp" },
        createdAt: Date.now(),
      },
      taskId: requiredString(args, "taskId"),
      referenceWorkId: requiredString(args, "referenceWorkId"),
      sourceEditionId: requiredString(args, "sourceEditionId"),
      title: requiredString(args, "title"),
      sourcePath: requiredString(args, "sourcePath"),
    });
  }
  if (name === "resume_reference_file_import") {
    if (!referenceFileImport) throw new Error("当前 MCP companion 未配置参考文件导入服务。");
    const taskId = requiredString(args, "taskId");
    void referenceFileImport.run(taskId).catch(() => undefined);
    return referenceFileImport.getTask(taskId);
  }
  if (name === "find_source_text") {
    if (!references) throw new Error("当前 MCP companion 未配置参考文本服务。");
    return references.findText({
      sourceEditionId: requiredString(args, "sourceEditionId"),
      query: requiredString(args, "query"),
      limit: args.limit === undefined ? 10 : requiredIntegerInRange(args, "limit", 1, 50),
    });
  }
  if (name === "get_source_excerpt") {
    if (!references) throw new Error("当前 MCP companion 未配置参考文本服务。");
    return references.getExcerpt({
      sourceEditionId: requiredString(args, "sourceEditionId"),
      startByte: requiredNonNegativeInteger(args, "startByte"),
      endByte: requiredNonNegativeInteger(args, "endByte"),
    });
  }
  if (name === "update_analysis_segmentation") {
    if (!corpus) throw new Error("当前 MCP companion 未配置 AnalysisCorpus 服务。");
    const budget = record(args.budget);
    if (!budget) throw new Error("budget 必须是对象");
    const boundary = args.boundary;
    if (boundary !== "complete" && boundary !== "volume" && boundary !== "fragment") throw new Error("boundary 非法");
    return corpus.prepare({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      segmentationId: requiredString(args, "segmentationId"),
      sourceEditionId: requiredString(args, "sourceEditionId"),
      boundary,
      ...(args.byteRange === undefined ? {} : { byteRange: requiredByteRange(args, "byteRange") }),
      budget: {
        contextWindowTokens: requiredPositiveInteger(budget, "contextWindowTokens"),
        safetyMarginRatio: requiredRatio(budget, "safetyMarginRatio"),
        reservedOutputTokens: requiredNonNegativeInteger(budget, "reservedOutputTokens"),
        renderedSystemPromptTokens: requiredNonNegativeInteger(budget, "renderedSystemPromptTokens"),
        renderedSchemaTokens: requiredNonNegativeInteger(budget, "renderedSchemaTokens"),
        envelopeTokens: requiredNonNegativeInteger(budget, "envelopeTokens"),
      },
    });
  }
  if (name === "get_analysis_overview") {
    if (!corpus) throw new Error("当前 MCP companion 未配置 AnalysisCorpus 服务。");
    return corpus.getOverview(requiredString(args, "analysisProjectId"));
  }
  if (name === "get_source_span") {
    if (!corpus) throw new Error("当前 MCP companion 未配置 AnalysisCorpus 服务。");
    return corpus.getSourceSpan(requiredString(args, "spanId"));
  }
  if (name === "create_structural_reading_map") {
    if (!maps) throw new Error("当前 MCP companion 未配置 ReadingMap 服务。");
    return maps.create({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
    });
  }
  if (name === "get_structural_reading_map") {
    if (!maps) throw new Error("当前 MCP companion 未配置 ReadingMap 服务。");
    return maps.get(requiredString(args, "analysisProjectId"));
  }
  if (name === "submit_analysis_facts") {
    if (!facts) throw new Error("当前 MCP companion 未配置 FactLedger 服务。");
    return facts.submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      analysisUnitId: requiredString(args, "analysisUnitId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (name === "get_fact_ledger") {
    if (!facts) throw new Error("当前 MCP companion 未配置 FactLedger 服务。");
    return facts.getFactLedger(requiredString(args, "analysisProjectId"), requiredString(args, "analysisUnitId"));
  }
  if (name === "submit_thread_graph") {
    if (!threads) throw new Error("当前 MCP companion 未配置 ThreadGraph 服务。");
    return threads.submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (name === "get_thread_graph") {
    if (!threads) throw new Error("当前 MCP companion 未配置 ThreadGraph 服务。");
    return threads.getThreads(requiredString(args, "analysisProjectId"));
  }
  if (name === "submit_analysis_brief") {
    if (!brief) throw new Error("当前 MCP companion 未配置 AnalysisBrief 服务。");
    return brief.submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (name === "get_analysis_brief") {
    if (!brief) throw new Error("当前 MCP companion 未配置 AnalysisBrief 服务。");
    return brief.get(requiredString(args, "analysisProjectId"));
  }
  if (name === "approve_analysis_brief") {
    if (!brief) throw new Error("当前 MCP companion 未配置 AnalysisBrief 服务。");
    return brief.approve({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "human_via_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
    });
  }
  if (name === "submit_research_conclusions") {
    if (!conclusions) throw new Error("当前 MCP companion 未配置 ResearchConclusion 服务。");
    return conclusions.submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      researchQuestionId: requiredString(args, "researchQuestionId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (name === "get_research_conclusions") {
    if (!conclusions) throw new Error("当前 MCP companion 未配置 ResearchConclusion 服务。");
    return conclusions.getByQuestion(requiredString(args, "analysisProjectId"), requiredString(args, "researchQuestionId"));
  }
  if (name === "get_falsification_work_item") {
    if (!falsification) throw new Error("当前 MCP companion 未配置 IndependentFalsification 服务。");
    return falsification.getWorkItem(requiredString(args, "analysisProjectId"), requiredString(args, "conclusionId"));
  }
  if (name === "submit_independent_falsification") {
    if (!falsification) throw new Error("当前 MCP companion 未配置 IndependentFalsification 服务。");
    return falsification.submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      conclusionId: requiredString(args, "conclusionId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (name === "get_independent_falsification") {
    if (!falsification) throw new Error("当前 MCP companion 未配置 IndependentFalsification 服务。");
    return falsification.getByConclusion(requiredString(args, "analysisProjectId"), requiredString(args, "conclusionId"));
  }
  if (name === "create_research_dossier") {
    if (!dossier) throw new Error("当前 MCP companion 未配置 ResearchDossier 服务。");
    return dossier.create({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
    });
  }
  if (name === "get_research_dossier") {
    if (!dossier) throw new Error("当前 MCP companion 未配置 ResearchDossier 服务。");
    return dossier.getLatest(requiredString(args, "analysisProjectId"));
  }
  if (name === "get_analysis_evidence") {
    if (!workbench) throw new Error("当前 MCP companion 未配置 EvidenceWorkbench 服务。");
    return workbench.getEvidence({
      analysisProjectId: requiredString(args, "analysisProjectId"),
      ...(args.researchQuestionId === undefined ? {} : { researchQuestionId: requiredString(args, "researchQuestionId") }),
      ...(args.conclusionId === undefined ? {} : { conclusionId: requiredString(args, "conclusionId") }),
      ...(args.spanId === undefined ? {} : { spanId: requiredString(args, "spanId") }),
    });
  }
  if (name === "list_analysis_coverage") {
    if (!workbench) throw new Error("当前 MCP companion 未配置 EvidenceWorkbench 服务。");
    return workbench.listCoverage({
      analysisProjectId: requiredString(args, "analysisProjectId"),
      ...(args.module === undefined ? {} : { module: requiredString(args, "module") }),
      ...(args.analysisUnitId === undefined ? {} : { analysisUnitId: requiredString(args, "analysisUnitId") }),
    });
  }
  if (name === "propose_mechanism_candidate") {
    if (!mechanisms) throw new Error("当前 MCP companion 未配置 MechanismAsset 服务。");
    return mechanisms.propose({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "mcp" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (name === "list_mechanism_candidates") {
    if (!mechanisms) throw new Error("当前 MCP companion 未配置 MechanismAsset 服务。");
    return mechanisms.listCandidates(args.analysisProjectId === undefined ? undefined : requiredString(args, "analysisProjectId"));
  }
  if (name === "get_mechanism_asset") {
    if (!mechanisms) throw new Error("当前 MCP companion 未配置 MechanismAsset 服务。");
    return mechanisms.get(requiredString(args, "mechanismAssetId"));
  }
  if (name === "review_mechanism_asset") {
    if (!mechanisms) throw new Error("当前 MCP companion 未配置 MechanismAsset 服务。");
    const expectedRevision = requiredPositiveInteger(args, "expectedRevision");
    const status = requiredString(args, "status");
    if (status !== "adopted" && status !== "editor_only" && status !== "rejected") throw new Error("status 必须为 adopted、editor_only 或 rejected。");
    return mechanisms.review({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "human_via_agent", id: "mcp" }, projectId: requiredString(args, "projectId"), expectedRevision, createdAt: Date.now() },
      mechanismAssetId: requiredString(args, "mechanismAssetId"), status,
    });
  }
  if (name === "list_adopted_mechanisms") {
    if (!mechanisms) throw new Error("当前 MCP companion 未配置 MechanismAsset 服务。");
    return mechanisms.listAdopted(requiredString(args, "projectId"));
  }
  if (name === "list_project_planning_documents") {
    if (!planning) throw new Error("当前 MCP companion 未配置 StoryPlanning 服务。");
    return planning.listDocuments(requiredString(args, "projectId"));
  }
  if (name === "save_project_intent") {
    if (!planning) throw new Error("当前 MCP companion 未配置 StoryPlanning 服务。");
    return planning.saveProjectIntent({ command: planningCommand(args, "external_agent"), projectId: requiredString(args, "projectId"), intent: requiredRecord(args, "intent") });
  }
  if (name === "submit_story_concepts") {
    if (!planning) throw new Error("当前 MCP companion 未配置 StoryPlanning 服务。");
    return planning.submitStoryConcepts({ command: planningCommand(args, "external_agent"), projectId: requiredString(args, "projectId"), rawOutput: requiredString(args, "rawOutput") });
  }
  if (name === "select_story_concept") {
    if (!planning) throw new Error("当前 MCP companion 未配置 StoryPlanning 服务。");
    return planning.selectStoryConcept({ command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), conceptId: requiredString(args, "conceptId") });
  }
  if (name === "review_project_planning_document") {
    if (!planning) throw new Error("当前 MCP companion 未配置 StoryPlanning 服务。");
    const status = requiredString(args, "status");
    if (status !== "approved" && status !== "rejected") throw new Error("status 必须为 approved 或 rejected。");
    return planning.reviewDocument({
      command: planningCommand(args, "human_via_agent"),
      projectId: requiredString(args, "projectId"),
      documentId: requiredString(args, "documentId"),
      expectedRevision: requiredPositiveInteger(args, "expectedRevision"),
      status,
    });
  }
  const planningKind = name === "save_story_contract" ? ["saveStoryContract", "contract"] as const : name === "save_story_system" ? ["saveStorySystem", "system"] as const : name === "save_book_outline" ? ["saveBookOutline", "outline"] as const : name === "save_stage_plan" ? ["saveStagePlan", "stage"] as const : name === "save_chapter_contract" ? ["saveChapterContract", "contract"] as const : null;
  if (planningKind) {
    if (!planning) throw new Error("当前 MCP companion 未配置 StoryPlanning 服务。");
    const [method, field] = planningKind; const input = { command: planningCommand(args, "external_agent"), projectId: requiredString(args, "projectId") };
    if (method === "saveStoryContract") return planning.saveStoryContract({ ...input, contract: requiredRecord(args, field) });
    if (method === "saveStorySystem") return planning.saveStorySystem({ ...input, system: requiredRecord(args, field) });
    if (method === "saveBookOutline") return planning.saveBookOutline({ ...input, outline: requiredRecord(args, field) });
    if (method === "saveStagePlan") return planning.saveStagePlan({ ...input, stage: requiredRecord(args, field) });
    return planning.saveChapterContract({ ...input, contract: requiredRecord(args, field) });
  }
  if (name === "create_creative_recipe") {
    if (!recipes) throw new Error("当前 MCP companion 未配置 CreativeRecipe 服务。");
    return recipes.create({ command: planningCommand(args, "external_agent"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  }
  if (name === "get_creative_recipe") {
    if (!recipes) throw new Error("当前 MCP companion 未配置 CreativeRecipe 服务。");
    return recipes.get({ projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  }
  if (name === "freeze_chapter_context_manifest") {
    if (!manifests) throw new Error("当前 MCP companion 未配置 ChapterContextManifest 服务。");
    return manifests.freeze({
      command: planningCommand(args, "external_agent"),
      projectId: requiredString(args, "projectId"),
      chapterId: requiredString(args, "chapterId"),
      manifestId: requiredString(args, "manifestId"),
      tokenBudget: requiredPositiveInteger(args, "tokenBudget"),
      reservedOutputTokens: requiredPositiveInteger(args, "reservedOutputTokens"),
    });
  }
  if (name === "get_chapter_context_manifest") {
    if (!manifests) throw new Error("当前 MCP companion 未配置 ChapterContextManifest 服务。");
    return manifests.get({ projectId: requiredString(args, "projectId"), manifestId: requiredString(args, "manifestId") });
  }
  if (name === "freeze_chapter_reader_manifest") {
    if (!readerManifests) throw new Error("当前 MCP companion 未配置 ChapterReaderManifest 服务。");
    const readerKind = requiredString(args, "readerKind");
    if (readerKind !== "immersive" && readerKind !== "low_patience" && readerKind !== "logic_sensitive") throw new Error("readerKind 非法。 ");
    return readerManifests.freeze({
      command: planningCommand(args, "external_agent"),
      projectId: requiredString(args, "projectId"),
      chapterId: requiredString(args, "chapterId"),
      draftDocumentId: requiredString(args, "draftDocumentId"),
      manifestId: requiredString(args, "manifestId"),
      readerKind,
      tokenBudget: requiredPositiveInteger(args, "tokenBudget"),
    });
  }
  if (name === "get_chapter_reader_manifest") {
    if (!readerManifests) throw new Error("当前 MCP companion 未配置 ChapterReaderManifest 服务。");
    return readerManifests.get({ projectId: requiredString(args, "projectId"), manifestId: requiredString(args, "manifestId") });
  }
  if (name === "start_chapter_reader") {
    if (!readers) throw new Error("当前 MCP companion 未配置 ChapterReader 服务。");
    const result = await readers.start({
      command: planningCommand(args, "external_agent"),
      taskId: requiredString(args, "taskId"),
      documentId: requiredString(args, "documentId"),
      reportId: requiredString(args, "reportId"),
      projectId: requiredString(args, "projectId"),
      chapterId: requiredString(args, "chapterId"),
      manifestId: requiredString(args, "manifestId"),
      title: requiredString(args, "title"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind === "accepted") void readers.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "resume_chapter_reader") {
    if (!readers) throw new Error("当前 MCP companion 未配置 ChapterReader 服务。");
    const taskId = requiredString(args, "taskId");
    void readers.run(taskId).catch(() => undefined);
    return readers.getTask(taskId);
  }
  if (name === "get_chapter_reader_feedback") {
    if (!readers) throw new Error("当前 MCP companion 未配置 ChapterReader 服务。");
    return readers.getReport({ documentId: requiredString(args, "documentId") });
  }
  if (name === "start_chapter_reviewer") {
    if (!reviewer) throw new Error("当前 MCP companion 未配置 ChapterReviewer 服务。");
    const readerManifestIds = requiredStringArray(args, "readerManifestIds");
    const readerFeedbackDocumentIds = requiredStringArray(args, "readerFeedbackDocumentIds");
    const result = await reviewer.start({
      command: planningCommand(args, "external_agent"),
      taskId: requiredString(args, "taskId"),
      projectId: requiredString(args, "projectId"),
      chapterId: requiredString(args, "chapterId"),
      draftDocumentId: requiredString(args, "draftDocumentId"),
      reviewId: requiredString(args, "reviewId"),
      readerManifestIds,
      readerFeedbackDocumentIds,
      title: requiredString(args, "title"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind === "accepted") void reviewer.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "resume_chapter_reviewer") {
    if (!reviewer) throw new Error("当前 MCP companion 未配置 ChapterReviewer 服务。");
    const taskId = requiredString(args, "taskId");
    void reviewer.run(taskId).catch(() => undefined);
    return reviewer.getTask(taskId);
  }
  if (name === "get_chapter_reviewer_review") {
    if (!reviewer) throw new Error("当前 MCP companion 未配置 ChapterReviewer 服务。");
    return reviewer.getReview({ projectId: requiredString(args, "projectId"), reviewId: requiredString(args, "reviewId") });
  }
  if (name === "submit_chapter_review") {
    if (!reviews) throw new Error("当前 MCP companion 未配置 ChapterReview 服务。");
    const readerManifestIds = requiredStringArray(args, "readerManifestIds");
    const readerFeedbackDocumentIds = requiredStringArray(args, "readerFeedbackDocumentIds");
    return reviews.submit({
      command: planningCommand(args, "external_agent"),
      projectId: requiredString(args, "projectId"),
      chapterId: requiredString(args, "chapterId"),
      draftDocumentId: requiredString(args, "draftDocumentId"),
      reviewId: requiredString(args, "reviewId"),
      readerManifestIds,
      readerFeedbackDocumentIds,
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (name === "get_chapter_review") {
    if (!reviews) throw new Error("当前 MCP companion 未配置 ChapterReview 服务。");
    return reviews.get({ projectId: requiredString(args, "projectId"), reviewId: requiredString(args, "reviewId") });
  }
  if (name === "create_chapter_editor_draft") {
    if (!editor) throw new Error("当前 MCP companion 未配置 ChapterEditor 服务。");
    const selectedIssueIds = args.selectedIssueIds;
    if (!Array.isArray(selectedIssueIds) || selectedIssueIds.some((item) => typeof item !== "string" || !item.trim())) throw new Error("selectedIssueIds 必须是字符串数组。 ");
    return editor.create({
      command: planningCommand(args, "external_agent"),
      projectId: requiredString(args, "projectId"),
      chapterId: requiredString(args, "chapterId"),
      documentId: requiredString(args, "documentId"),
      title: requiredString(args, "title"),
      sourceDraftDocumentId: requiredString(args, "sourceDraftDocumentId"),
      reviewId: requiredString(args, "reviewId"),
      selectedIssueIds: selectedIssueIds as string[],
      editedText: requiredString(args, "editedText"),
      rationale: requiredString(args, "rationale"),
    });
  }
  if (name === "get_chapter_editor_draft") {
    if (!editor) throw new Error("当前 MCP companion 未配置 ChapterEditor 服务。");
    return editor.getDraft(requiredString(args, "documentId"));
  }
  if (name === "start_chapter_editor") {
    if (!editorTasks) throw new Error("当前 MCP companion 未配置 ChapterEditorTask 服务。");
    const selectedIssueIds = requiredStringArray(args, "selectedIssueIds");
    const result = await editorTasks.start({
      command: planningCommand(args, "external_agent"),
      taskId: requiredString(args, "taskId"),
      projectId: requiredString(args, "projectId"),
      chapterId: requiredString(args, "chapterId"),
      title: requiredString(args, "title"),
      targetDocumentId: requiredString(args, "targetDocumentId"),
      sourceDraftDocumentId: requiredString(args, "sourceDraftDocumentId"),
      reviewId: requiredString(args, "reviewId"),
      selectedIssueIds,
      rationale: requiredString(args, "rationale"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind === "accepted") void editorTasks.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "resume_chapter_editor") {
    if (!editorTasks) throw new Error("当前 MCP companion 未配置 ChapterEditorTask 服务。");
    const taskId = requiredString(args, "taskId");
    void editorTasks.run(taskId).catch(() => undefined);
    return editorTasks.getTask(taskId);
  }
  if (name === "commit_chapter") {
    if (!production) throw new Error("当前 MCP companion 未配置 ChapterProductionCommit 服务。");
    return production.acceptDraft({
      command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), chapterOrdinal: requiredPositiveInteger(args, "chapterOrdinal"), productionCommitId: requiredString(args, "productionCommitId"), draftDocumentId: requiredString(args, "draftDocumentId"), chapterDelta: requiredRecord(args, "chapterDelta"), canonPatches: requiredRecords(args, "canonPatches") as unknown as CanonPatch[], characterKnowledgePatches: requiredRecords(args, "characterKnowledgePatches") as unknown as CharacterKnowledgePatch[], readerState: requiredRecord(args, "readerState") as { readerStateId: string; payload: Record<string, unknown> }, readerPromiseUpdates: requiredRecords(args, "readerPromiseUpdates") as unknown as ReaderPromisePatch[], outlineDrift: requiredRecord(args, "outlineDrift") as { payload: Record<string, unknown> },
    });
  }
  if (name === "get_accepted_chapter") {
    if (!production) throw new Error("当前 MCP companion 未配置 ChapterProductionCommit 服务。");
    return production.getAcceptedChapter({ projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  }
  if (name === "start_chapter_writer_v1") {
    if (!writer) throw new Error("当前 MCP companion 未配置 ChapterWriter 服务。");
    const result = await writer.start({ command: planningCommand(args, "external_agent"), taskId: requiredString(args, "taskId"), documentId: requiredString(args, "documentId"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), manifestId: requiredString(args, "manifestId"), title: requiredString(args, "title"), baseURL: configuredBaseURL(args), model: configuredModel(args), ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}) });
    if (result.kind === "accepted") void writer.run(result.taskId).catch(() => undefined);
    return result;
  }
  if (name === "resume_chapter_writer_v1") {
    if (!writer) throw new Error("当前 MCP companion 未配置 ChapterWriter 服务。");
    const taskId = requiredString(args, "taskId");
    void writer.run(taskId).catch(() => undefined);
    return writer.getTask(taskId);
  }
  if (name === "get_chapter_writer_draft") {
    if (!writer) throw new Error("当前 MCP companion 未配置 ChapterWriter 服务。");
    return writer.getDraft({ documentId: requiredString(args, "documentId") });
  }
  throw new Error(`未知 Ainovr tool：${name || "（空）"}`);
}

function planningCommand(args: Record<string, unknown>, kind: "external_agent" | "human_via_agent"): Omit<CommandEnvelope, "tool" | "args"> { return { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind, id: "mcp" }, createdAt: Date.now() }; }
function requiredRecord(args: Record<string, unknown>, key: string): Record<string, unknown> { const value = record(args[key]); if (!value) throw new Error(`${key} 必须是对象`); return value; }
function requiredRecords(args: Record<string, unknown>, key: string): Record<string, unknown>[] { const value = args[key]; if (!Array.isArray(value) || value.some((item) => !record(item))) throw new Error(`${key} 必须是对象数组`); return value as Record<string, unknown>[]; }
function requiredStringArray(args: Record<string, unknown>, key: string): string[] { const value = args[key]; if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${key} 必须是非空字符串数组。`); return [...value] as string[]; }

function unavailableTaskRunner(): never { throw new Error("当前 MCP companion 未配置 TaskRunner。"); }

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 必须是非空字符串`);
  return value;
}

function requiredNonNegativeInteger(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${key} 必须是非负整数`);
  return value as number;
}

function requiredByteRange(args: Record<string, unknown>, key: string): { startByte: number; endByte: number } {
  const value = record(args[key]);
  if (!value) throw new Error(`${key} 必须是对象`);
  const startByte = requiredNonNegativeInteger(value, "startByte");
  const endByte = requiredNonNegativeInteger(value, "endByte");
  if (endByte <= startByte) throw new Error(`${key}.endByte 必须大于 startByte`);
  return { startByte, endByte };
}

function requiredPositiveInteger(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${key} 必须是正整数`);
  return value as number;
}

function requiredIntegerInRange(args: Record<string, unknown>, key: string, minimum: number, maximum: number): number {
  const value = args[key];
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${key} 必须介于 ${minimum} 和 ${maximum}`);
  return value as number;
}

function requiredRatio(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) throw new Error(`${key} 必须在 [0, 1) 内`);
  return value;
}

function configuredBaseURL(args: Record<string, unknown>): string {
  const value = args.baseURL;
  return typeof value === "string" && value.trim() ? value.trim() : "http://configured-route.invalid/v1";
}

function configuredModel(args: Record<string, unknown>): string {
  const value = args.model;
  return typeof value === "string" && value.trim() ? value.trim() : "configured-route";
}

/** Pipeline config 是冻结的声明，不是任意工具参数。每个可执行宿主单独声明字段。 */
function pipelineConfig(value: Record<string, unknown> | undefined, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const config = record(value);
  if (!config) throw new Error("Pipeline 可执行步骤缺少结构化配置。 ");
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(config).some((key) => !allowed.has(key)) || required.some((key) => !(key in config))) throw new Error("Pipeline 步骤配置包含未允许字段或缺少必填字段。 ");
  return config;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function success(id: string | number | null, result: unknown): Record<string, unknown> { return { jsonrpc: "2.0", id, result }; }
function error(id: string | number | null, code: number, message: string): Record<string, unknown> { return { jsonrpc: "2.0", id, error: { code, message } }; }
