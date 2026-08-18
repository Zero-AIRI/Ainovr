import type { CommandService, CommandPlanner, PlannedCommand } from "@/application/command-service";
import { createCommandService } from "@/application/command-service";
import { objectReferenceFrom, parsePlannedFacts, toCommandFact } from "@/application/analysis-fact-service";
import { parsePlannedThreads, toCommandThread } from "@/application/thread-graph-service";
import { parseAnalysisBriefOutput } from "@/application/analysis-brief-service";
import { parsePlannedResearchConclusions, toCommandConclusion } from "@/application/research-conclusion-service";
import { parsePlannedIndependentFalsification, toCommandFalsification } from "@/application/independent-falsification-service";
import { parsePlannedMechanismPayload } from "@/application/mechanism-asset-service";
import { createMechanismAssetService, type MechanismReviewStatus } from "@/application/mechanism-asset-service";
import { createStoryPlanningService, type PlanningReviewStatus } from "@/application/story-planning-service";
import type { CommandEnvelope, CommandResult, DomainDiagnostic } from "@/application/command-types";
import { createNovelProjectRepository, type NovelProjectRecord } from "@/persistence/novel-project-repository";
import type { ObjectStore } from "@/persistence/object-store";
import type { PayloadSchemaRegistry } from "@/persistence/schema-registry";
import type { SqlDriver, TransactionStep } from "@/persistence/sql-driver";
import type { TaskRecord, TaskRunner } from "@/application/task-runner";
import { createPipelineRevisionService, type PipelineRevisionService } from "@/application/pipeline-revision-service";
import { PIPELINE_DOMAIN_TOOLS } from "@/application/pipeline-revision-service";
import { createPipelineRunService, type PipelineRunService } from "@/application/pipeline-run-service";

export interface WorkspaceQueryService {
  getNovelProject(projectId: string): Promise<NovelProjectRecord | null>;
  /** 供 UI、MCP 和 CLI 共用的原创项目当前 revision 投影。 */
  listNovelProjects(): Promise<NovelProjectRecord[]>;
  /**
   * 作品右侧工作台的受控真相投影。它只包含原创侧的短摘要、版本和生产游标，
   * 不返回正文、Prompt、对象路径或任何参考侧/provenance 信息。
   */
  getProjectWorkbench(projectId: string): Promise<ProjectWorkbenchView | null>;
  /** 仅返回当前文档的结构化索引；大文本继续留在 ObjectStore。 */
  listProjectDocuments(projectId: string): Promise<ProjectDocumentView[]>;
  /**
   * 受项目边界约束的当前文档读取。它只接受已登记的项目文档 ID，
   * 由 Application Service 通过 ObjectStore 解析内容；绝不提供对象路径或通用文件读取。
   */
  getProjectDocument(input: { projectId: string; documentId: string }): Promise<ProjectDocumentContentView | null>;
  /** 待审核的原创规划；正文或完整 Prompt 仍不会出现在待处理列表中。 */
  listPendingPlanningDocuments(): Promise<PendingPlanningDocumentView[]>;
  /** 待人类决定是否采纳的机制候选短投影；不返回 SourceSpan、原文或原始模型输出。 */
  listPendingMechanismAssets(): Promise<PendingMechanismAssetView[]>;
  /** 全工作区未 complete 的 Coverage 处置；供待处理页显示遗漏、弃权与失败的原因。 */
  listCoverageGaps(): Promise<CoverageGapView[]>;
  /** 队列、失败、暂停和确认等待任务的工作台投影。 */
  listActionableTasks(): Promise<ActionableTaskView[]>;
  /** 参考页只拿到 ReferenceWork 元数据；原文仍必须走受限 excerpt 服务。 */
  listReferenceWorks(): Promise<ReferenceWorkSummary[]>;
  /** 参考工作台的证据与 Coverage 索引；这里永远不返回参考原文对象内容。 */
  getReferenceWorkbench(referenceWorkId: string): Promise<ReferenceWorkbenchView | null>;
  /** 仅按已登记 EvidenceInstance 返回一个有上限的 SourceSpan 摘录；没有任意对象或路径读取入口。 */
  getEvidenceExcerpt(evidenceInstanceId: string): Promise<EvidenceExcerptView | null>;
  /** 设置页只拿非秘密 Provider 元数据和角色路由。 */
  listProviderProfiles(): Promise<ProviderProfileView[]>;
  /** 工作区范围的非秘密预算、DataPolicy 与自动化设置。 */
  getWorkspaceSettings(): Promise<WorkspaceSettingsView>;
  getWorkspaceStatus(): Promise<{ workspaceRevision: number; changeSeq: number; projectCount: number }>;
  getCapabilities(): Promise<{ protocolVersion: 1; controlPlane: "stdio"; supports: string[] }>;
  listChanges(after: number, limit?: number): Promise<ChangeView[]>;
  listPendingConfirmations(): Promise<Array<{ confirmationId: string; risk: string; expiresAt: number }>>;
  getConfirmation(confirmationId: string): Promise<ConfirmationView | null>;
}

export interface ProjectDocumentView {
  documentId: string;
  projectId: string;
  chapterId: string | null;
  documentType: string;
  status: string;
  revision: number;
  title: string;
  contentObjectHash: string | null;
  updatedAt: number;
}

export interface ProjectDocumentContentView extends ProjectDocumentView {
  /** 当前 revision 的小型结构化索引；正文与 Manifest 的原始内容仍由 content 承载。 */
  payload: Record<string, unknown>;
  /** 不含 contentObject 时为 null；内容只可能来自该项目文档的已登记对象引用。 */
  content: string | null;
}

export interface ProjectWorkbenchView {
  projectId: string;
  title: string;
  status: string;
  revision: number;
  chapters: ProjectChapterWorkbenchView[];
  canonEntries: CanonEntryWorkbenchView[];
  readerPromises: ReaderPromiseWorkbenchView[];
  /** 最后一个已正式提交章节；尚无正式章节时为 null。 */
  productionCursor: ProductionCursorWorkbenchView | null;
}

export interface ProjectChapterWorkbenchView {
  chapterId: string;
  ordinal: number;
  status: string;
  revision: number;
  acceptedDocumentId: string | null;
  acceptedDocumentRevision: number | null;
  acceptedTitle: string | null;
}

export interface CanonEntryWorkbenchView {
  canonEntryId: string;
  revision: number;
  status: string;
  summary: string | null;
  updatedAt: number;
}

export interface ReaderPromiseWorkbenchView {
  readerPromiseId: string;
  chapterId: string | null;
  status: string;
  revision: number;
  summary: string | null;
  updatedAt: number;
}

export interface ProductionCursorWorkbenchView {
  chapterId: string;
  ordinal: number;
  productionCommitId: string;
  acceptedDocumentId: string;
  acceptedDocumentRevision: number;
  nextChapterOrdinal: number;
}

export interface PendingPlanningDocumentView {
  projectId: string;
  projectTitle: string;
  documentId: string;
  documentType: string;
  title: string;
  revision: number;
  updatedAt: number;
}

export interface PendingMechanismAssetView {
  mechanismAssetId: string;
  analysisProjectId: string;
  revision: number;
  title: string;
  targetEffect: string | null;
  scope: string | null;
  targetLayers: string[];
  updatedAt: number;
}

export interface CoverageGapView {
  coverageEntryId: string;
  referenceWorkId: string;
  referenceTitle: string;
  analysisProjectId: string;
  analysisUnitId: string | null;
  module: string;
  status: string;
  reason: string;
  createdAt: number;
}

export interface ActionableTaskView {
  taskId: string;
  resourceKey: string;
  taskType: string;
  status: "queued" | "running" | "waiting_confirmation" | "paused" | "failed" | "cancel_requested";
  retryCount: number;
  updatedAt: number;
  leaseExpiresAt: number | null;
}

export interface ReferenceWorkSummary {
  referenceWorkId: string;
  title: string;
  status: string;
  revision: number;
  updatedAt: number;
}

export interface ReferenceWorkbenchView extends ReferenceWorkSummary {
  sourceEditions: Array<{ sourceEditionId: string; sourceHash: string; byteLength: number; tokenEstimate: number; encoding: string; createdAt: number }>;
  analyses: ReferenceAnalysisWorkbenchView[];
}

export interface ReferenceAnalysisWorkbenchView {
  analysisProjectId: string;
  status: string;
  revision: number;
  segmentationId: string | null;
  evidence: Array<{ evidenceInstanceId: string; spanId: string; sourceEditionId: string; sourceHash: string; exactTextHash: string; startByte: number; endByte: number; role: string; locator: Record<string, unknown> }>;
  coverageSummary: Array<{ status: string; count: number }>;
  /** 非 complete 条目均为需要用户解释、补充或明确接受的处置结果，最多返回 50 项。 */
  unresolvedCoverage: Array<{ coverageEntryId: string; analysisUnitId: string | null; module: string; status: string; reason: string }>;
  /** 已验证的分析索引，用于把事实、线程、结论、反证与机制显示为同一条可审计链。原始模型输出不在此投影。 */
  analysisItems: Array<{ analysisItemId: string; researchQuestionId: string | null; kind: string; epistemicStatus: string; payload: Record<string, unknown>; createdAt: number }>;
  researchQuestions: Array<{ researchQuestionId: string; ordinal: number; status: "pending_review" | "approved"; question: string; rationale: string; productionUse: string }>;
  mechanisms: Array<{ mechanismAssetId: string; status: string; revision: number; payload: Record<string, unknown>; updatedAt: number }>;
}

export interface EvidenceExcerptView {
  evidenceInstanceId: string;
  spanId: string;
  sourceEditionId: string;
  startByte: number;
  endByte: number;
  exactTextHash: string;
  text: string;
  truncated: boolean;
}

export interface ProviderProfileView {
  providerProfileId: string;
  name: string;
  baseURL: string;
  defaultModel: string;
  revision: number;
  routes: Array<{ role: string; model: string }>;
}

export interface WorkspaceSettingsView {
  revision: number;
  automationMode: "manual" | "supervised" | "autonomous";
  contextWindowTokens: number;
  maxOutputTokens: number;
  safetyMarginRatio: number;
  cloudEscalation: "never" | "complex_only" | "always";
}

const WORKSPACE_DATA_POLICY_ID = "workspace:default";
/** 仅禁止看起来像凭据本身的字段；`contextWindowTokens` 这类公开预算必须允许。 */
const SECRET_FIELD_PATTERN = /(?:api[_-]?key|secret|password|token)$/i;
const DEFAULT_WORKSPACE_SETTINGS: Omit<WorkspaceSettingsView, "revision"> = {
  automationMode: "supervised",
  contextWindowTokens: 32_768,
  maxOutputTokens: 4_096,
  safetyMarginRatio: 0.2,
  cloudEscalation: "complex_only",
};

export interface ChangeView {
  changeSeq: number;
  topic: string;
  resourceType: string;
  resourceId: string;
  revision: number | null;
  createdAt: number;
}

export interface ConfirmationView {
  confirmationId: string;
  commandId: string;
  tool: string;
  risk: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "conflict";
  expiresAt: number;
  reason: string | null;
  resolvedAt: number | null;
  /** 可供人工核对的受控目标摘要；绝不回显完整路径、Prompt 或秘密字段。 */
  targetSummary: string;
}

export interface WorkspaceApplicationService {
  commands: CommandService;
  pipelines: PipelineRevisionService;
  pipelineRuns: PipelineRunService;
  /** 桌面受信 sidecar 可执行冻结步骤；核心应用服务本身不解释 Pipeline JSON。 */
  pipelineActions: WorkspacePipelineActionService;
  /** 分析阶段的强类型 UI 动作；完整原始输出仍由受信 Node 宿主写入 ObjectStore。 */
  analysisActions: WorkspaceAnalysisActionService;
  /** 原创生产前置资产的强类型 UI 动作；核心宿主不解释 UI JSON。 */
  productionActions: WorkspaceProductionActionService;
  queries: WorkspaceQueryService;
  /** 任务写入的唯一 UI 入口；组件不接触 TaskRunner、SqlDriver 或任务表。 */
  taskActions: WorkspaceTaskActionService;
  /** 规划审核从待审核文档重新读取当前 revision，UI 不携带或篡改规划 payload。 */
  planningActions: WorkspacePlanningActionService;
  /** 机制采纳从当前候选重新读取完整领域事实，UI 只携带目标项目、CAS revision 和人工决定。 */
  mechanismActions: WorkspaceMechanismActionService;
}

export interface WorkspaceTaskActionService {
  get(taskId: string): Promise<TaskRecord | null>;
  wait(taskId: string, timeoutMs: number): Promise<TaskRecord>;
  requestCancel(taskId: string): Promise<TaskRecord>;
  retry(taskId: string): Promise<TaskRecord>;
}

export interface WorkspacePlanningActionService {
  reviewDocument(input: {
    command: Omit<CommandEnvelope, "tool" | "args">;
    projectId: string;
    documentId: string;
    expectedRevision: number;
    status: PlanningReviewStatus;
  }): Promise<CommandResult>;
}

export interface WorkspaceMechanismActionService {
  review(input: {
    command: Omit<CommandEnvelope, "tool" | "args"> & Required<Pick<CommandEnvelope, "projectId" | "expectedRevision">>;
    mechanismAssetId: string;
    status: MechanismReviewStatus;
  }): Promise<CommandResult>;
}

export interface WorkspacePipelineActionService {
  execute(input: { runId: string; stepId: string }): Promise<{ runId: string; stepId: string; taskId: string; command: CommandResult }>;
}

export interface WorkspaceProductionActionService {
  saveProjectIntent(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; intent: Record<string, unknown> }): Promise<CommandResult>;
  submitStoryConcepts(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; rawOutput: string }): Promise<CommandResult>;
  selectStoryConcept(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; conceptId: string }): Promise<CommandResult>;
  savePlanningDocument(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; kind: "story_contract" | "story_system" | "book_outline" | "stage_plan" | "chapter_contract"; payload: Record<string, unknown> }): Promise<CommandResult>;
  createCreativeRecipe(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string }): Promise<CommandResult>;
  freezeChapterContextManifest(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; manifestId: string; tokenBudget: number; reservedOutputTokens: number }): Promise<CommandResult>;
  freezeChapterReaderManifest(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; draftDocumentId: string; manifestId: string; readerKind: "immersive" | "low_patience" | "logic_sensitive"; tokenBudget: number }): Promise<CommandResult>;
  commitChapter(input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; chapterOrdinal: number; draftDocumentId: string; productionCommitId: string; chapterDelta: Record<string, unknown>; canonPatches: Record<string, unknown>[]; characterKnowledgePatches: Record<string, unknown>[]; readerState: Record<string, unknown>; readerPromiseUpdates: Record<string, unknown>[]; outlineDrift: Record<string, unknown> }): Promise<CommandResult>;
}

export interface WorkspaceAnalysisActionService {
  prepareCorpus(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; segmentationId: string; sourceEditionId: string; boundary: "complete" | "volume" | "fragment"; budget: { contextWindowTokens: number; safetyMarginRatio: number; reservedOutputTokens: number; renderedSystemPromptTokens: number; renderedSchemaTokens: number; envelopeTokens: number } }): Promise<CommandResult>;
  createStructuralReadingMap(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string }): Promise<CommandResult>;
  submitThreadGraph(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }): Promise<CommandResult>;
  submitAnalysisBrief(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }): Promise<CommandResult>;
  submitResearchConclusions(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; researchQuestionId: string; rawOutput: string }): Promise<CommandResult>;
  submitIndependentFalsification(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; conclusionId: string; rawOutput: string }): Promise<CommandResult>;
  createResearchDossier(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string }): Promise<CommandResult>;
  proposeMechanismCandidate(input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }): Promise<CommandResult>;
}

export interface CreateWorkspaceApplicationServiceOptions {
  driver: SqlDriver;
  schemas: PayloadSchemaRegistry;
  /** UI/CLI/MCP 的文档内容投影只需要读取能力，不向 QueryService 暴露任意路径。 */
  objects?: Pick<ObjectStore, "read">;
  /** 可选于纯 Query/Command 测试；桌面、MCP 与 CLI 运行时必须注入同一 TaskRunner。 */
  tasks?: Pick<TaskRunner, "requestCancel" | "retry" | "get" | "wait">;
  now?: () => number;
}

/**
 * R2 的最小应用服务组合根。新增领域命令必须先加入 planner，再公开给 MCP 或 UI；
 * 读侧只能从 QueryService 投影，不能直接读取 Zustand、JSON Store 或 SQL。
 */
export function createWorkspaceApplicationService(options: CreateWorkspaceApplicationServiceOptions): WorkspaceApplicationService {
  const now = options.now ?? Date.now;
  const projects = createNovelProjectRepository(options.driver, options.schemas, now);
  const planner = createWorkspacePlanner(options.schemas);
  const commands = createCommandService(options.driver, planner, now);
  // 桌面端只需要 reviewDocument；提案写入仍由 MCP/CLI 注入具备 put 权限的完整服务。
  const planning = createStoryPlanningService({ driver: options.driver, commands });
  // UI 只能审核既有候选；候选编译仍只在 MCP/CLI 的完整 MechanismAsset 服务中进行。
  const mechanisms = createMechanismAssetService({ driver: options.driver, commands });
  const pipelines = createPipelineRevisionService({ driver: options.driver, commands });
  const pipelineRuns = createPipelineRunService({ driver: options.driver, commands, pipelines });
  return {
    commands,
    pipelines,
    pipelineRuns,
    pipelineActions: {
      async execute() {
        throw new Error("当前 Application Service 未配置 Pipeline 执行宿主；请由 CLI、MCP 或桌面受信 sidecar 执行。 ");
      },
    },
    analysisActions: unavailableAnalysisActions(),
    productionActions: unavailableProductionActions(),
    taskActions: {
      async get(taskId) {
        assertNonEmptyId(taskId, "taskId");
        if (!options.tasks) throw new Error("当前宿主未配置 TaskRunner，无法读取任务。 ");
        return options.tasks.get(taskId);
      },
      async wait(taskId, timeoutMs) {
        assertNonEmptyId(taskId, "taskId");
        if (!options.tasks) throw new Error("当前宿主未配置 TaskRunner，无法等待任务。 ");
        return options.tasks.wait(taskId, timeoutMs);
      },
      async requestCancel(taskId) {
        assertNonEmptyId(taskId, "taskId");
        if (!options.tasks) throw new Error("当前宿主未配置 TaskRunner，无法请求取消任务。 ");
        await options.tasks.requestCancel(taskId);
        const task = await options.tasks.get(taskId);
        if (!task) throw new Error("任务取消后无法读取任务状态。 ");
        return task;
      },
      async retry(taskId) {
        assertNonEmptyId(taskId, "taskId");
        if (!options.tasks) throw new Error("当前宿主未配置 TaskRunner，无法重试任务。 ");
        await options.tasks.retry(taskId);
        const task = await options.tasks.get(taskId);
        if (!task) throw new Error("任务重试后无法读取任务状态。 ");
        return task;
      },
    },
    planningActions: {
      reviewDocument(input) {
        return planning.reviewDocument(input);
      },
    },
    mechanismActions: {
      review(input) {
        return mechanisms.review(input);
      },
    },
    queries: {
      getNovelProject(projectId) {
        return projects.get(projectId);
      },
      listNovelProjects() {
        return projects.list();
      },
      async getProjectWorkbench(projectId) {
        assertNonEmptyId(projectId, "projectId");
        const project = await projects.get(projectId);
        if (!project) return null;
        const [chapters, canonEntries, readerPromises, cursorRows] = await Promise.all([
          options.driver.query<{
            chapter_id: string; ordinal: number; status: string; current_revision: number;
            accepted_document_id: string | null; accepted_document_revision: number | null; accepted_payload_json: string | null;
          }>({
            sql: `SELECT chapter.chapter_id, chapter.ordinal, chapter.status, chapter.current_revision,
                         document.document_id AS accepted_document_id, artifact.current_revision AS accepted_document_revision,
                         revision.payload_json AS accepted_payload_json
                  FROM chapters chapter
                  LEFT JOIN project_documents document ON document.project_id = chapter.project_id
                    AND document.chapter_id = chapter.chapter_id
                    AND document.document_type = 'chapter_text'
                    AND document.status = 'accepted'
                  LEFT JOIN artifacts artifact ON artifact.artifact_id = document.artifact_id
                  LEFT JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id
                    AND revision.revision = artifact.current_revision
                  WHERE chapter.project_id = ?
                  ORDER BY chapter.ordinal ASC, chapter.chapter_id ASC`,
            params: [projectId],
          }),
          options.driver.query<{ canon_entry_id: string; payload_json: string; revision: number; status: string; updated_at: number }>({
            sql: `SELECT canon_entry_id, payload_json, revision, status, updated_at
                  FROM canon_entries
                  WHERE project_id = ?
                  ORDER BY updated_at DESC, canon_entry_id ASC
                  LIMIT 100`,
            params: [projectId],
          }),
          options.driver.query<{ reader_promise_id: string; chapter_id: string | null; payload_json: string; status: string; revision: number; updated_at: number }>({
            sql: `SELECT reader_promise_id, chapter_id, payload_json, status, revision, updated_at
                  FROM reader_promises
                  WHERE project_id = ?
                  ORDER BY updated_at DESC, reader_promise_id ASC
                  LIMIT 100`,
            params: [projectId],
          }),
          options.driver.query<{
            chapter_id: string; ordinal: number; production_commit_id: string;
            accepted_document_id: string; accepted_document_revision: number;
          }>({
            sql: `SELECT chapter.chapter_id, chapter.ordinal, production.production_commit_id,
                         production.accepted_document_id, artifact.current_revision AS accepted_document_revision
                  FROM production_commits production
                  INNER JOIN chapters chapter ON chapter.chapter_id = production.chapter_id
                  INNER JOIN project_documents document ON document.document_id = production.accepted_document_id
                    AND document.project_id = production.project_id
                  INNER JOIN artifacts artifact ON artifact.artifact_id = document.artifact_id
                  WHERE production.project_id = ?
                  ORDER BY chapter.ordinal DESC, production.created_at DESC, production.production_commit_id DESC
                  LIMIT 1`,
            params: [projectId],
          }),
        ]);
        const cursor = cursorRows[0];
        return {
          projectId: project.projectId,
          title: project.title,
          status: project.status,
          revision: project.revision,
          chapters: chapters.map((chapter) => {
            const payload = chapter.accepted_payload_json ? parseRecord(chapter.accepted_payload_json, "Accepted Chapter payload") : null;
            return {
              chapterId: chapter.chapter_id,
              ordinal: chapter.ordinal,
              status: chapter.status,
              revision: chapter.current_revision,
              acceptedDocumentId: chapter.accepted_document_id,
              acceptedDocumentRevision: chapter.accepted_document_revision,
              acceptedTitle: payload ? summaryFromWorkspacePayload(payload) : null,
            } satisfies ProjectChapterWorkbenchView;
          }),
          canonEntries: canonEntries.map((entry) => ({
            canonEntryId: entry.canon_entry_id,
            revision: entry.revision,
            status: entry.status,
            summary: summaryFromWorkspacePayload(parseRecord(entry.payload_json, "Canon payload")),
            updatedAt: entry.updated_at,
          } satisfies CanonEntryWorkbenchView)),
          readerPromises: readerPromises.map((promise) => ({
            readerPromiseId: promise.reader_promise_id,
            chapterId: promise.chapter_id,
            status: promise.status,
            revision: promise.revision,
            summary: summaryFromWorkspacePayload(parseRecord(promise.payload_json, "ReaderPromise payload")),
            updatedAt: promise.updated_at,
          } satisfies ReaderPromiseWorkbenchView)),
          productionCursor: cursor ? {
            chapterId: cursor.chapter_id,
            ordinal: cursor.ordinal,
            productionCommitId: cursor.production_commit_id,
            acceptedDocumentId: cursor.accepted_document_id,
            acceptedDocumentRevision: cursor.accepted_document_revision,
            nextChapterOrdinal: cursor.ordinal + 1,
          } satisfies ProductionCursorWorkbenchView : null,
        } satisfies ProjectWorkbenchView;
      },
      async listProjectDocuments(projectId) {
        if (!projectId.trim()) throw new Error("projectId 必须是非空字符串。 ");
        const rows = await options.driver.query<{
          document_id: string; project_id: string; chapter_id: string | null; document_type: string; status: string; current_revision: number;
          payload_json: string; content_object_hash: string | null; updated_at: number;
        }>({
          sql: `SELECT doc.document_id, doc.project_id, doc.chapter_id, doc.document_type, doc.status,
                       artifact.current_revision, revision.payload_json, revision.content_object_hash, doc.updated_at
                FROM project_documents doc
                INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
                INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
                WHERE doc.project_id = ?
                ORDER BY doc.updated_at DESC, doc.document_id ASC`,
          params: [projectId],
        });
        return rows.map((row) => {
          const payload = parseRecord(row.payload_json, "ProjectDocument payload");
          const payloadTitle = payload.title;
          return {
            documentId: row.document_id,
            projectId: row.project_id,
            chapterId: row.chapter_id,
            documentType: row.document_type,
            status: row.status,
            revision: row.current_revision,
            title: typeof payloadTitle === "string" && payloadTitle.trim() ? payloadTitle : row.document_id,
            contentObjectHash: row.content_object_hash,
            updatedAt: row.updated_at,
          };
        });
      },
      async getProjectDocument(input) {
        if (!input.projectId.trim()) throw new Error("projectId 必须是非空字符串。 ");
        if (!input.documentId.trim()) throw new Error("documentId 必须是非空字符串。 ");
        const rows = await options.driver.query<{
          document_id: string; project_id: string; chapter_id: string | null; document_type: string; status: string; current_revision: number;
          payload_json: string; content_object_hash: string | null; updated_at: number;
        }>({
          sql: `SELECT doc.document_id, doc.project_id, doc.chapter_id, doc.document_type, doc.status,
                       artifact.current_revision, revision.payload_json, revision.content_object_hash, doc.updated_at
                FROM project_documents doc
                INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
                INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
                WHERE doc.project_id = ? AND doc.document_id = ?`,
          params: [input.projectId, input.documentId],
        });
        const row = rows[0];
        if (!row) return null;
        const payload = parseRecord(row.payload_json, "ProjectDocument payload");
        const payloadTitle = payload.title;
        let content: string | null = null;
        if (row.content_object_hash) {
          if (!options.objects) throw new Error("当前宿主未配置受控 ObjectStore，无法读取文档内容。 ");
          content = new TextDecoder().decode(await options.objects.read(row.content_object_hash));
        }
        return {
          documentId: row.document_id,
          projectId: row.project_id,
          chapterId: row.chapter_id,
          documentType: row.document_type,
          status: row.status,
          revision: row.current_revision,
          title: typeof payloadTitle === "string" && payloadTitle.trim() ? payloadTitle : row.document_id,
          contentObjectHash: row.content_object_hash,
          updatedAt: row.updated_at,
          payload,
          content,
        };
      },
      async listPendingPlanningDocuments() {
        const rows = await options.driver.query<{
          project_id: string; project_title: string; document_id: string; document_type: string; current_revision: number; payload_json: string; updated_at: number;
        }>({
          sql: `SELECT doc.project_id, project.title AS project_title, doc.document_id, doc.document_type,
                       artifact.current_revision, revision.payload_json, doc.updated_at
                FROM project_documents doc
                INNER JOIN novel_projects project ON project.project_id = doc.project_id
                INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
                INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
                WHERE doc.status = 'pending_review'
                ORDER BY doc.updated_at DESC, doc.document_id ASC`,
          params: [],
        });
        return rows.map((row) => {
          const payload = parseRecord(row.payload_json, "Pending planning document payload");
          const title = typeof payload.title === "string" && payload.title.trim()
            ? payload.title
            : typeof payload.kind === "string" && payload.kind.trim()
              ? payload.kind
              : row.document_id;
          return {
            projectId: row.project_id,
            projectTitle: row.project_title,
            documentId: row.document_id,
            documentType: row.document_type,
            title,
            revision: row.current_revision,
            updatedAt: row.updated_at,
          } satisfies PendingPlanningDocumentView;
        });
      },
      async listPendingMechanismAssets() {
        const rows = await options.driver.query<{
          mechanism_asset_id: string; analysis_project_id: string; current_revision: number; payload_json: string; updated_at: number;
        }>({
          sql: `SELECT asset.mechanism_asset_id, asset.analysis_project_id, asset.current_revision, revision.payload_json, asset.updated_at
                FROM mechanism_assets asset
                INNER JOIN mechanism_asset_revisions revision ON revision.mechanism_asset_id = asset.mechanism_asset_id
                  AND revision.revision = asset.current_revision
                WHERE asset.status = 'candidate'
                ORDER BY asset.updated_at DESC, asset.mechanism_asset_id ASC
                LIMIT 100`,
          params: [],
        });
        return rows.flatMap((row) => {
          const payload = parseRecord(row.payload_json, "MechanismAsset payload");
          const card = recordFromUnknown(payload.card);
          if (!card || card.lifecycle !== "candidate" || card.adoption !== "pending") return [];
          const targetLayers = Array.isArray(card.targetLayers)
            ? card.targetLayers.filter((layer): layer is string => typeof layer === "string" && Boolean(layer.trim())).slice(0, 8)
            : [];
          return [{
            mechanismAssetId: row.mechanism_asset_id,
            analysisProjectId: row.analysis_project_id,
            revision: row.current_revision,
            title: summaryFromWorkspacePayload({ title: card.title }) ?? row.mechanism_asset_id,
            targetEffect: summaryFromWorkspacePayload({ summary: card.effectHypothesis }),
            scope: typeof card.scope === "string" && card.scope.trim() ? card.scope : null,
            targetLayers,
            updatedAt: row.updated_at,
          } satisfies PendingMechanismAssetView];
        });
      },
      async listCoverageGaps() {
        const rows = await options.driver.query<{
          coverage_entry_id: string; reference_work_id: string; reference_title: string; analysis_project_id: string;
          analysis_unit_id: string | null; module: string; status: string; reason: string; created_at: number;
        }>({
          sql: `SELECT coverage.coverage_entry_id, reference.reference_work_id, reference.title AS reference_title,
                       analysis.analysis_project_id, coverage.analysis_unit_id, coverage.module, coverage.status,
                       coverage.reason, coverage.created_at
                FROM coverage_entries coverage
                INNER JOIN analysis_projects analysis ON analysis.analysis_project_id = coverage.analysis_project_id
                INNER JOIN source_editions edition ON edition.source_edition_id = analysis.source_edition_id
                INNER JOIN reference_works reference ON reference.reference_work_id = edition.reference_work_id
                WHERE coverage.status <> 'complete'
                ORDER BY coverage.created_at DESC, coverage.coverage_entry_id ASC
                LIMIT 100`,
          params: [],
        });
        return rows.map((row) => ({
          coverageEntryId: row.coverage_entry_id,
          referenceWorkId: row.reference_work_id,
          referenceTitle: row.reference_title,
          analysisProjectId: row.analysis_project_id,
          analysisUnitId: row.analysis_unit_id,
          module: row.module,
          status: row.status,
          reason: row.reason,
          createdAt: row.created_at,
        } satisfies CoverageGapView));
      },
      async listActionableTasks() {
        const rows = await options.driver.query<{
          task_id: string; resource_key: string; task_type: string; status: ActionableTaskView["status"]; retry_count: number; updated_at: number; lease_expires_at: number | null;
        }>({
          sql: `SELECT task_id, resource_key, task_type, status, retry_count, updated_at, lease_expires_at
                FROM tasks
                WHERE status IN ('queued', 'running', 'waiting_confirmation', 'paused', 'failed', 'cancel_requested')
                ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'waiting_confirmation' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
                         updated_at DESC, task_id ASC`,
          params: [],
        });
        return rows.map((row) => ({
          taskId: row.task_id,
          resourceKey: row.resource_key,
          taskType: row.task_type,
          status: row.status,
          retryCount: row.retry_count,
          updatedAt: row.updated_at,
          leaseExpiresAt: row.lease_expires_at,
        }));
      },
      async listReferenceWorks() {
        const rows = await options.driver.query<{
          reference_work_id: string; title: string; status: string; current_revision: number; updated_at: number;
        }>({
          sql: `SELECT reference_work_id, title, status, current_revision, updated_at
                FROM reference_works
                ORDER BY updated_at DESC, reference_work_id ASC`,
          params: [],
        });
        return rows.map((row) => ({
          referenceWorkId: row.reference_work_id,
          title: row.title,
          status: row.status,
          revision: row.current_revision,
          updatedAt: row.updated_at,
        }));
      },
      async getReferenceWorkbench(referenceWorkId) {
        if (!referenceWorkId.trim()) throw new Error("referenceWorkId 必须是非空字符串。 ");
        const references = await options.driver.query<{ reference_work_id: string; title: string; status: string; current_revision: number; updated_at: number }>({
          sql: "SELECT reference_work_id, title, status, current_revision, updated_at FROM reference_works WHERE reference_work_id = ?",
          params: [referenceWorkId],
        });
        const reference = references[0];
        if (!reference) return null;
        const editions = await options.driver.query<{ source_edition_id: string; source_hash: string; byte_length: number; token_estimate: number; encoding: string; created_at: number }>({
          sql: "SELECT source_edition_id, source_hash, byte_length, token_estimate, encoding, created_at FROM source_editions WHERE reference_work_id = ? ORDER BY created_at ASC, source_edition_id ASC",
          params: [referenceWorkId],
        });
        const analysisRows = await options.driver.query<{ analysis_project_id: string; status: string; current_revision: number; segmentation_id: string | null }>({
          sql: `SELECT analysis.analysis_project_id, analysis.status, analysis.current_revision, analysis.segmentation_id
                FROM analysis_projects analysis
                INNER JOIN source_editions edition ON edition.source_edition_id = analysis.source_edition_id
                WHERE edition.reference_work_id = ?
                ORDER BY analysis.created_at ASC, analysis.analysis_project_id ASC`,
          params: [referenceWorkId],
        });
        const analyses = await Promise.all(analysisRows.map(async (analysis) => {
          const [evidence, coverageSummary, unresolvedCoverage, analysisItems, researchQuestions, mechanisms] = await Promise.all([
            options.driver.query<{
              evidence_instance_id: string; span_id: string; source_edition_id: string; source_hash: string; exact_text_hash: string; start_byte: number; end_byte: number; role: string; locator_json: string;
            }>({
              sql: `SELECT evidence.evidence_instance_id, span.span_id, span.source_edition_id, span.source_hash, span.exact_text_hash, span.start_byte, span.end_byte, evidence.role, span.locator_json
                    FROM evidence_instances evidence
                    INNER JOIN analysis_items item ON item.analysis_item_id = evidence.analysis_item_id
                    INNER JOIN source_spans span ON span.span_id = evidence.span_id
                    WHERE item.analysis_project_id = ?
                    ORDER BY evidence.created_at DESC, evidence.evidence_instance_id ASC LIMIT 50`,
              params: [analysis.analysis_project_id],
            }),
            options.driver.query<{ status: string; count: number }>({
              sql: "SELECT status, COUNT(*) AS count FROM coverage_entries WHERE analysis_project_id = ? GROUP BY status ORDER BY status ASC",
              params: [analysis.analysis_project_id],
            }),
            options.driver.query<{ coverage_entry_id: string; analysis_unit_id: string | null; module: string; status: string; reason: string }>({
              sql: `SELECT coverage_entry_id, analysis_unit_id, module, status, reason
                    FROM coverage_entries WHERE analysis_project_id = ? AND status <> 'complete'
                    ORDER BY created_at DESC, coverage_entry_id ASC LIMIT 50`,
              params: [analysis.analysis_project_id],
            }),
            options.driver.query<{ analysis_item_id: string; research_question_id: string | null; payload_json: string; epistemic_status: string; created_at: number }>(
              {
                sql: `SELECT analysis_item_id, research_question_id, payload_json, epistemic_status, created_at
                      FROM analysis_items WHERE analysis_project_id = ?
                      ORDER BY created_at ASC, analysis_item_id ASC LIMIT 100`,
                params: [analysis.analysis_project_id],
              },
            ),
            options.driver.query<{ research_question_id: string; ordinal: number; status: "pending_review" | "approved"; payload_json: string }>({
              sql: "SELECT research_question_id, ordinal, status, payload_json FROM research_questions WHERE analysis_project_id = ? ORDER BY ordinal ASC, research_question_id ASC",
              params: [analysis.analysis_project_id],
            }),
            options.driver.query<{ mechanism_asset_id: string; status: string; current_revision: number; payload_json: string; updated_at: number }>({
              sql: `SELECT asset.mechanism_asset_id, asset.status, asset.current_revision, revision.payload_json, asset.updated_at
                    FROM mechanism_assets asset
                    INNER JOIN mechanism_asset_revisions revision ON revision.mechanism_asset_id = asset.mechanism_asset_id AND revision.revision = asset.current_revision
                    WHERE asset.analysis_project_id = ?
                    ORDER BY asset.updated_at DESC, asset.mechanism_asset_id ASC LIMIT 50`,
              params: [analysis.analysis_project_id],
            }),
          ]);
          return {
            analysisProjectId: analysis.analysis_project_id,
            status: analysis.status,
            revision: analysis.current_revision,
            segmentationId: analysis.segmentation_id,
            evidence: evidence.map((entry) => ({
              evidenceInstanceId: entry.evidence_instance_id,
              spanId: entry.span_id,
              sourceEditionId: entry.source_edition_id,
              sourceHash: entry.source_hash,
              exactTextHash: entry.exact_text_hash,
              startByte: entry.start_byte,
              endByte: entry.end_byte,
              role: entry.role,
              locator: parseRecord(entry.locator_json, "SourceSpan locator"),
            })),
            coverageSummary: coverageSummary.map((entry) => ({ status: entry.status, count: entry.count })),
            unresolvedCoverage: unresolvedCoverage.map((entry) => ({ coverageEntryId: entry.coverage_entry_id, analysisUnitId: entry.analysis_unit_id, module: entry.module, status: entry.status, reason: entry.reason })),
            analysisItems: analysisItems.map((entry) => {
              const payload = parseRecord(entry.payload_json, "AnalysisItem payload");
              return { analysisItemId: entry.analysis_item_id, researchQuestionId: entry.research_question_id, kind: typeof payload.kind === "string" ? payload.kind : "unknown", epistemicStatus: entry.epistemic_status, payload, createdAt: entry.created_at };
            }),
            researchQuestions: researchQuestions.map((entry) => {
              const payload = parseRecord(entry.payload_json, "ResearchQuestion payload");
              const question = payload.question && typeof payload.question === "object" && !Array.isArray(payload.question) ? payload.question as Record<string, unknown> : {};
              if (typeof question.question !== "string" || typeof question.rationale !== "string" || typeof question.productionUse !== "string") throw new Error("ResearchQuestion payload 损坏。 ");
              return { researchQuestionId: entry.research_question_id, ordinal: entry.ordinal, status: entry.status, question: question.question, rationale: question.rationale, productionUse: question.productionUse };
            }),
            mechanisms: mechanisms.map((entry) => ({ mechanismAssetId: entry.mechanism_asset_id, status: entry.status, revision: entry.current_revision, payload: parseRecord(entry.payload_json, "MechanismAsset payload"), updatedAt: entry.updated_at })),
          } satisfies ReferenceAnalysisWorkbenchView;
        }));
        return {
          referenceWorkId: reference.reference_work_id,
          title: reference.title,
          status: reference.status,
          revision: reference.current_revision,
          updatedAt: reference.updated_at,
          sourceEditions: editions.map((edition) => ({ sourceEditionId: edition.source_edition_id, sourceHash: edition.source_hash, byteLength: edition.byte_length, tokenEstimate: edition.token_estimate, encoding: edition.encoding, createdAt: edition.created_at })),
          analyses,
        };
      },
      async getEvidenceExcerpt(evidenceInstanceId) {
        if (!evidenceInstanceId.trim()) throw new Error("evidenceInstanceId 必须是非空字符串。 ");
        if (!options.objects) throw new Error("当前宿主未配置受控 ObjectStore 读取，无法读取证据摘录。 ");
        const rows = await options.driver.query<{ evidence_instance_id: string; span_id: string; source_edition_id: string; start_byte: number; end_byte: number; exact_text_hash: string; normalized_object_hash: string }>(
          {
            sql: `SELECT evidence.evidence_instance_id, span.span_id, span.source_edition_id, span.start_byte, span.end_byte, span.exact_text_hash, edition.normalized_object_hash
                  FROM evidence_instances evidence
                  INNER JOIN source_spans span ON span.span_id = evidence.span_id
                  INNER JOIN source_editions edition ON edition.source_edition_id = span.source_edition_id
                  WHERE evidence.evidence_instance_id = ?`,
            params: [evidenceInstanceId],
          },
        );
        const row = rows[0];
        if (!row) return null;
        const bytes = await options.objects.read(row.normalized_object_hash);
        const maxBytes = 4096;
        const end = Math.min(row.end_byte, row.start_byte + maxBytes);
        return {
          evidenceInstanceId: row.evidence_instance_id,
          spanId: row.span_id,
          sourceEditionId: row.source_edition_id,
          startByte: row.start_byte,
          endByte: row.end_byte,
          exactTextHash: row.exact_text_hash,
          text: new TextDecoder("utf-8").decode(bytes.slice(row.start_byte, end)),
          truncated: end < row.end_byte,
        };
      },
      async listProviderProfiles() {
        const [profiles, routes] = await Promise.all([
          options.driver.query<{ provider_profile_id: string; name: string; base_url: string; default_model: string; current_revision: number }>({
            sql: "SELECT provider_profile_id, name, base_url, default_model, current_revision FROM provider_profiles ORDER BY name ASC, provider_profile_id ASC",
            params: [],
          }),
          options.driver.query<{ provider_profile_id: string; role: string; model: string }>({
            sql: "SELECT provider_profile_id, role, model FROM model_routes ORDER BY role ASC, route_id ASC",
            params: [],
          }),
        ]);
        return profiles.map((profile) => ({
          providerProfileId: profile.provider_profile_id,
          name: profile.name,
          baseURL: profile.base_url,
          defaultModel: profile.default_model,
          revision: profile.current_revision,
          routes: routes.filter((route) => route.provider_profile_id === profile.provider_profile_id).map((route) => ({ role: route.role, model: route.model })),
        }));
      },
      async getWorkspaceSettings() {
        const rows = await options.driver.query<{ payload_json: string; revision: number }>({
          sql: "SELECT payload_json, revision FROM data_policies WHERE policy_id = ? AND project_id IS NULL",
          params: [WORKSPACE_DATA_POLICY_ID],
        });
        const row = rows[0];
        if (!row) return { revision: 0, ...DEFAULT_WORKSPACE_SETTINGS };
        const settings = workspaceSettingsFromPayload(parseRecord(row.payload_json, "Workspace DataPolicy"));
        if (!settings) throw new Error("工作区 DataPolicy 损坏。 ");
        return { revision: row.revision, ...settings };
      },
      async getWorkspaceStatus() {
        const [projectsCount, latestChange] = await Promise.all([
          options.driver.query<{ count: number }>({ sql: "SELECT COUNT(*) AS count FROM novel_projects", params: [] }),
          options.driver.query<{ change_seq: number | null }>({ sql: "SELECT MAX(change_seq) AS change_seq FROM change_feed", params: [] }),
        ]);
        const changeSeq = latestChange[0]?.change_seq ?? 0;
        return { workspaceRevision: changeSeq, changeSeq, projectCount: projectsCount[0]?.count ?? 0 };
      },
      async getCapabilities() {
        return {
          protocolVersion: 1,
          controlPlane: "stdio",
          supports: ["command_envelope", "persistent_confirmation", "task_lease", "change_feed", "local_creation_draft"],
        };
      },
      async listChanges(after, limit = 100) {
        if (!Number.isInteger(after) || after < 0) throw new Error("after 必须是非负整数。");
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit 必须介于 1 和 100。 ");
        const rows = await options.driver.query<{
          change_seq: number; topic: string; resource_type: string; resource_id: string; revision: number | null; created_at: number;
        }>({
          sql: "SELECT change_seq, topic, resource_type, resource_id, revision, created_at FROM change_feed WHERE change_seq > ? ORDER BY change_seq ASC LIMIT ?",
          params: [after, limit],
        });
        return rows.map((row) => ({
          changeSeq: row.change_seq,
          topic: row.topic,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          revision: row.revision,
          createdAt: row.created_at,
        }));
      },
      async listPendingConfirmations() {
        const rows = await options.driver.query<{ confirmation_id: string; risk: string; expires_at: number }>({
          sql: "SELECT cf.confirmation_id, cf.risk, cf.expires_at, c.tool, c.args_json FROM confirmations cf INNER JOIN commands c ON c.command_id = cf.command_id WHERE cf.status = 'pending' ORDER BY cf.expires_at ASC, cf.confirmation_id ASC",
          params: [],
        });
        return rows.map((row) => ({ confirmationId: row.confirmation_id, risk: row.risk, expiresAt: row.expires_at }));
      },
      async getConfirmation(confirmationId) {
        const rows = await options.driver.query<{
          confirmation_id: string; command_id: string; tool: string; args_json: string; risk: string; status: ConfirmationView["status"]; expires_at: number; reason: string | null; resolved_at: number | null;
        }>({
          sql: `SELECT cf.confirmation_id, cf.command_id, c.tool, c.args_json, cf.risk, cf.status, cf.expires_at, cf.reason, cf.resolved_at
                FROM confirmations cf INNER JOIN commands c ON c.command_id = cf.command_id
                WHERE cf.confirmation_id = ?`,
          params: [confirmationId],
        });
        const row = rows[0];
        return row ? {
          confirmationId: row.confirmation_id,
          commandId: row.command_id,
          tool: row.tool,
          risk: row.risk,
          status: row.status,
          expiresAt: row.expires_at,
          reason: row.reason,
          resolvedAt: row.resolved_at,
          targetSummary: confirmationTargetSummary(row.tool, row.args_json),
        } : null;
      },
    },
  };
}

function confirmationTargetSummary(tool: string, argsJson: string): string {
  let args: Record<string, unknown> = {};
  try { const value: unknown = JSON.parse(argsJson); if (value && typeof value === "object" && !Array.isArray(value)) args = value as Record<string, unknown>; } catch { return `命令：${tool}`; }
  const projectId = typeof args.projectId === "string" ? args.projectId : null;
  const chapterId = typeof args.chapterId === "string" ? args.chapterId : null;
  const referenceWorkId = typeof args.referenceWorkId === "string" ? args.referenceWorkId : null;
  const sourceParts = typeof args.sourcePath === "string" ? args.sourcePath.replace(/\\/g, "/").split("/").filter(Boolean) : [];
  const sourcePath = sourceParts.length > 0 ? sourceParts[sourceParts.length - 1] : null;
  return [
    `命令：${tool}`,
    projectId ? `作品：${projectId}` : null,
    chapterId ? `章节：${chapterId}` : null,
    referenceWorkId ? `参考：${referenceWorkId}` : null,
    sourcePath ? `文件：${sourcePath}` : null,
  ].filter((value): value is string => value !== null).join(" · ");
}

function assertNonEmptyId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} 必须是非空字符串。 `);
}

function createWorkspacePlanner(schemas: PayloadSchemaRegistry): CommandPlanner {
  return {
    plan(command: CommandEnvelope, context): PlannedCommand {
      if (command.tool === "start_local_creation") return planStartLocalCreation(command);
      if (command.tool === "start_workspace_backup") return planStartWorkspaceMaintenance(command, "workspace_backup");
      if (command.tool === "start_workspace_restore") {
        if (!context.confirmed) return { kind: "needs_confirmation", risk: "workspace_restore", expiresAt: command.createdAt + 24 * 60 * 60 * 1000 };
        return planStartWorkspaceMaintenance(command, "workspace_restore");
      }
      if (command.tool === "complete_workspace_maintenance") return planCompleteWorkspaceMaintenance(command);
      if (command.tool === "start_workspace_export") return planStartWorkspaceExport(command);
      if (command.tool === "complete_workspace_export") return planCompleteWorkspaceExport(command);
      if (command.tool === "start_reference_file_import") {
        if (!context.confirmed) return { kind: "needs_confirmation", risk: "reference_file_import", expiresAt: command.createdAt + 24 * 60 * 60 * 1000 };
        return planStartReferenceFileImport(command);
      }
      if (command.tool === "save_provider_profile") return planSaveProviderProfile(command, schemas);
      if (command.tool === "save_workspace_settings") return planSaveWorkspaceSettings(command, schemas);
      if (command.tool === "commit_pipeline_revision") return planCommitPipelineRevision(command);
      if (command.tool === "start_pipeline_run") return planStartPipelineRun(command);
      if (command.tool === "complete_pipeline_run_step") return planCompletePipelineRunStep(command);
      if (command.tool === "start_local_fact_extraction") return planStartLocalFactExtraction(command);
      if (command.tool === "start_local_fact_extraction_batch") return planStartLocalFactExtractionBatch(command);
      if (command.tool === "complete_local_fact_extraction_batch") return planCompleteLocalFactExtractionBatch(command);
      if (command.tool === "reconfigure_local_fact_extraction") return planReconfigureLocalFactExtraction(command);
      if (command.tool === "commit_local_creation_draft") return planCommitLocalCreationDraft(command, schemas);
      if (command.tool === "import_reference_text") return planImportReferenceText(command);
      if (command.tool === "create_analysis_corpus") return planCreateAnalysisCorpus(command);
      if (command.tool === "commit_analysis_facts") return planCommitAnalysisFacts(command, schemas);
      if (command.tool === "commit_thread_graph") return planCommitThreadGraph(command, schemas);
      if (command.tool === "commit_analysis_brief") return planCommitAnalysisBrief(command);
      if (command.tool === "approve_analysis_brief") return planApproveAnalysisBrief(command);
      if (command.tool === "commit_research_conclusions") return planCommitResearchConclusions(command, schemas);
      if (command.tool === "commit_independent_falsification") return planCommitIndependentFalsification(command, schemas);
      if (command.tool === "commit_research_dossier") return planCommitResearchDossier(command);
      if (command.tool === "commit_mechanism_candidate") return planCommitMechanismCandidate(command, schemas);
      if (command.tool === "review_mechanism_asset") {
        if (command.actor.kind === "human_via_agent" && !context.confirmed) return { kind: "needs_confirmation", risk: "mechanism_adoption", expiresAt: command.createdAt + 24 * 60 * 60 * 1000 };
        return planReviewMechanismAsset(command, schemas);
      }
      if (command.tool === "commit_chapter_production") {
        if (command.actor.kind === "human_via_agent" && !context.confirmed) return { kind: "needs_confirmation", risk: "chapter_production_commit", expiresAt: command.createdAt + 24 * 60 * 60 * 1000 };
        return planCommitChapterProduction(command, schemas);
      }
      if (command.tool === "commit_project_planning_document") {
        const payload = recordArg(command.args, "payload");
        if (command.actor.kind === "human_via_agent" && !context.confirmed) {
          if (payload?.kind === "story_concept_selection") {
            return { kind: "needs_confirmation", risk: "story_concept_selection", expiresAt: command.createdAt + 24 * 60 * 60 * 1000 };
          }
          if ((command.args.status === "approved" || command.args.status === "rejected") && isReviewablePlanningKind(payload?.kind)) {
            return { kind: "needs_confirmation", risk: "planning_document_review", expiresAt: command.createdAt + 24 * 60 * 60 * 1000 };
          }
        }
        return planCommitProjectPlanningDocument(command, schemas);
      }
      if (command.tool === "fail_local_fact_extraction") return planFailLocalFactExtraction(command);
      if (command.tool === "commit_structural_reading_map") return planCommitStructuralReadingMap(command, schemas);
      if (command.tool !== "create_novel_project") return { kind: "blocked", diagnostics: [{ code: "unsupported_tool", message: `暂不支持命令：${command.tool}` }] };
      const projectId = stringArg(command.args, "projectId");
      const title = stringArg(command.args, "title");
      const status = stringArg(command.args, "status");
      const payload = recordArg(command.args, "payload");
      if (!projectId || !title || !status || !payload) {
        return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "create_novel_project 需要 projectId、title、status 和 payload。" }] };
      }
      const validation = schemas.validate("novel_project", payload);
      if (!validation.ok) return { kind: "blocked", diagnostics: validation.diagnostics };

      const artifactId = `project:${projectId}`;
      return {
        kind: "plan",
        steps: [
          {
            sql: "INSERT INTO novel_projects (project_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            params: [projectId, title, status, 1, command.createdAt, command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params: [artifactId, projectId, "novel_project", 1, status, command.createdAt, command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
          {
            sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params: [artifactId, 1, null, JSON.stringify(payload), null, JSON.stringify(command.actor), command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
        ],
        result: { kind: "ok", revision: 1, resourceRefs: [{ type: "novel_project", id: projectId }] },
        changes: [{ topic: "projects", resourceType: "novel_project", resourceId: projectId, revision: 1 }],
      };
    },
  };
}

function isReviewablePlanningKind(kind: unknown): boolean {
  return typeof kind === "string" && ["story_concepts", "story_contract", "story_system", "book_outline", "stage_plan", "chapter_contract"].includes(kind);
}

function planCommitPipelineRevision(command: CommandEnvelope): PlannedCommand {
  const pipelineId = stringArg(command.args, "pipelineId");
  const name = stringArg(command.args, "name");
  const status = stringArg(command.args, "status") ?? "draft";
  const steps = Array.isArray(command.args.steps) ? command.args.steps : null;
  const expected = command.args.expectedRevision;
  if (!pipelineId || !name || !steps || steps.length === 0 || steps.length > 32 || (expected !== null && expected !== undefined && (!Number.isInteger(expected) || Number(expected) < 1))) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "PipelineRevision 参数非法。" }] };
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "PipelineRevision 步骤必须是对象。" }] };
    const value = step as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const tool = typeof value.tool === "string" ? value.tool.trim() : "";
    if (!id || !tool || ids.has(id) || !PIPELINE_DOMAIN_TOOLS.has(tool) || containsSecretField(value.config)) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "PipelineRevision 包含重复、空、Secret、未登记或越权步骤。" }] };
    ids.add(id);
  }
  const expectedRevision = expected === null || expected === undefined ? null : Number(expected);
  const revision = expectedRevision === null ? 1 : expectedRevision + 1;
  const payload = { schema_version: 1, kind: "pipeline_revision", steps };
  const create = expectedRevision === null;
  const stepsSql: TransactionStep[] = create ? [
    { sql: "INSERT INTO pipelines (pipeline_id, name, current_revision, status, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)", params: [pipelineId, name, status, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO pipeline_revisions (pipeline_id, revision, parent_revision, payload_json, actor_json, created_at) VALUES (?, 1, NULL, ?, ?, ?)", params: [pipelineId, JSON.stringify(payload), JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
  ] : [
    { sql: "UPDATE pipelines SET name = ?, current_revision = ?, status = ?, updated_at = ? WHERE pipeline_id = ? AND current_revision = ?", params: [name, revision, status, command.createdAt, pipelineId, expectedRevision!], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO pipeline_revisions (pipeline_id, revision, parent_revision, payload_json, actor_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", params: [pipelineId, revision, expectedRevision!, JSON.stringify(payload), JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
  ];
  return { kind: "plan", steps: stepsSql, result: { kind: "ok", revision, resourceRefs: [{ type: "pipeline", id: pipelineId }] }, changes: [{ topic: "pipelines", resourceType: "pipeline", resourceId: pipelineId, revision }], ...(create ? {} : { conflict: { expectedRevision: expectedRevision!, currentRevisionStatement: { sql: "SELECT current_revision FROM pipelines WHERE pipeline_id = ?", params: [pipelineId] }, resourceType: "pipeline", resourceId: pipelineId, message: "PipelineRevision 已被其他写入更新。" } }) };
}

function planStartPipelineRun(command: CommandEnvelope): PlannedCommand {
  const runId = stringArg(command.args, "runId");
  const pipelineId = stringArg(command.args, "pipelineId");
  const pipelineRevision = command.args.pipelineRevision;
  const projectId = command.args.projectId === null || command.args.projectId === undefined ? null : stringArg(command.args, "projectId");
  const steps = Array.isArray(command.args.steps) ? command.args.steps : null;
  if (!runId || !pipelineId || !Number.isInteger(pipelineRevision) || Number(pipelineRevision) < 1 || !steps || steps.length === 0 || steps.length > 32 || (projectId === undefined)) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "PipelineRun 参数非法。" }] };
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "PipelineRun 步骤必须是对象。" }] };
    const value = step as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const tool = typeof value.tool === "string" ? value.tool.trim() : "";
    if (!id || !tool || typeof value.enabled !== "boolean" || ids.has(id) || !PIPELINE_DOMAIN_TOOLS.has(tool) || containsSecretField(value.config)) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "PipelineRun 含非法、Secret、未登记或越权步骤。" }] };
    ids.add(id);
  }
  const revision = Number(pipelineRevision);
  const snapshotId = `pipeline_snapshot:${runId}`;
  const payload = JSON.stringify({ schema_version: 1, kind: "pipeline_run_snapshot", steps });
  const nodeSteps: TransactionStep[] = steps.map((step) => {
    const value = step as Record<string, unknown>;
    const nodeId = String(value.id).trim();
    const enabled = value.enabled === true;
    return { sql: "INSERT INTO run_nodes (run_id, node_id, status, output_object_hash, checkpoint_json, started_at, completed_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?)", params: [runId, nodeId, enabled ? "pending" : "skipped", enabled ? null : command.createdAt], expectAffectedRows: { min: 1, max: 1 } };
  });
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO run_snapshots (snapshot_id, pipeline_id, pipeline_revision, payload_json, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pipeline_revisions WHERE pipeline_id = ? AND revision = ?) AND EXISTS (SELECT 1 FROM pipelines WHERE pipeline_id = ? AND current_revision = ?)", params: [snapshotId, pipelineId, revision, payload, command.createdAt, pipelineId, revision, pipelineId, revision], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO runs (run_id, snapshot_id, project_id, status, task_id, created_at, updated_at) VALUES (?, ?, ?, 'waiting_human', NULL, ?, ?)", params: [runId, snapshotId, projectId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
      ...nodeSteps,
      { sql: "INSERT INTO run_events (event_id, run_id, node_id, event_type, payload_json, created_at) VALUES (?, ?, NULL, 'started', ?, ?)", params: [`pipeline_run_started:${runId}`, runId, JSON.stringify({ schema_version: 1, pipelineId, pipelineRevision: revision }), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ],
    result: { kind: "ok", resourceRefs: [{ type: "pipeline_run", id: runId }] },
    changes: [{ topic: "pipeline_runs", resourceType: "pipeline_run", resourceId: runId }],
  };
}

function planCompletePipelineRunStep(command: CommandEnvelope): PlannedCommand {
  const runId = stringArg(command.args, "runId");
  const stepId = stringArg(command.args, "stepId");
  const note = stringArg(command.args, "note");
  if (!runId || !stepId || !note || note.length > 2_000 || (command.actor.kind !== "human" && command.actor.kind !== "human_via_agent")) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "PipelineRun 步骤复核参数或批准者非法。" }] };
  const checkpoint = JSON.stringify({ schema_version: 1, kind: "human_review", note, actor: command.actor, completedAt: command.createdAt });
  return {
    kind: "plan",
    steps: [
      { sql: "UPDATE run_nodes SET status = 'completed', checkpoint_json = ?, completed_at = ? WHERE run_id = ? AND node_id = ? AND status = 'pending'", params: [checkpoint, command.createdAt, runId, stepId], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "UPDATE runs SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM run_nodes WHERE run_id = ? AND status = 'pending') THEN 'completed' ELSE 'waiting_human' END, updated_at = ? WHERE run_id = ? AND status = 'waiting_human'", params: [runId, command.createdAt, runId], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO run_events (event_id, run_id, node_id, event_type, payload_json, created_at) VALUES (?, ?, ?, 'human_step_completed', ?, ?)", params: [`pipeline_run_step:${command.commandId}`, runId, stepId, checkpoint, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ],
    result: { kind: "ok", resourceRefs: [{ type: "pipeline_run", id: runId }] },
    changes: [{ topic: "pipeline_runs", resourceType: "pipeline_run", resourceId: runId }],
  };
}

function containsSecretField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => SECRET_FIELD_PATTERN.test(key) || containsSecretField(nested));
}

function planSaveProviderProfile(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  if (Object.keys(command.args).some((key) => SECRET_FIELD_PATTERN.test(key))) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "Provider 配置命令不得携带 API Key 或 Secret 字段。" }] };
  const providerProfileId = stringArg(command.args, "providerProfileId");
  const name = stringArg(command.args, "name");
  const baseURL = stringArg(command.args, "baseURL");
  const defaultModel = stringArg(command.args, "defaultModel");
  const routes = providerRoutes(command.args.routes);
  if (!providerProfileId || !name || !baseURL || !defaultModel || !routes) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "save_provider_profile 需要合法的非秘密 Provider 字段与角色路由。" }] };
  if (!validProviderURL(baseURL)) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "Provider baseURL 必须是 http(s) URL；DeepSeek 地址必须包含 /v1。" }] };
  const payload = { schema_version: 1, kind: "provider_profile", name, baseURL, defaultModel, routes };
  if (!schemas.validate("provider_profile", payload).ok) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "Provider profile payload schema 无效。" }] };
  const artifactId = `settings:provider:${providerProfileId}`;
  const create = command.expectedRevision === undefined || command.expectedRevision === null;
  if (!create && (!Number.isInteger(command.expectedRevision) || command.expectedRevision! < 1)) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "更新 Provider 必须带正整数 expectedRevision。" }] };
  const revision = create ? 1 : command.expectedRevision! + 1;
  const routeSteps = routes.map((route) => ({ sql: "INSERT INTO model_routes (route_id, role, provider_profile_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", params: [`route:${providerProfileId}:${route.role}`, route.role, providerProfileId, route.model, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } }));
  const steps = create ? [
    { sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, NULL, 'provider_profile', 1, 'active', ?, ?)", params: [artifactId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO provider_profiles (provider_profile_id, name, base_url, default_model, payload_json, created_at, updated_at, artifact_id, current_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)", params: [providerProfileId, name, baseURL, defaultModel, JSON.stringify(payload), command.createdAt, command.createdAt, artifactId], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 1, NULL, ?, NULL, ?, ?)", params: [artifactId, JSON.stringify(payload), JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ...routeSteps,
  ] : [
    { sql: "UPDATE provider_profiles SET name = ?, base_url = ?, default_model = ?, payload_json = ?, current_revision = ?, updated_at = ? WHERE provider_profile_id = ? AND current_revision = ?", params: [name, baseURL, defaultModel, JSON.stringify(payload), revision, command.createdAt, providerProfileId, command.expectedRevision!], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "UPDATE artifacts SET current_revision = ?, updated_at = ? WHERE artifact_id = ? AND current_revision = ?", params: [revision, command.createdAt, artifactId, command.expectedRevision!], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)", params: [artifactId, revision, command.expectedRevision!, JSON.stringify(payload), JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "DELETE FROM model_routes WHERE provider_profile_id = ?", params: [providerProfileId] },
    ...routeSteps,
  ];
  return {
    kind: "plan",
    steps,
    result: { kind: "ok", revision, resourceRefs: [{ type: "provider_profile", id: providerProfileId }] },
    changes: [{ topic: "settings", resourceType: "provider_profile", resourceId: providerProfileId, revision }],
    ...(create ? {} : {
      conflict: {
        expectedRevision: command.expectedRevision!,
        currentRevisionStatement: { sql: "SELECT current_revision FROM provider_profiles WHERE provider_profile_id = ?", params: [providerProfileId] },
        resourceType: "provider_profile",
        resourceId: providerProfileId,
        message: "Provider 配置已被其他写入更新，请比较当前版本后重试。",
      },
    }),
  };
}

function providerRoutes(value: unknown): Array<{ role: string; model: string }> | null {
  if (!Array.isArray(value) || value.some((item) => !recordArg({ item }, "item"))) return null;
  const routes = value.map((item) => item as Record<string, unknown>).map((item) => ({ role: typeof item.role === "string" ? item.role.trim() : "", model: typeof item.model === "string" ? item.model.trim() : "" }));
  return routes.every((route) => route.role && route.model) && new Set(routes.map((route) => route.role)).size === routes.length ? routes.sort((left, right) => left.role.localeCompare(right.role)) : null;
}

function validProviderURL(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password || url.search || url.hash) return false;
    return !/deepseek/i.test(url.hostname) || /\/v1\/?$/.test(url.pathname);
  } catch { return false; }
}

/** 工作区设置始终是非秘密、可由所有宿主读取的路由/预算策略。 */
function planSaveWorkspaceSettings(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  if (Object.keys(command.args).some((key) => SECRET_FIELD_PATTERN.test(key))) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "工作区设置命令不得携带 API Key 或 Secret 字段。" }] };
  const settings = workspaceSettingsFromPayload({ schema_version: 1, kind: "data_policy", ...command.args });
  if (!settings || !schemas.validate("data_policy", { schema_version: 1, kind: "data_policy", scope: "workspace", ...settings }).ok) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "DataPolicy、上下文/输出预算或自动化模式无效。" }] };
  }
  const create = command.expectedRevision === undefined || command.expectedRevision === null;
  if (!create && (!Number.isInteger(command.expectedRevision) || command.expectedRevision! < 1)) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "更新工作区设置必须带正整数 expectedRevision。" }] };
  const revision = create ? 1 : command.expectedRevision! + 1;
  const artifactId = `settings:data-policy:${WORKSPACE_DATA_POLICY_ID}`;
  const payload = { schema_version: 1, kind: "data_policy", scope: "workspace", ...settings };
  const steps = create ? [
    { sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, NULL, 'data_policy', 1, 'active', ?, ?)", params: [artifactId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO data_policies (policy_id, project_id, payload_json, revision, created_at, updated_at, artifact_id) VALUES (?, NULL, ?, 1, ?, ?, ?)", params: [WORKSPACE_DATA_POLICY_ID, JSON.stringify(payload), command.createdAt, command.createdAt, artifactId], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 1, NULL, ?, NULL, ?, ?)", params: [artifactId, JSON.stringify(payload), JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
  ] : [
    { sql: "UPDATE data_policies SET payload_json = ?, revision = ?, updated_at = ? WHERE policy_id = ? AND project_id IS NULL AND revision = ?", params: [JSON.stringify(payload), revision, command.createdAt, WORKSPACE_DATA_POLICY_ID, command.expectedRevision!], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "UPDATE artifacts SET current_revision = ?, updated_at = ? WHERE artifact_id = ? AND current_revision = ?", params: [revision, command.createdAt, artifactId, command.expectedRevision!], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)", params: [artifactId, revision, command.expectedRevision!, JSON.stringify(payload), JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
  ];
  return {
    kind: "plan",
    steps,
    result: { kind: "ok", revision, resourceRefs: [{ type: "data_policy", id: WORKSPACE_DATA_POLICY_ID }] },
    changes: [{ topic: "settings", resourceType: "data_policy", resourceId: WORKSPACE_DATA_POLICY_ID, revision }],
    ...(create ? {} : {
      conflict: {
        expectedRevision: command.expectedRevision!,
        currentRevisionStatement: { sql: "SELECT revision AS current_revision FROM data_policies WHERE policy_id = ? AND project_id IS NULL", params: [WORKSPACE_DATA_POLICY_ID] },
        resourceType: "data_policy",
        resourceId: WORKSPACE_DATA_POLICY_ID,
        message: "工作区设置已被其他写入更新，请比较当前版本后重试。",
      },
    }),
  };
}

function workspaceSettingsFromPayload(payload: Record<string, unknown>): Omit<WorkspaceSettingsView, "revision"> | null {
  const automationMode = payload.automationMode;
  const cloudEscalation = payload.cloudEscalation;
  const contextWindowTokens = payload.contextWindowTokens;
  const maxOutputTokens = payload.maxOutputTokens;
  const safetyMarginRatio = payload.safetyMarginRatio;
  if (payload.schema_version !== 1 || payload.kind !== "data_policy"
    || (automationMode !== "manual" && automationMode !== "supervised" && automationMode !== "autonomous")
    || (cloudEscalation !== "never" && cloudEscalation !== "complex_only" && cloudEscalation !== "always")
    || !Number.isInteger(contextWindowTokens) || (contextWindowTokens as number) < 1024 || (contextWindowTokens as number) > 1_000_000
    || !Number.isInteger(maxOutputTokens) || (maxOutputTokens as number) < 256 || (maxOutputTokens as number) >= (contextWindowTokens as number)
    || typeof safetyMarginRatio !== "number" || safetyMarginRatio < 0 || safetyMarginRatio >= 1) return null;
  return { automationMode, contextWindowTokens: contextWindowTokens as number, maxOutputTokens: maxOutputTokens as number, safetyMarginRatio, cloudEscalation };
}

function planCommitAnalysisFacts(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const analysisUnitId = stringArg(command.args, "analysisUnitId");
  const rawOutput = objectReferenceFrom(command.args.rawOutput);
  const rawFacts = command.args.facts;
  const task = parseTaskLease(command.args.task);
  const allowedSpanIds = collectEvidenceSpanIds(rawFacts);
  const facts = allowedSpanIds ? parsePlannedFacts(rawFacts, allowedSpanIds) : null;
  if (!analysisProjectId || !analysisUnitId || !rawOutput || !facts) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_analysis_facts 缺少合法的分析项目、计算单元、原始对象或事实列表。" }] };
  }
  const storedFacts = facts.map((fact) => ({ schema_version: 1, kind: "fact_ledger_entry", analysisUnitId, fact: toCommandFact(fact) }));
  if (storedFacts.some((payload) => !schemas.validate("analysis_item", payload).ok)) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "FactLedger payload schema 无效。" }] };
  }
  // Coverage 的公开状态固定使用统一枚举；具体计算处置留在 reason，避免 UI/MCP
  // 既要认识 complete/no_pattern 又要额外解释内部 used/analyzed_no_signal。
  const coverageStatus = facts.length === 0 ? "no_pattern" : "complete";
  const coverageReason = facts.length === 0 ? "analyzed_no_signal" : "used";
  const taskSteps = task ? completeTaskSteps(task, rawOutput.sha256, command.createdAt) : [];
  return {
    kind: "plan",
    steps: [
      {
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [rawOutput.sha256, rawOutput.byteLength, rawOutput.mediaType, command.createdAt, command.createdAt],
      },
      ...facts.flatMap((fact, factIndex) => {
        const analysisItemId = `${analysisUnitId}:fact:${fact.id}`;
        return [
          {
            sql: "INSERT INTO analysis_items (analysis_item_id, analysis_project_id, research_question_id, payload_json, epistemic_status, created_at) VALUES (?, ?, NULL, ?, ?, ?)",
            params: [analysisItemId, analysisProjectId, JSON.stringify(storedFacts[factIndex]), fact.epistemicStatus, command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
          ...fact.evidenceSpanIds.map((spanId, evidenceIndex) => ({
            sql: "INSERT INTO evidence_instances (evidence_instance_id, analysis_item_id, span_id, role, payload_json, created_at) VALUES (?, ?, ?, 'supporting', ?, ?)",
            params: [`${analysisItemId}:evidence:${String(evidenceIndex + 1).padStart(3, "0")}`, analysisItemId, spanId, JSON.stringify({ schema_version: 1, role: "supporting", factId: fact.id }), command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          })),
        ];
      }),
      {
        sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, ?, 'fact_ledger', ?, ?, ?, ?)",
        params: [`coverage:fact_ledger:${command.commandId}`, analysisProjectId, analysisUnitId, coverageStatus, coverageReason, JSON.stringify({ schema_version: 1, rawOutputObjectHash: rawOutput.sha256, factCount: facts.length }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "UPDATE analysis_units SET status = 'facts_complete' WHERE analysis_unit_id = ? AND status = 'prepared'",
        params: [analysisUnitId],
        expectAffectedRows: { min: 1, max: 1 },
      },
      ...taskSteps,
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "analysis_project", id: analysisProjectId }, { type: "analysis_unit", id: analysisUnitId }, ...(task ? [{ type: "task", id: task.taskId }] : [])] },
    changes: [
      { topic: "analysis", resourceType: "analysis_project", resourceId: analysisProjectId, revision: 1 },
      { topic: "analysis", resourceType: "analysis_unit", resourceId: analysisUnitId, revision: 1 },
      ...(task ? [{ topic: "tasks", resourceType: "task", resourceId: task.taskId }] : []),
    ],
  };
}

interface TaskLease {
  taskId: string;
  hostId: string;
}

function parseTaskLease(value: unknown): TaskLease | null {
  if (value === undefined) return null;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const taskId = record && typeof record.taskId === "string" ? record.taskId.trim() : "";
  const hostId = record && typeof record.hostId === "string" ? record.hostId.trim() : "";
  return taskId && hostId ? { taskId, hostId } : null;
}

function completeTaskSteps(task: TaskLease, outputObjectHash: string, createdAt: number) {
  return [
    {
      sql: "UPDATE tasks SET status = 'succeeded', output_object_hash = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE task_id = ? AND status = 'running' AND lease_owner = ?",
      params: [outputObjectHash, createdAt, task.taskId, task.hostId],
      expectAffectedRows: { min: 1, max: 1 },
    },
    {
      sql: "UPDATE task_attempts SET status = 'succeeded', finished_at = ?, error_json = NULL WHERE task_id = ? AND host_id = ? AND status = 'running'",
      params: [createdAt, task.taskId, task.hostId],
      expectAffectedRows: { min: 1, max: 1 },
    },
    {
      sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'succeeded', ?, ?)",
      params: [`task:succeeded:${task.taskId}`, task.taskId, JSON.stringify({ schema_version: 1, hostId: task.hostId }), createdAt],
      expectAffectedRows: { min: 1, max: 1 },
    },
  ];
}

function planFailLocalFactExtraction(command: CommandEnvelope): PlannedCommand {
  const task = parseTaskLease({ taskId: command.args.taskId, hostId: command.args.hostId });
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const analysisUnitId = stringArg(command.args, "analysisUnitId");
  const rawOutput = command.args.rawOutput === undefined ? null : objectReferenceArgs(command.args, "rawOutput");
  const failure = recordArg(command.args, "failure");
  const code = failure && typeof failure.code === "string" ? failure.code : "";
  const message = failure && typeof failure.message === "string" ? failure.message.slice(0, 500) : "";
  if (!task || !analysisProjectId || !analysisUnitId || !failure || !code || !message || (command.args.rawOutput !== undefined && !rawOutput)) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "fail_local_fact_extraction 缺少合法任务、分析单元或失败信息。" }] };
  }
  const reason = code === "invalid_output" ? "invalid_output" : "failed_request";
  return {
    kind: "plan",
    steps: [
      ...(rawOutput ? [{
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [rawOutput.sha256, rawOutput.byteLength, rawOutput.mediaType, command.createdAt, command.createdAt],
      }] : []),
      {
        sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, ?, 'fact_ledger', 'failed', ?, ?, ?)",
        params: [`coverage:fact_ledger:failure:${task.taskId}`, analysisProjectId, analysisUnitId, reason, JSON.stringify({ schema_version: 1, code, message, ...(rawOutput ? { rawOutputObjectHash: rawOutput.sha256 } : {}) }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "UPDATE tasks SET status = 'failed', output_object_hash = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE task_id = ? AND status = 'running' AND lease_owner = ?",
        params: [rawOutput?.sha256 ?? null, command.createdAt, task.taskId, task.hostId],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "UPDATE task_attempts SET status = 'failed', finished_at = ?, error_json = ? WHERE task_id = ? AND host_id = ? AND status = 'running'",
        params: [command.createdAt, JSON.stringify({ schema_version: 1, code, message, retryable: false }), task.taskId, task.hostId],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'failed', ?, ?)",
        params: [`task:failed:${task.taskId}`, task.taskId, JSON.stringify({ schema_version: 1, code, message, retryable: false }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "analysis_project", id: analysisProjectId }, { type: "analysis_unit", id: analysisUnitId }, { type: "task", id: task.taskId }] },
    changes: [
      { topic: "analysis", resourceType: "analysis_project", resourceId: analysisProjectId, revision: 1 },
      { topic: "analysis", resourceType: "analysis_unit", resourceId: analysisUnitId, revision: 1 },
      { topic: "tasks", resourceType: "task", resourceId: task.taskId },
    ],
  };
}

function planCommitThreadGraph(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const rawOutput = objectReferenceArgs(command.args, "rawOutput");
  const threads = parsePlannedThreads(command.args.threads);
  if (!analysisProjectId || !rawOutput || !threads) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_thread_graph 缺少合法 AnalysisProject、原始对象或线程列表。" }] };
  }
  const payloads = threads.map((thread) => ({ schema_version: 1, kind: "thread_graph_thread", thread: toCommandThread(thread) }));
  if (payloads.some((payload) => !schemas.validate("analysis_item", payload).ok)) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "ThreadGraph payload schema 无效。" }] };
  }
  const coverageStatus = threads.length === 0 ? "no_pattern" : "complete";
  return {
    kind: "plan",
    steps: [
      {
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [rawOutput.sha256, rawOutput.byteLength, rawOutput.mediaType, command.createdAt, command.createdAt],
      },
      ...threads.flatMap((thread, threadIndex) => {
        const analysisItemId = `thread:${analysisProjectId}:${thread.id}`;
        return [
          {
            sql: "INSERT INTO analysis_items (analysis_item_id, analysis_project_id, research_question_id, payload_json, epistemic_status, created_at) VALUES (?, ?, NULL, ?, ?, ?)",
            params: [analysisItemId, analysisProjectId, JSON.stringify(payloads[threadIndex]), thread.epistemicStatus, command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
          ...thread.episodes.flatMap((episode) => episode.evidenceSpanIds.map((spanId, spanIndex) => ({
            sql: "INSERT INTO evidence_instances (evidence_instance_id, analysis_item_id, span_id, role, payload_json, created_at) VALUES (?, ?, ?, 'episode_supporting', ?, ?)",
            params: [`${analysisItemId}:episode:${episode.id}:${String(spanIndex + 1).padStart(3, "0")}`, analysisItemId, spanId, JSON.stringify({ schema_version: 1, episodeId: episode.id, ordinal: episode.ordinal }), command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          }))),
        ];
      }),
      {
        sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, NULL, 'thread_graph', ?, 'validated_thread_graph', ?, ?)",
        params: [`coverage:thread_graph:${command.commandId}`, analysisProjectId, coverageStatus, JSON.stringify({ schema_version: 1, rawOutputObjectHash: rawOutput.sha256, threadCount: threads.length }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "analysis_project", id: analysisProjectId }, ...threads.map((thread) => ({ type: "analysis_item", id: `thread:${analysisProjectId}:${thread.id}` }))] },
    changes: [
      { topic: "analysis", resourceType: "analysis_project", resourceId: analysisProjectId, revision: 1 },
      ...threads.map((thread) => ({ topic: "analysis", resourceType: "analysis_item", resourceId: `thread:${analysisProjectId}:${thread.id}`, revision: 1 })),
    ],
  };
}

function planCommitAnalysisBrief(command: CommandEnvelope): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const rawOutput = objectReferenceArgs(command.args, "rawOutput");
  let questions: ReturnType<typeof parseAnalysisBriefOutput> | null = null;
  try {
    questions = parseAnalysisBriefOutput(JSON.stringify({ questions: command.args.questions }));
  } catch {
    questions = null;
  }
  if (!analysisProjectId || !rawOutput || !questions) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_analysis_brief 缺少合法 AnalysisProject、原始对象或研究问题列表。" }] };
  }
  return {
    kind: "plan",
    steps: [
      {
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [rawOutput.sha256, rawOutput.byteLength, rawOutput.mediaType, command.createdAt, command.createdAt],
      },
      ...questions.map((question, index) => {
        const { id, ...payloadQuestion } = question;
        return {
          sql: "INSERT INTO research_questions (research_question_id, analysis_project_id, payload_json, status, ordinal, created_at) VALUES (?, ?, ?, 'pending_review', ?, ?)",
          params: [id, analysisProjectId, JSON.stringify({ schema_version: 1, kind: "analysis_brief_question", question: payloadQuestion, rawOutputObjectHash: rawOutput.sha256 }), index + 1, command.createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        };
      }),
      {
        sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, NULL, 'analysis_brief', 'needs_review', 'awaiting_human_approval', ?, ?)",
        params: [`coverage:analysis_brief:${command.commandId}`, analysisProjectId, JSON.stringify({ schema_version: 1, rawOutputObjectHash: rawOutput.sha256, questionCount: questions.length }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "analysis_project", id: analysisProjectId }, ...questions.map((question) => ({ type: "research_question", id: question.id }))] },
    changes: [
      { topic: "analysis", resourceType: "analysis_project", resourceId: analysisProjectId, revision: 1 },
      ...questions.map((question) => ({ topic: "analysis", resourceType: "research_question", resourceId: question.id, revision: 1 })),
    ],
  };
}

function planApproveAnalysisBrief(command: CommandEnvelope): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  if (!analysisProjectId) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "approve_analysis_brief 缺少 AnalysisProject。" }] };
  if (command.actor.kind !== "human" && command.actor.kind !== "human_via_agent") {
    return { kind: "blocked", diagnostics: [{ code: "human_approval_required", message: "AnalysisBrief 只能由人类或 human_via_agent 批准。" }] };
  }
  return {
    kind: "plan",
    steps: [
      {
        sql: "UPDATE research_questions SET status = 'approved' WHERE analysis_project_id = ? AND status = 'pending_review'",
        params: [analysisProjectId],
        expectAffectedRows: { min: 1 },
      },
      {
        sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, NULL, 'analysis_brief', 'complete', 'analysis_brief_approved', ?, ?)",
        params: [`coverage:analysis_brief:approved:${command.commandId}`, analysisProjectId, JSON.stringify({ schema_version: 1, actor: command.actor }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "analysis_project", id: analysisProjectId }] },
    changes: [{ topic: "analysis", resourceType: "analysis_project", resourceId: analysisProjectId, revision: 1 }],
  };
}

function planCommitResearchConclusions(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const researchQuestionId = stringArg(command.args, "researchQuestionId");
  const rawOutput = objectReferenceFrom(command.args.rawOutput);
  const conclusions = researchQuestionId ? parsePlannedResearchConclusions(command.args.conclusions, researchQuestionId) : null;
  if (!analysisProjectId || !researchQuestionId || !rawOutput || !conclusions) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_research_conclusions 缺少合法 AnalysisProject、ResearchQuestion、原始对象或结论列表。" }] };
  }
  const payloads = conclusions.map((conclusion) => ({ schema_version: 1, kind: "research_conclusion", researchQuestionId, conclusion: toCommandConclusion(conclusion) }));
  if (payloads.some((payload) => !schemas.validate("analysis_item", payload).ok)) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "ResearchConclusion payload schema 无效。" }] };
  }
  const coverageStatus = deriveResearchConclusionCoverage(conclusions);
  return {
    kind: "plan",
    steps: [
      {
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [rawOutput.sha256, rawOutput.byteLength, rawOutput.mediaType, command.createdAt, command.createdAt],
      },
      ...conclusions.flatMap((conclusion, conclusionIndex) => {
        const analysisItemId = `conclusion:${analysisProjectId}:${researchQuestionId}:${conclusion.id}`;
        const observationBySpan = new Map<string, string[]>();
        for (const observation of conclusion.observations) {
          for (const spanId of observation.evidenceSpanIds) {
            const ids = observationBySpan.get(spanId) ?? [];
            ids.push(observation.id);
            observationBySpan.set(spanId, ids);
          }
        }
        return [
          {
            sql: "INSERT INTO analysis_items (analysis_item_id, analysis_project_id, research_question_id, payload_json, epistemic_status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            params: [analysisItemId, analysisProjectId, researchQuestionId, JSON.stringify(payloads[conclusionIndex]), conclusion.epistemicStatus, command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          },
          ...conclusion.evidenceSpanIds.map((spanId, evidenceIndex) => ({
            sql: "INSERT INTO evidence_instances (evidence_instance_id, analysis_item_id, span_id, role, payload_json, created_at) VALUES (?, ?, ?, 'supporting', ?, ?)",
            params: [`${analysisItemId}:supporting:${String(evidenceIndex + 1).padStart(3, "0")}`, analysisItemId, spanId, JSON.stringify({ schema_version: 1, conclusionId: conclusion.id, observationIds: observationBySpan.get(spanId) ?? [] }), command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          })),
          ...conclusion.counterEvidenceSpanIds.map((spanId, evidenceIndex) => ({
            sql: "INSERT INTO evidence_instances (evidence_instance_id, analysis_item_id, span_id, role, payload_json, created_at) VALUES (?, ?, ?, 'counter', ?, ?)",
            params: [`${analysisItemId}:counter:${String(evidenceIndex + 1).padStart(3, "0")}`, analysisItemId, spanId, JSON.stringify({ schema_version: 1, conclusionId: conclusion.id }), command.createdAt],
            expectAffectedRows: { min: 1, max: 1 },
          })),
        ];
      }),
      {
        sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, NULL, 'research_question', ?, 'research_conclusion_submitted', ?, ?)",
        params: [`coverage:research_question:${command.commandId}`, analysisProjectId, coverageStatus, JSON.stringify({ schema_version: 1, researchQuestionId, rawOutputObjectHash: rawOutput.sha256, conclusionCount: conclusions.length }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "research_question", id: researchQuestionId }, ...conclusions.map((conclusion) => ({ type: "analysis_item", id: `conclusion:${analysisProjectId}:${researchQuestionId}:${conclusion.id}` }))] },
    changes: [
      { topic: "analysis", resourceType: "research_question", resourceId: researchQuestionId, revision: 1 },
      ...conclusions.map((conclusion) => ({ topic: "analysis", resourceType: "analysis_item", resourceId: `conclusion:${analysisProjectId}:${researchQuestionId}:${conclusion.id}`, revision: 1 })),
    ],
  };
}

function deriveResearchConclusionCoverage(conclusions: ReadonlyArray<{ coverageStatus: string }>): string {
  if (conclusions.length === 0) return "no_pattern";
  const statuses = new Set(conclusions.map((conclusion) => conclusion.coverageStatus));
  if (statuses.size === 1) return conclusions[0]!.coverageStatus;
  return statuses.has("complete") || statuses.has("partial") ? "partial" : "needs_review";
}

function planCommitIndependentFalsification(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const conclusionId = stringArg(command.args, "conclusionId");
  const researchQuestionId = stringArg(command.args, "researchQuestionId");
  const rawOutput = objectReferenceFrom(command.args.rawOutput);
  const assessment = conclusionId ? parsePlannedIndependentFalsification(command.args.assessment, conclusionId) : null;
  if (!analysisProjectId || !conclusionId || !researchQuestionId || !rawOutput || !assessment) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_independent_falsification 缺少合法 AnalysisProject、结论、研究问题、原始对象或反证结果。" }] };
  }
  const payload = { schema_version: 1, kind: "independent_falsification", conclusionId, assessment: toCommandFalsification(assessment) };
  if (!schemas.validate("analysis_item", payload).ok) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "IndependentFalsification payload schema 无效。" }] };
  }
  const analysisItemId = `falsification:${analysisProjectId}:${conclusionId}`;
  const coverageStatus = assessment.status === "unknown" ? "not_observed" : "complete";
  return {
    kind: "plan",
    steps: [
      {
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [rawOutput.sha256, rawOutput.byteLength, rawOutput.mediaType, command.createdAt, command.createdAt],
      },
      {
        sql: "INSERT INTO analysis_items (analysis_item_id, analysis_project_id, research_question_id, payload_json, epistemic_status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params: [analysisItemId, analysisProjectId, researchQuestionId, JSON.stringify(payload), assessment.status === "unknown" ? "unknown" : "inferred", command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      ...assessment.counterEvidenceSpanIds.map((spanId, index) => ({
        sql: "INSERT INTO evidence_instances (evidence_instance_id, analysis_item_id, span_id, role, payload_json, created_at) VALUES (?, ?, ?, 'counter', ?, ?)",
        params: [`${analysisItemId}:counter:${String(index + 1).padStart(3, "0")}`, analysisItemId, spanId, JSON.stringify({ schema_version: 1, conclusionId }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      })),
      {
        sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, NULL, 'independent_falsification', ?, 'independent_falsification_submitted', ?, ?)",
        params: [`coverage:independent_falsification:${command.commandId}`, analysisProjectId, coverageStatus, JSON.stringify({ schema_version: 1, conclusionId, researchQuestionId, rawOutputObjectHash: rawOutput.sha256, status: assessment.status }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "analysis_item", id: analysisItemId }, { type: "research_question", id: researchQuestionId }] },
    changes: [
      { topic: "analysis", resourceType: "analysis_item", resourceId: analysisItemId, revision: 1 },
      { topic: "analysis", resourceType: "research_question", resourceId: researchQuestionId, revision: 1 },
    ],
  };
}

function planCommitResearchDossier(command: CommandEnvelope): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const dossierId = stringArg(command.args, "dossierId");
  const revision = command.args.revision;
  const payload = objectReferenceArgs(command.args, "payload");
  if (!analysisProjectId || !dossierId || !Number.isInteger(revision) || (revision as number) < 1 || !payload) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_research_dossier 缺少合法 AnalysisProject、Dossier 修订号或对象引用。" }] };
  }
  return {
    kind: "plan",
    steps: [
      {
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [payload.sha256, payload.byteLength, payload.mediaType, command.createdAt, command.createdAt],
      },
      {
        sql: "INSERT INTO research_dossiers (dossier_id, analysis_project_id, revision, payload_object_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        params: [dossierId, analysisProjectId, revision as number, payload.sha256, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: revision as number, resourceRefs: [{ type: "research_dossier", id: dossierId }] },
    changes: [{ topic: "analysis", resourceType: "research_dossier", resourceId: dossierId, revision: revision as number }],
  };
}

function planCommitMechanismCandidate(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const mechanismAssetId = stringArg(command.args, "mechanismAssetId");
  const rawOutput = objectReferenceFrom(command.args.rawOutput);
  const neutralExample = objectReferenceFrom(command.args.neutralExample);
  const payload = parsePlannedMechanismPayload(command.args.payload);
  if (!analysisProjectId || !mechanismAssetId || !rawOutput || !neutralExample || !payload || payload.card.id !== mechanismAssetId || payload.rawOutputObjectHash !== rawOutput.sha256 || !schemas.validate("mechanism_asset", payload).ok) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_mechanism_candidate 缺少合法分析项目、机制卡或对象引用。" }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [rawOutput.sha256, rawOutput.byteLength, rawOutput.mediaType, command.createdAt, command.createdAt] },
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [neutralExample.sha256, neutralExample.byteLength, neutralExample.mediaType, command.createdAt, command.createdAt] },
      { sql: "INSERT INTO mechanism_assets (mechanism_asset_id, analysis_project_id, status, current_revision, created_at, updated_at) VALUES (?, ?, 'candidate', 1, ?, ?)", params: [mechanismAssetId, analysisProjectId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO mechanism_asset_revisions (mechanism_asset_id, revision, payload_json, neutral_example_object_hash, created_at) VALUES (?, 1, ?, ?, ?)", params: [mechanismAssetId, JSON.stringify(payload), neutralExample.sha256, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "mechanism_asset", id: mechanismAssetId }] },
    changes: [{ topic: "analysis", resourceType: "mechanism_asset", resourceId: mechanismAssetId, revision: 1 }],
  };
}

function planReviewMechanismAsset(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const mechanismAssetId = stringArg(command.args, "mechanismAssetId");
  const projectId = stringArg(command.args, "projectId");
  const reviewStatus = stringArg(command.args, "reviewStatus");
  const nextStatus = stringArg(command.args, "nextStatus");
  const neutralExampleObjectHash = stringArg(command.args, "neutralExampleObjectHash");
  const payload = parsePlannedMechanismPayload(command.args.payload);
  const expectedRevision = command.expectedRevision;
  if (!mechanismAssetId || !projectId || !payload || payload.card.id !== mechanismAssetId || !Number.isInteger(expectedRevision) || (expectedRevision as number) < 1 || !neutralExampleObjectHash || !/^[a-f0-9]{64}$/.test(neutralExampleObjectHash) || (reviewStatus !== "adopted" && reviewStatus !== "editor_only" && reviewStatus !== "rejected") || (nextStatus !== "candidate" && nextStatus !== "verified") || !schemas.validate("mechanism_asset", payload).ok) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "review_mechanism_asset 缺少合法机制、采纳状态或 expectedRevision。" }] };
  }
  const nextRevision = (expectedRevision as number) + 1;
  return {
    kind: "plan",
    steps: [
      { sql: "UPDATE mechanism_assets SET status = ?, current_revision = ?, updated_at = ? WHERE mechanism_asset_id = ? AND current_revision = ?", params: [nextStatus!, nextRevision, command.createdAt, mechanismAssetId!, expectedRevision as number], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO mechanism_asset_revisions (mechanism_asset_id, revision, payload_json, neutral_example_object_hash, created_at) VALUES (?, ?, ?, ?, ?)", params: [mechanismAssetId!, nextRevision, JSON.stringify(payload), neutralExampleObjectHash!, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO mechanism_adoptions (adoption_id, mechanism_asset_id, project_id, status, actor_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [`adoption:${mechanismAssetId!}:${projectId!}:${command.commandId}`, mechanismAssetId!, projectId!, reviewStatus!, JSON.stringify(command.actor), command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ],
    result: { kind: "ok", revision: nextRevision, resourceRefs: [{ type: "mechanism_asset", id: mechanismAssetId }, { type: "novel_project", id: projectId }] },
    changes: [{ topic: "analysis", resourceType: "mechanism_asset", resourceId: mechanismAssetId, revision: nextRevision }, { topic: "projects", resourceType: "novel_project", resourceId: projectId }],
  };
}

function planCommitProjectPlanningDocument(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const projectId = stringArg(command.args, "projectId"); const documentId = stringArg(command.args, "documentId"); const documentType = stringArg(command.args, "documentType"); const status = stringArg(command.args, "status");
  const payload = recordArg(command.args, "payload"); const raw = command.args.rawOutput === undefined ? null : objectReferenceFrom(command.args.rawOutput);
  const content = command.args.contentObject === undefined ? raw : objectReferenceFrom(command.args.contentObject);
  const expected = command.args.expectedRevision;
  if (!projectId || !documentId || !documentType || !status || !payload || !schemas.validate("project_document", payload).ok || (command.args.rawOutput !== undefined && !raw) || (command.args.contentObject !== undefined && !content) || (expected !== null && (!Number.isInteger(expected) || (expected as number) < 1))) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_project_planning_document 参数无效。" }] };
  const artifactId = `document:${documentId}`;
  const create = expected === null;
  const revision = create ? 1 : (expected as number) + 1;
  const steps = [
    ...(raw ? [{ sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [raw.sha256, raw.byteLength, raw.mediaType, command.createdAt, command.createdAt] }] : []),
    ...(content && content.sha256 !== raw?.sha256 ? [{ sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [content.sha256, content.byteLength, content.mediaType, command.createdAt, command.createdAt] }] : []),
    ...(create ? [
      { sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, 'project_document', 1, ?, ?, ?)", params: [artifactId, projectId, status, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO project_documents (document_id, project_id, chapter_id, document_type, status, artifact_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)", params: [documentId, projectId, documentType, status, artifactId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ] : [
      { sql: "UPDATE artifacts SET status = ?, current_revision = ?, updated_at = ? WHERE artifact_id = ? AND current_revision = ?", params: [status, revision, command.createdAt, artifactId, expected as number], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "UPDATE project_documents SET status = ?, updated_at = ? WHERE document_id = ?", params: [status, command.createdAt, documentId], expectAffectedRows: { min: 1, max: 1 } },
    ]),
    { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [artifactId, revision, create ? null : expected as number, JSON.stringify(payload), content?.sha256 ?? raw?.sha256 ?? null, JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
  ];
  return { kind: "plan", steps, result: { kind: "ok", revision, resourceRefs: [{ type: "project_document", id: documentId }] }, changes: [{ topic: "projects", resourceType: "project_document", resourceId: documentId, revision }] };
}

interface PlannedRevisionPatch { id: string; expectedRevision: number | null; payload: Record<string, unknown>; characterId?: string; }
interface PlannedReaderPromise { id: string; status: string; payload: Record<string, unknown>; }
interface PlannedSelectedDraft { documentId: string; revision: "v1" | "v2" | "v3"; model: string; reviewLineage: string[]; }

function planCommitChapterProduction(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const projectId = stringArg(command.args, "projectId");
  const chapterId = stringArg(command.args, "chapterId");
  const chapterOrdinal = command.args.chapterOrdinal;
  const title = stringArg(command.args, "title");
  const productionCommitId = stringArg(command.args, "productionCommitId");
  const manifestId = stringArg(command.args, "manifestId");
  const manifestObject = objectReferenceArgs(command.args, "manifestObject");
  const textObject = objectReferenceArgs(command.args, "textObject");
  const selectedDraft = plannedSelectedDraft(command.args.selectedDraft);
  const expectedChapterRevision = command.args.expectedChapterRevision;
  const expectedTextRevision = command.args.expectedTextRevision;
  const chapterDelta = recordArg(command.args, "chapterDelta");
  const readerState = recordArg(command.args, "readerState");
  const outlineDrift = recordArg(command.args, "outlineDrift");
  const canonPatches = plannedRevisionPatches(command.args.canonPatches, "canonEntryId", schemas, "canon_entry");
  const knowledgePatches = plannedRevisionPatches(command.args.characterKnowledgePatches, "knowledgeId", schemas, "character_knowledge", "characterId");
  const promiseUpdates = plannedReaderPromises(command.args.readerPromiseUpdates, schemas);
  const expectedValid = (value: unknown): value is number | null => value === null || (Number.isInteger(value) && (value as number) >= 1);
  const readerStateId = readerState && stringArg(readerState, "readerStateId");
  const readerStatePayload = readerState && recordArg(readerState, "payload");
  const outlinePayload = outlineDrift && recordArg(outlineDrift, "payload");
  if (!projectId || !chapterId || !title || !productionCommitId || !manifestId || !manifestObject || !textObject || !selectedDraft || !Number.isInteger(chapterOrdinal) || (chapterOrdinal as number) < 1 || !expectedValid(expectedChapterRevision) || !expectedValid(expectedTextRevision) || ((expectedChapterRevision === null) !== (expectedTextRevision === null)) || !chapterDelta || !schemas.validate("project_document", chapterDelta).ok || !readerStateId || !readerStatePayload || !schemas.validate("reader_state", readerStatePayload).ok || !outlinePayload || !schemas.validate("project_document", outlinePayload).ok || !canonPatches || !knowledgePatches || !promiseUpdates) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_chapter_production 参数无效。" }] };
  }
  const create = expectedChapterRevision === null;
  const chapterRevision = create ? 1 : (expectedChapterRevision as number) + 1;
  const textRevision = create ? 1 : (expectedTextRevision as number) + 1;
  const textDocumentId = `production:chapter_text:${chapterId}`;
  const textArtifactId = `document:${textDocumentId}`;
  const outlineDocumentId = `production:outline_drift:${chapterId}:${productionCommitId}`;
  const outlineArtifactId = `document:${outlineDocumentId}`;
  const chapterTextPayload = { schema_version: 1, kind: "chapter_text", chapterId, title, manifestId, productionCommitId, selectedDraft, chapterDelta };
  const steps = [
    { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [manifestObject.sha256, manifestObject.byteLength, manifestObject.mediaType, command.createdAt, command.createdAt] },
    { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [textObject.sha256, textObject.byteLength, textObject.mediaType, command.createdAt, command.createdAt] },
    ...(create ? [
      { sql: "INSERT INTO chapters (chapter_id, project_id, branch_id, ordinal, status, current_revision, created_at, updated_at) VALUES (?, ?, NULL, ?, 'accepted', 1, ?, ?)", params: [chapterId, projectId, chapterOrdinal as number, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, 'project_document', 1, 'accepted', ?, ?)", params: [textArtifactId, projectId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO project_documents (document_id, project_id, chapter_id, document_type, status, artifact_id, created_at, updated_at) VALUES (?, ?, ?, 'chapter_text', 'accepted', ?, ?, ?)", params: [textDocumentId, projectId, chapterId, textArtifactId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ] : [
      { sql: "UPDATE chapters SET ordinal = ?, status = 'accepted', current_revision = ?, updated_at = ? WHERE chapter_id = ? AND project_id = ? AND current_revision = ?", params: [chapterOrdinal as number, chapterRevision, command.createdAt, chapterId, projectId, expectedChapterRevision as number], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "UPDATE artifacts SET status = 'accepted', current_revision = ?, updated_at = ? WHERE artifact_id = ? AND current_revision = ?", params: [textRevision, command.createdAt, textArtifactId, expectedTextRevision as number], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "UPDATE project_documents SET status = 'accepted', updated_at = ? WHERE document_id = ? AND project_id = ? AND chapter_id = ?", params: [command.createdAt, textDocumentId, projectId, chapterId], expectAffectedRows: { min: 1, max: 1 } },
    ]),
    { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [textArtifactId, textRevision, create ? null : expectedTextRevision as number, JSON.stringify(chapterTextPayload), textObject.sha256, JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ...canonPatches.flatMap((patch) => patch.expectedRevision === null
      ? [{ sql: "INSERT INTO canon_entries (canon_entry_id, project_id, payload_json, revision, status, created_at, updated_at) VALUES (?, ?, ?, 1, 'canonical', ?, ?)", params: [patch.id, projectId, JSON.stringify(patch.payload), command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } }]
      : [{ sql: "UPDATE canon_entries SET payload_json = ?, revision = ?, status = 'canonical', updated_at = ? WHERE canon_entry_id = ? AND project_id = ? AND revision = ?", params: [JSON.stringify(patch.payload), patch.expectedRevision + 1, command.createdAt, patch.id, projectId, patch.expectedRevision], expectAffectedRows: { min: 1, max: 1 } }]),
    ...knowledgePatches.flatMap((patch) => patch.expectedRevision === null
      ? [{ sql: "INSERT INTO character_knowledge (knowledge_id, project_id, character_id, payload_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)", params: [patch.id, projectId, patch.characterId!, JSON.stringify(patch.payload), command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } }]
      : [{ sql: "UPDATE character_knowledge SET character_id = ?, payload_json = ?, revision = ?, updated_at = ? WHERE knowledge_id = ? AND project_id = ? AND revision = ?", params: [patch.characterId!, JSON.stringify(patch.payload), patch.expectedRevision + 1, command.createdAt, patch.id, projectId, patch.expectedRevision], expectAffectedRows: { min: 1, max: 1 } }]),
    // ReaderState/Promise 是项目跨章连续状态；同一 ID 的后续章节必须推进 revision，
    // 而不是 INSERT 冲突或把第 1 章状态隔离在下一章不可见的位置。
    { sql: "INSERT INTO reader_states (reader_state_id, project_id, chapter_id, payload_json, revision, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(reader_state_id) DO UPDATE SET project_id = excluded.project_id, chapter_id = excluded.chapter_id, payload_json = excluded.payload_json, revision = reader_states.revision + 1", params: [readerStateId, projectId, chapterId, JSON.stringify(readerStatePayload), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ...promiseUpdates.map((patch) => ({ sql: "INSERT INTO reader_promises (reader_promise_id, project_id, chapter_id, payload_json, status, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(reader_promise_id) DO UPDATE SET project_id = excluded.project_id, chapter_id = excluded.chapter_id, payload_json = excluded.payload_json, status = excluded.status, revision = reader_promises.revision + 1, updated_at = excluded.updated_at", params: [patch.id, projectId, chapterId, JSON.stringify(patch.payload), patch.status, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } })),
    { sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, 'project_document', 1, 'needs_review', ?, ?)", params: [outlineArtifactId, projectId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO project_documents (document_id, project_id, chapter_id, document_type, status, artifact_id, created_at, updated_at) VALUES (?, ?, ?, 'outline_drift', 'needs_review', ?, ?, ?)", params: [outlineDocumentId, projectId, chapterId, outlineArtifactId, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 1, NULL, ?, NULL, ?, ?)", params: [outlineArtifactId, JSON.stringify({ schema_version: 1, kind: "outline_drift", chapterId, productionCommitId, ...outlinePayload }), JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    { sql: "INSERT INTO production_commits (production_commit_id, project_id, chapter_id, accepted_document_id, manifest_object_hash, run_id, actor_json, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)", params: [productionCommitId, projectId, chapterId, textDocumentId, manifestObject.sha256, JSON.stringify(command.actor), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
  ];
  return {
    kind: "plan",
    steps,
    result: { kind: "ok", revision: chapterRevision, resourceRefs: [{ type: "chapter", id: chapterId }, { type: "project_document", id: textDocumentId }, { type: "production_commit", id: productionCommitId }] },
    changes: [
      { topic: "projects", resourceType: "chapter", resourceId: chapterId, revision: chapterRevision },
      { topic: "documents", resourceType: "project_document", resourceId: textDocumentId, revision: textRevision },
      { topic: "production", resourceType: "production_commit", resourceId: productionCommitId, revision: chapterRevision },
    ],
  };
}

function plannedSelectedDraft(value: unknown): PlannedSelectedDraft | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const documentId = record && stringArg(record, "documentId");
  const model = record && stringArg(record, "model");
  const revision = record?.revision;
  const reviewLineage = record?.reviewLineage;
  if (!documentId || !model || (revision !== "v1" && revision !== "v2" && revision !== "v3") || !Array.isArray(reviewLineage) || reviewLineage.some((item) => typeof item !== "string" || !item.trim()) || new Set(reviewLineage).size !== reviewLineage.length) return null;
  return { documentId, model, revision, reviewLineage: [...reviewLineage] as string[] };
}

function plannedRevisionPatches(value: unknown, idKey: string, schemas: PayloadSchemaRegistry, schemaName: string, extraIdKey?: string): PlannedRevisionPatch[] | null {
  if (!Array.isArray(value)) return null;
  const patches: PlannedRevisionPatch[] = [];
  for (const item of value) {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const id = record && typeof record[idKey] === "string" && record[idKey].trim() ? record[idKey] as string : "";
    const expected = record?.expectedRevision;
    const payload = record && record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload as Record<string, unknown> : null;
    const characterId = extraIdKey && record && typeof record[extraIdKey] === "string" && record[extraIdKey].trim() ? record[extraIdKey] as string : undefined;
    if (!id || (expected !== null && (!Number.isInteger(expected) || (expected as number) < 1)) || !payload || !schemas.validate(schemaName, payload).ok || (extraIdKey && !characterId)) return null;
    patches.push({ id, expectedRevision: expected as number | null, payload, ...(characterId ? { characterId } : {}) });
  }
  return new Set(patches.map((patch) => patch.id)).size === patches.length ? patches : null;
}

function plannedReaderPromises(value: unknown, schemas: PayloadSchemaRegistry): PlannedReaderPromise[] | null {
  if (!Array.isArray(value)) return null;
  const statuses = new Set(["establish", "reinforce", "delay", "payoff", "transform"]);
  const promises: PlannedReaderPromise[] = [];
  for (const item of value) {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const id = record && typeof record.readerPromiseId === "string" && record.readerPromiseId.trim() ? record.readerPromiseId : "";
    const status = record && typeof record.status === "string" ? record.status : "";
    const payload = record && record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload as Record<string, unknown> : null;
    if (!id || !statuses.has(status) || !payload || !schemas.validate("reader_promise", payload).ok) return null;
    promises.push({ id, status, payload });
  }
  return new Set(promises.map((promise) => promise.id)).size === promises.length ? promises : null;
}

interface PlannedReadingMapUnit {
  analysisUnitId: string;
  ordinal: number;
  startByte: number;
  endByte: number;
  spanCount: number;
  spanKinds: Record<string, number>;
}

function planCommitStructuralReadingMap(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const mapObject = objectReferenceArgs(command.args, "mapObject");
  const map = recordArg(command.args, "map");
  const units = parseReadingMapUnits(map?.units);
  const sourceEditionId = map && typeof map.sourceEditionId === "string" ? map.sourceEditionId : "";
  const segmentationId = map && typeof map.segmentationId === "string" ? map.segmentationId : "";
  const sourceHash = map && typeof map.sourceHash === "string" ? map.sourceHash : "";
  const totalUnits = map?.totalUnits;
  const totalSpans = map?.totalSpans;
  if (!analysisProjectId || !mapObject || !map || map.schema_version !== 1 || map.kind !== "structural_reading_map" || !sourceEditionId || !segmentationId || !/^[a-f0-9]{64}$/.test(sourceHash) || !units || totalUnits !== units.length || !Number.isInteger(totalSpans) || totalSpans !== units.reduce((sum, unit) => sum + unit.spanCount, 0)) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_structural_reading_map 缺少合法的 ReadingMap 对象或单元摘要。" }] };
  }
  const itemPayload = { schema_version: 1, kind: "structural_reading_map", mapObjectHash: mapObject.sha256, sourceEditionId, segmentationId, sourceHash };
  const schema = schemas.validate("analysis_item", itemPayload);
  if (!schema.ok) return { kind: "blocked", diagnostics: schema.diagnostics };
  const itemId = `reading_map:${analysisProjectId}:structural:v1`;
  return {
    kind: "plan",
    steps: [
      {
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [mapObject.sha256, mapObject.byteLength, mapObject.mediaType, command.createdAt, command.createdAt],
      },
      {
        sql: "INSERT INTO analysis_items (analysis_item_id, analysis_project_id, research_question_id, payload_json, epistemic_status, created_at) VALUES (?, ?, NULL, ?, 'not_observed', ?)",
        params: [itemId, analysisProjectId, JSON.stringify(itemPayload), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      ...units.map((unit) => ({
        sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, ?, 'reading_map', 'complete', 'structural_reading_map', ?, ?)",
        params: [`coverage:reading_map:${command.commandId}:${unit.analysisUnitId}`, analysisProjectId, unit.analysisUnitId, JSON.stringify({ schema_version: 1, ordinal: unit.ordinal, spanCount: unit.spanCount, spanKinds: unit.spanKinds, startByte: unit.startByte, endByte: unit.endByte }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      })),
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "analysis_project", id: analysisProjectId }, { type: "analysis_item", id: itemId }] },
    changes: [
      { topic: "analysis", resourceType: "analysis_project", resourceId: analysisProjectId, revision: 1 },
      { topic: "analysis", resourceType: "analysis_item", resourceId: itemId, revision: 1 },
    ],
  };
}

function parseReadingMapUnits(value: unknown): PlannedReadingMapUnit[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const units: PlannedReadingMapUnit[] = [];
  for (const candidate of value) {
    const record = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null;
    const analysisUnitId = record && typeof record.analysisUnitId === "string" ? record.analysisUnitId : "";
    const ordinal = record?.ordinal;
    const startByte = record?.startByte;
    const endByte = record?.endByte;
    const spanCount = record?.spanCount;
    const spanKinds = record?.spanKinds;
    if (!analysisUnitId || !Number.isInteger(ordinal) || ordinal !== units.length + 1 || !Number.isInteger(startByte) || !Number.isInteger(endByte) || (startByte as number) < 0 || (endByte as number) < (startByte as number) || !Number.isInteger(spanCount) || (spanCount as number) < 0 || !spanKinds || typeof spanKinds !== "object" || Array.isArray(spanKinds)) return null;
    const kinds = spanKinds as Record<string, unknown>;
    if (Object.values(kinds).some((count) => !Number.isInteger(count) || (count as number) < 1) || Object.values(kinds).reduce<number>((sum, count) => sum + (count as number), 0) !== spanCount) return null;
    units.push({ analysisUnitId, ordinal: ordinal as number, startByte: startByte as number, endByte: endByte as number, spanCount: spanCount as number, spanKinds: kinds as Record<string, number> });
  }
  return new Set(units.map((unit) => unit.analysisUnitId)).size === units.length ? units : null;
}

function collectEvidenceSpanIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const spanIds: string[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const evidence = (candidate as Record<string, unknown>).evidenceSpanIds;
    if (!Array.isArray(evidence) || evidence.some((spanId) => typeof spanId !== "string")) return null;
    spanIds.push(...evidence);
  }
  return spanIds;
}

function planImportReferenceText(command: CommandEnvelope): PlannedCommand {
  const referenceWorkId = stringArg(command.args, "referenceWorkId");
  const sourceEditionId = stringArg(command.args, "sourceEditionId");
  const title = stringArg(command.args, "title");
  const raw = objectReferenceArgs(command.args, "raw");
  const normalized = objectReferenceArgs(command.args, "normalized");
  const normalizationMap = objectReferenceArgs(command.args, "normalizationMap");
  const tokenEstimate = command.args.tokenEstimate;
  const task = parseTaskLease(command.args.task);
  if (!referenceWorkId || !sourceEditionId || !title || !raw || !normalized || !normalizationMap || !Number.isInteger(tokenEstimate) || (tokenEstimate as number) < 0 || normalized.sha256 !== stringArg(command.args, "sourceHash")) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "import_reference_text 缺少合法的对象引用、文本元数据或 sourceHash。" }] };
  }
  return {
    kind: "plan",
    steps: [
      ...[raw, normalized, normalizationMap].map((object) => ({
        sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING",
        params: [object.sha256, object.byteLength, object.mediaType, command.createdAt, command.createdAt],
      })),
      {
        sql: "INSERT INTO reference_works (reference_work_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, 'imported', 1, ?, ?)",
        params: [referenceWorkId, title, command.createdAt, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO source_editions (source_edition_id, reference_work_id, raw_object_hash, normalized_object_hash, source_hash, encoding, byte_length, token_estimate, created_at) VALUES (?, ?, ?, ?, ?, 'utf-8', ?, ?, ?)",
        params: [sourceEditionId, referenceWorkId, raw.sha256, normalized.sha256, normalized.sha256, normalized.byteLength, tokenEstimate as number, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO source_locations (source_location_id, source_edition_id, locator_json, start_byte, end_byte) VALUES (?, ?, ?, 0, ?)",
        params: [`normalization-map:${sourceEditionId}`, sourceEditionId, JSON.stringify({ schema_version: 1, kind: "normalization_map", objectHash: normalizationMap.sha256 }), normalized.byteLength],
        expectAffectedRows: { min: 1, max: 1 },
      },
      ...(task ? completeTaskSteps(task, normalized.sha256, command.createdAt) : []),
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "reference_work", id: referenceWorkId }, { type: "source_edition", id: sourceEditionId }, ...(task ? [{ type: "task", id: task.taskId }] : [])] },
    changes: [
      { topic: "references", resourceType: "reference_work", resourceId: referenceWorkId, revision: 1 },
      { topic: "references", resourceType: "source_edition", resourceId: sourceEditionId, revision: 1 },
      ...(task ? [{ topic: "tasks", resourceType: "task", resourceId: task.taskId }] : []),
    ],
  };
}

function planStartReferenceFileImport(command: CommandEnvelope): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const resourceKey = stringArg(command.args, "resourceKey");
  const input = objectReferenceArgs(command.args, "input");
  if (!taskId || !resourceKey || !input) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "start_reference_file_import 需要 taskId、resourceKey 和已校验的输入对象。" }] };
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [input.sha256, input.byteLength, input.mediaType, command.createdAt, command.createdAt] },
      { sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, 'reference_file_import', 'queued', ?, NULL, NULL, NULL, 0, ?, ?)", params: [taskId, resourceKey, input.sha256, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'queued', ?, ?)", params: [`task:queued:${taskId}`, taskId, JSON.stringify({ schema_version: 1, taskType: "reference_file_import" }), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ],
    result: { kind: "accepted", taskId },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

interface PlannedAnalysisUnit {
  analysisUnitId: string;
  ordinal: number;
  startByte: number;
  endByte: number;
}

interface PlannedSourceSpan {
  spanId: string;
  analysisUnitId: string;
  startByte: number;
  endByte: number;
  sourceHash: string;
  exactTextHash: string;
  locator: Record<string, unknown>;
}

function planCreateAnalysisCorpus(command: CommandEnvelope): PlannedCommand {
  const analysisProjectId = stringArg(command.args, "analysisProjectId");
  const segmentationId = stringArg(command.args, "segmentationId");
  const sourceEditionId = stringArg(command.args, "sourceEditionId");
  const segmentation = recordArg(command.args, "segmentation");
  const units = parseAnalysisUnits(command.args.units);
  const spans = parseSourceSpans(command.args.spans);
  if (!analysisProjectId || !segmentationId || !sourceEditionId || !segmentation || segmentation.schema_version !== 1 || !units || !spans) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "create_analysis_corpus 缺少合法的 segmentation、计算单元或 SourceSpan。" }] };
  }
  const unitIds = new Set(units.map((unit) => unit.analysisUnitId));
  if (unitIds.size !== units.length || spans.some((span) => !unitIds.has(span.analysisUnitId))) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "SourceSpan 必须唯一且绑定当前 segmentation 的计算单元。" }] };
  }
  return {
    kind: "plan",
    steps: [
      {
        sql: "INSERT INTO analysis_segmentations (segmentation_id, source_edition_id, revision, payload_json, created_at) VALUES (?, ?, 1, ?, ?)",
        params: [segmentationId, sourceEditionId, JSON.stringify(segmentation), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      ...units.map((unit) => ({
        sql: "INSERT INTO analysis_units (analysis_unit_id, segmentation_id, ordinal, start_byte, end_byte, status) VALUES (?, ?, ?, ?, ?, 'prepared')",
        params: [unit.analysisUnitId, segmentationId, unit.ordinal, unit.startByte, unit.endByte],
        expectAffectedRows: { min: 1, max: 1 },
      })),
      ...spans.map((span) => ({
        sql: "INSERT INTO source_spans (span_id, source_edition_id, analysis_unit_id, start_byte, end_byte, source_hash, exact_text_hash, locator_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [span.spanId, sourceEditionId, span.analysisUnitId, span.startByte, span.endByte, span.sourceHash, span.exactTextHash, JSON.stringify(span.locator)],
        expectAffectedRows: { min: 1, max: 1 },
      })),
      {
        sql: "INSERT INTO analysis_projects (analysis_project_id, source_edition_id, segmentation_id, status, current_revision, created_at, updated_at) VALUES (?, ?, ?, 'prepared', 1, ?, ?)",
        params: [analysisProjectId, sourceEditionId, segmentationId, command.createdAt, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "analysis_project", id: analysisProjectId }, { type: "analysis_segmentation", id: segmentationId }] },
    changes: [
      { topic: "analysis", resourceType: "analysis_project", resourceId: analysisProjectId, revision: 1 },
      { topic: "analysis", resourceType: "analysis_segmentation", resourceId: segmentationId, revision: 1 },
    ],
  };
}

function parseAnalysisUnits(value: unknown): PlannedAnalysisUnit[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const units: PlannedAnalysisUnit[] = [];
  for (const candidate of value) {
    const item = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null;
    const analysisUnitId = item && typeof item.analysisUnitId === "string" ? item.analysisUnitId : "";
    const ordinal = item?.ordinal;
    const startByte = item?.startByte;
    const endByte = item?.endByte;
    if (!analysisUnitId || !Number.isInteger(ordinal) || (ordinal as number) < 1 || !Number.isInteger(startByte) || !Number.isInteger(endByte) || (startByte as number) < 0 || (endByte as number) < (startByte as number)) return null;
    units.push({ analysisUnitId, ordinal: ordinal as number, startByte: startByte as number, endByte: endByte as number });
  }
  return new Set(units.map((unit) => unit.ordinal)).size === units.length ? units : null;
}

function parseSourceSpans(value: unknown): PlannedSourceSpan[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const spans: PlannedSourceSpan[] = [];
  for (const candidate of value) {
    const item = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null;
    const spanId = item && typeof item.spanId === "string" ? item.spanId : "";
    const analysisUnitId = item && typeof item.analysisUnitId === "string" ? item.analysisUnitId : "";
    const startByte = item?.startByte;
    const endByte = item?.endByte;
    const sourceHash = item && typeof item.sourceHash === "string" ? item.sourceHash : "";
    const exactTextHash = item && typeof item.exactTextHash === "string" ? item.exactTextHash : "";
    const locator = item && typeof item.locator === "object" && item.locator !== null && !Array.isArray(item.locator) ? item.locator as Record<string, unknown> : null;
    if (!spanId || !analysisUnitId || !Number.isInteger(startByte) || !Number.isInteger(endByte) || (startByte as number) < 0 || (endByte as number) < (startByte as number) || !/^[a-f0-9]{64}$/.test(sourceHash) || !/^[a-f0-9]{64}$/.test(exactTextHash) || !locator) return null;
    spans.push({ spanId, analysisUnitId, startByte: startByte as number, endByte: endByte as number, sourceHash, exactTextHash, locator });
  }
  return new Set(spans.map((span) => span.spanId)).size === spans.length ? spans : null;
}

function planStartLocalCreation(command: CommandEnvelope): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const resourceKey = stringArg(command.args, "resourceKey");
  const input = objectReferenceArgs(command.args, "input");
  if (!taskId || !resourceKey || !input) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "start_local_creation 需要 taskId、resourceKey 和已校验的 input 对象引用。" }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [input.sha256, input.byteLength, input.mediaType, command.createdAt, command.createdAt] },
      {
        sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, 'local_creation_draft', 'queued', ?, NULL, NULL, NULL, 0, ?, ?)",
        params: [taskId, resourceKey, input.sha256, command.createdAt, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'queued', ?, ?)",
        params: [`task:queued:${taskId}`, taskId, JSON.stringify({ schema_version: 1, taskType: "local_creation_draft" }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "accepted", taskId },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

function planStartWorkspaceMaintenance(command: CommandEnvelope, taskType: "workspace_backup" | "workspace_restore"): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const resourceKey = stringArg(command.args, "resourceKey");
  const input = objectReferenceArgs(command.args, "input");
  if (!taskId || !resourceKey || !input) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: `${taskType} 需要 taskId、resourceKey 和已校验的 input 对象引用。` }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [input.sha256, input.byteLength, input.mediaType, command.createdAt, command.createdAt] },
      {
        sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, NULL, NULL, NULL, 0, ?, ?)",
        params: [taskId, resourceKey, taskType, input.sha256, command.createdAt, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'queued', ?, ?)",
        params: [`task:queued:${taskId}`, taskId, JSON.stringify({ schema_version: 1, taskType }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "accepted", taskId },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

function planCompleteWorkspaceMaintenance(command: CommandEnvelope): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const hostId = stringArg(command.args, "hostId");
  const output = objectReferenceArgs(command.args, "output");
  if (!taskId || !hostId || !output) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "complete_workspace_maintenance 缺少任务、宿主或结果对象。" }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [output.sha256, output.byteLength, output.mediaType, command.createdAt, command.createdAt] },
      ...completeTaskSteps({ taskId, hostId }, output.sha256, command.createdAt),
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "task", id: taskId }] },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

function planStartWorkspaceExport(command: CommandEnvelope): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const resourceKey = stringArg(command.args, "resourceKey");
  const input = objectReferenceArgs(command.args, "input");
  if (!taskId || !resourceKey || !input) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "start_workspace_export 需要 taskId、resourceKey 和已校验的 input 对象引用。" }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [input.sha256, input.byteLength, input.mediaType, command.createdAt, command.createdAt] },
      { sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, 'workspace_export', 'queued', ?, NULL, NULL, NULL, 0, ?, ?)", params: [taskId, resourceKey, input.sha256, command.createdAt, command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
      { sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'queued', ?, ?)", params: [`task:queued:${taskId}`, taskId, JSON.stringify({ schema_version: 1, taskType: "workspace_export" }), command.createdAt], expectAffectedRows: { min: 1, max: 1 } },
    ],
    result: { kind: "accepted", taskId },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

function planCompleteWorkspaceExport(command: CommandEnvelope): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const hostId = stringArg(command.args, "hostId");
  const output = objectReferenceArgs(command.args, "output");
  if (!taskId || !hostId || !output) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "complete_workspace_export 缺少任务、宿主或结果对象。" }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [output.sha256, output.byteLength, output.mediaType, command.createdAt, command.createdAt] },
      ...completeTaskSteps({ taskId, hostId }, output.sha256, command.createdAt),
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "task", id: taskId }] },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

function planStartLocalFactExtraction(command: CommandEnvelope): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const resourceKey = stringArg(command.args, "resourceKey");
  const input = objectReferenceArgs(command.args, "input");
  if (!taskId || !resourceKey || !input) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "start_local_fact_extraction 需要 taskId、resourceKey 和已校验的 input 对象引用。" }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [input.sha256, input.byteLength, input.mediaType, command.createdAt, command.createdAt] },
      {
        sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, 'local_fact_extraction', 'queued', ?, NULL, NULL, NULL, 0, ?, ?)",
        params: [taskId, resourceKey, input.sha256, command.createdAt, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'queued', ?, ?)",
        params: [`task:queued:${taskId}`, taskId, JSON.stringify({ schema_version: 1, taskType: "local_fact_extraction" }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "accepted", taskId },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

function planStartLocalFactExtractionBatch(command: CommandEnvelope): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const resourceKey = stringArg(command.args, "resourceKey");
  const input = objectReferenceArgs(command.args, "input");
  if (!taskId || !resourceKey || !input) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "start_local_fact_extraction_batch 需要 taskId、resourceKey 和已校验的输入对象引用。" }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [input.sha256, input.byteLength, input.mediaType, command.createdAt, command.createdAt] },
      {
        sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, 'local_fact_extraction_batch', 'queued', ?, NULL, NULL, NULL, 0, ?, ?)",
        params: [taskId, resourceKey, input.sha256, command.createdAt, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'queued', ?, ?)",
        params: [`task:queued:${taskId}`, taskId, JSON.stringify({ schema_version: 1, taskType: "local_fact_extraction_batch" }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "accepted", taskId },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

/** 父批任务的摘要对象与任务终态必须在同一 Command 事务提交，避免 ObjectStore 引用悬空。 */
function planCompleteLocalFactExtractionBatch(command: CommandEnvelope): PlannedCommand {
  const task = parseTaskLease({ taskId: command.args.taskId, hostId: command.args.hostId });
  const output = objectReferenceArgs(command.args, "output");
  if (!task || !output) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "complete_local_fact_extraction_batch 需要持有 lease 的任务与摘要对象。" }] };
  }
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [output.sha256, output.byteLength, output.mediaType, command.createdAt, command.createdAt] },
      ...completeTaskSteps(task, output.sha256, command.createdAt),
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "task", id: task.taskId }] },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: task.taskId }],
  };
}

function planReconfigureLocalFactExtraction(command: CommandEnvelope): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const input = objectReferenceArgs(command.args, "input");
  if (!taskId || !input) return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "reconfigure_local_fact_extraction 需要任务与已校验的输入对象。" }] };
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [input.sha256, input.byteLength, input.mediaType, command.createdAt, command.createdAt] },
      {
        sql: "UPDATE tasks SET input_object_hash = ?, output_object_hash = NULL, status = 'queued', lease_owner = NULL, lease_expires_at = NULL, retry_count = retry_count + 1, updated_at = ? WHERE task_id = ? AND task_type = 'local_fact_extraction' AND status IN ('failed', 'cancelled')",
        params: [input.sha256, command.createdAt, taskId],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'reconfigured', ?, ?)",
        params: [`task:reconfigured:${taskId}:${command.commandId}`, taskId, JSON.stringify({ schema_version: 1, taskType: "local_fact_extraction", commandId: command.commandId }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "accepted", taskId },
    changes: [{ topic: "tasks", resourceType: "task", resourceId: taskId }],
  };
}

function planCommitLocalCreationDraft(command: CommandEnvelope, schemas: PayloadSchemaRegistry): PlannedCommand {
  const taskId = stringArg(command.args, "taskId");
  const hostId = stringArg(command.args, "hostId");
  const documentId = stringArg(command.args, "documentId");
  const projectId = stringArg(command.args, "projectId");
  const title = stringArg(command.args, "title");
  const output = objectReferenceArgs(command.args, "output");
  const payload = recordArg(command.args, "payload");
  if (!taskId || !hostId || !documentId || !projectId || !title || !output || !payload) {
    return { kind: "blocked", diagnostics: [{ code: "invalid_args", message: "commit_local_creation_draft 缺少任务、文档或输出对象字段。" }] };
  }
  const validation = schemas.validate("project_document", payload);
  if (!validation.ok) return { kind: "blocked", diagnostics: validation.diagnostics };
  const artifactId = `document:${documentId}`;
  return {
    kind: "plan",
    steps: [
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING", params: [output.sha256, output.byteLength, output.mediaType, command.createdAt, command.createdAt] },
      {
        sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, 'project_document', 1, 'draft', ?, ?)",
        params: [artifactId, projectId, command.createdAt, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO project_documents (document_id, project_id, chapter_id, document_type, status, artifact_id, created_at, updated_at) VALUES (?, ?, NULL, 'local_creation_draft', 'draft', ?, ?, ?)",
        params: [documentId, projectId, artifactId, command.createdAt, command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 1, NULL, ?, ?, ?, ?)",
        params: [artifactId, JSON.stringify({ ...payload, title }), output.sha256, JSON.stringify(command.actor), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "UPDATE tasks SET status = 'succeeded', output_object_hash = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE task_id = ? AND status = 'running' AND lease_owner = ?",
        params: [output.sha256, command.createdAt, taskId, hostId],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "UPDATE task_attempts SET status = 'succeeded', finished_at = ?, error_json = NULL WHERE task_id = ? AND host_id = ? AND status = 'running'",
        params: [command.createdAt, taskId, hostId],
        expectAffectedRows: { min: 1, max: 1 },
      },
      {
        sql: "INSERT INTO task_events (event_id, task_id, event_type, payload_json, created_at) VALUES (?, ?, 'succeeded', ?, ?)",
        params: [`task:succeeded:${taskId}`, taskId, JSON.stringify({ schema_version: 1, hostId }), command.createdAt],
        expectAffectedRows: { min: 1, max: 1 },
      },
    ],
    result: { kind: "ok", revision: 1, resourceRefs: [{ type: "project_document", id: documentId }, { type: "task", id: taskId }] },
    changes: [
      { topic: "documents", resourceType: "project_document", resourceId: documentId, revision: 1 },
      { topic: "tasks", resourceType: "task", resourceId: taskId },
    ],
  };
}

function objectReferenceArgs(args: Record<string, unknown>, key: string): { sha256: string; byteLength: number; mediaType: string } | null {
  const value = recordArg(args, key);
  if (!value) return null;
  const sha256 = typeof value.sha256 === "string" ? value.sha256 : "";
  const byteLength = typeof value.byteLength === "number" ? value.byteLength : NaN;
  const mediaType = typeof value.mediaType === "string" ? value.mediaType.trim() : "";
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(byteLength) || byteLength < 0 || !mediaType) return null;
  return { sha256, byteLength, mediaType };
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function recordArg(args: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = args[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseRecord(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} 不是 JSON 对象。`);
  }
}

/**
 * 工作台只需要一行可读状态，不应把无界 Canon / ReaderPromise payload 回显到 UI、MCP 或 CLI。
 * 字段白名单覆盖当前领域契约的常用命名；其余结构继续由专用文档/版本接口读取。
 */
function summaryFromWorkspacePayload(payload: Record<string, unknown>): string | null {
  for (const field of ["summary", "statement", "description", "fact", "promise", "title", "label"]) {
    const value = payload[field];
    if (typeof value !== "string") continue;
    const normalized = value.replace(/\s+/gu, " ").trim();
    if (!normalized) continue;
    const characters = Array.from(normalized);
    return characters.length > 360 ? `${characters.slice(0, 359).join("")}…` : normalized;
  }
  return null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function unavailableAnalysisActions(): WorkspaceAnalysisActionService {
  const unavailable = async (): Promise<CommandResult> => {
    throw new Error("当前 Application Service 未配置分析执行宿主；请由 CLI、MCP 或桌面受信 sidecar 提交。 ");
  };
  return {
    prepareCorpus: unavailable,
    createStructuralReadingMap: unavailable,
    submitThreadGraph: unavailable,
    submitAnalysisBrief: unavailable,
    submitResearchConclusions: unavailable,
    submitIndependentFalsification: unavailable,
    createResearchDossier: unavailable,
    proposeMechanismCandidate: unavailable,
  } as WorkspaceAnalysisActionService;
}

function unavailableProductionActions(): WorkspaceProductionActionService {
  const unavailable = async (): Promise<CommandResult> => {
    throw new Error("当前 Application Service 未配置原创生产执行宿主；请由 CLI、MCP 或桌面受信 sidecar 提交。 ");
  };
  return {
    saveProjectIntent: unavailable,
    submitStoryConcepts: unavailable,
    selectStoryConcept: unavailable,
    savePlanningDocument: unavailable,
    createCreativeRecipe: unavailable,
    freezeChapterContextManifest: unavailable,
    freezeChapterReaderManifest: unavailable,
    commitChapter: unavailable,
  } as WorkspaceProductionActionService;
}

export function invalidCommandDiagnostics(message: string): DomainDiagnostic[] {
  return [{ code: "invalid_command", message }];
}
