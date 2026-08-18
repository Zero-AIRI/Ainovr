import type { CommandEnvelope, CommandResult } from "@/application/command-types";
import type { WorkspaceApplicationService } from "@/application/workspace-application-service";

export type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface CreateDesktopWorkspaceApplicationOptions { invoke: TauriInvoke; }

type RecordValue = Record<string, unknown>;

/** 仅在 Rust 已丢弃旧 sidecar 后重试不会改变项目事实的查询。 */
const RETRYABLE_READ_ONLY_TOOLS = new Set([
  "get_workspace_status",
  "list_novel_projects",
  "get_novel_project",
  "get_project_workbench",
  "list_project_documents",
  "get_document",
  "list_pending_planning_documents",
  "list_pending_mechanism_assets",
  "list_coverage_gaps",
  "list_actionable_tasks",
  "list_reference_works",
  "get_reference_workbench",
  "get_evidence_excerpt",
  "list_provider_profiles",
  "get_workspace_settings",
  "get_capabilities",
  "list_changes",
  "list_pending_confirmations",
  "get_confirmation",
  "get_task",
  "get_pipeline_run",
  "get_chapter_method_workbench",
  "get_chapter_mechanism_application",
  "get_chapter_mechanism_outcome",
  "list_pipeline_revisions",
  "list_pipeline_runs",
]);

/**
 * 桌面端不再组合 SqlDriver/ObjectStore。WebView 只把固定 MCP 领域工具请求交给
 * Rust sidecar 网关；Node companion 才持有 Application Service、SQLite 与 ObjectStore。
 */
export function createDesktopWorkspaceApplication(options: CreateDesktopWorkspaceApplicationOptions): WorkspaceApplicationService {
  let requestNumber = 0;
  const call = async <T>(name: string, args: RecordValue = {}): Promise<T> => {
    const request = () => ({ jsonrpc: "2.0" as const, id: `desktop:${++requestNumber}`, method: "tools/call", params: { name, arguments: args } });
    let response: unknown;
    try {
      response = await options.invoke("desktop_mcp_request", { request: request() });
    } catch (cause) {
      if (!RETRYABLE_READ_ONLY_TOOLS.has(name) || !isRecoverableSidecarFailure(cause)) throw cause;
      response = await options.invoke("desktop_mcp_request", { request: request() });
    }
    const envelope = record(response);
    const result = record(envelope?.result);
    if (!result) throw new Error("桌面领域 sidecar 返回无效响应。 ");
    if (result.isError === true) {
      const content = Array.isArray(result.content) ? result.content[0] : null;
      const text = record(content)?.text;
      throw new Error(typeof text === "string" ? text : "桌面领域 sidecar 请求失败。 ");
    }
    return result.structuredContent as T;
  };
  const command = (tool: string, input: Omit<CommandEnvelope, "tool" | "args">, args: RecordValue): Promise<CommandResult> => call(tool, {
    commandId: input.commandId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, ...args,
  });
  const commandFromEnvelope = (input: CommandEnvelope): Promise<CommandResult> => {
    const allowed = new Set(["create_novel_project", "save_provider_profile", "save_workspace_settings", "approve_analysis_brief"]);
    if (!allowed.has(input.tool)) throw new Error(`桌面端不支持直接执行 ${input.tool}；请通过受控领域工作流调用。 `);
    return command(input.tool, input, { ...input.args, ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }) });
  };

  const application = {
    commands: {
      execute: commandFromEnvelope,
      executeBatch: async (): Promise<CommandResult> => ({ kind: "blocked", diagnostics: [{ code: "batch_not_available", message: "桌面端不提供原始批量命令。" }] }),
      approveConfirmation: (input: { confirmationId: string; reason: string }) => call<CommandResult>("approve_confirmation", input),
      rejectConfirmation: (input: { confirmationId: string; reason: string }) => call<CommandResult>("reject_confirmation", input),
    },
    queries: {
      getWorkspaceStatus: () => call("get_workspace_status"),
      listNovelProjects: () => call("list_novel_projects"),
      getNovelProject: (projectId: string) => call("get_novel_project", { projectId }),
      getProjectWorkbench: (projectId: string) => call("get_project_workbench", { projectId }),
      listProjectDocuments: (projectId: string) => call("list_project_documents", { projectId }),
      getProjectDocument: (input: { projectId: string; documentId: string }) => call("get_document", input),
      listPendingPlanningDocuments: () => call("list_pending_planning_documents"),
      listPendingMechanismAssets: () => call("list_pending_mechanism_assets"),
      listCoverageGaps: () => call("list_coverage_gaps"),
      listActionableTasks: () => call("list_actionable_tasks"),
      listReferenceWorks: () => call("list_reference_works"),
      getReferenceWorkbench: (referenceWorkId: string) => call("get_reference_workbench", { referenceWorkId }),
      getEvidenceExcerpt: (evidenceInstanceId: string) => call("get_evidence_excerpt", { evidenceInstanceId }),
      listProviderProfiles: () => call("list_provider_profiles"),
      getWorkspaceSettings: () => call("get_workspace_settings"),
      getCapabilities: () => call("get_capabilities"),
      listChanges: (after: number, limit?: number) => call("list_changes", { after, ...(limit === undefined ? {} : { limit }) }),
      listPendingConfirmations: () => call("list_pending_confirmations"),
      getConfirmation: (confirmationId: string) => call("get_confirmation", { confirmationId }),
    },
    taskActions: {
      get: (taskId: string) => call("get_task", { taskId }),
      wait: (taskId: string, timeoutMs: number) => call("wait_task", { taskId, timeoutMs }),
      requestCancel: (taskId: string) => call("cancel_task", { taskId }),
      retry: (taskId: string) => call("retry_task", { taskId }),
    },
    planningActions: {
      reviewDocument: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; documentId: string; expectedRevision: number; status: string }) => command("review_project_planning_document", input.command, { projectId: input.projectId, documentId: input.documentId, expectedRevision: input.expectedRevision, status: input.status }),
    },
    mechanismActions: {
      review: (input: { command: Omit<CommandEnvelope, "tool" | "args">; mechanismAssetId: string; status: string }) => command("review_mechanism_asset", input.command, { projectId: input.command.projectId, mechanismAssetId: input.mechanismAssetId, expectedRevision: input.command.expectedRevision, status: input.status }),
    },
    pipelines: {
      list: () => call("list_pipeline_revisions"),
      save: (input: { command: Omit<CommandEnvelope, "tool" | "args">; pipelineId: string; name: string; steps: unknown; status?: string; expectedRevision?: number | null }) => command("save_pipeline_revision", input.command, { pipelineId: input.pipelineId, name: input.name, steps: input.steps, ...(input.status === undefined ? {} : { status: input.status }), ...(input.expectedRevision == null ? {} : { expectedRevision: input.expectedRevision }) }),
    },
    pipelineRuns: {
      start: (input: { command: Omit<CommandEnvelope, "tool" | "args">; runId: string; pipelineId: string; projectId?: string | null }) => command("start_pipeline_run", input.command, { runId: input.runId, pipelineId: input.pipelineId, ...(input.projectId == null ? {} : { projectId: input.projectId }) }),
      bindTask: (input: { command: Omit<CommandEnvelope, "tool" | "args">; runId: string; stepId: string; taskId: string }) => command("bind_pipeline_run_task", input.command, { runId: input.runId, stepId: input.stepId, taskId: input.taskId }),
      completeStep: (input: { command: Omit<CommandEnvelope, "tool" | "args">; runId: string; stepId: string; note: string }) => command("complete_pipeline_run_step", input.command, { runId: input.runId, stepId: input.stepId, note: input.note }),
      get: (runId: string) => call("get_pipeline_run", { runId }),
      list: (limit?: number) => call("list_pipeline_runs", limit === undefined ? {} : { limit }),
    },
    pipelineActions: {
      execute: (input: { runId: string; stepId: string }) => call("execute_pipeline_run_step", input),
    },
    analysisActions: {
      prepareCorpus: (input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; segmentationId: string; sourceEditionId: string; boundary: "complete" | "volume" | "fragment"; budget: RecordValue }) => command("update_analysis_segmentation", input.command, { analysisProjectId: input.analysisProjectId, segmentationId: input.segmentationId, sourceEditionId: input.sourceEditionId, boundary: input.boundary, budget: input.budget }),
      createStructuralReadingMap: (input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string }) => command("create_structural_reading_map", input.command, { analysisProjectId: input.analysisProjectId }),
      submitThreadGraph: (input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }) => command("submit_thread_graph", input.command, { analysisProjectId: input.analysisProjectId, rawOutput: input.rawOutput }),
      submitAnalysisBrief: (input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }) => command("submit_analysis_brief", input.command, { analysisProjectId: input.analysisProjectId, rawOutput: input.rawOutput }),
      submitResearchConclusions: (input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; researchQuestionId: string; rawOutput: string }) => command("submit_research_conclusions", input.command, { analysisProjectId: input.analysisProjectId, researchQuestionId: input.researchQuestionId, rawOutput: input.rawOutput }),
      submitIndependentFalsification: (input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; conclusionId: string; rawOutput: string }) => command("submit_independent_falsification", input.command, { analysisProjectId: input.analysisProjectId, conclusionId: input.conclusionId, rawOutput: input.rawOutput }),
      createResearchDossier: (input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string }) => command("create_research_dossier", input.command, { analysisProjectId: input.analysisProjectId }),
      proposeMechanismCandidate: (input: { command: Omit<CommandEnvelope, "tool" | "args">; analysisProjectId: string; rawOutput: string }) => command("propose_mechanism_candidate", input.command, { analysisProjectId: input.analysisProjectId, rawOutput: input.rawOutput }),
    },
    productionActions: {
      saveProjectIntent: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; intent: RecordValue }) => command("save_project_intent", input.command, { projectId: input.projectId, intent: input.intent }),
      submitStoryConcepts: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; rawOutput: string }) => command("submit_story_concepts", input.command, { projectId: input.projectId, rawOutput: input.rawOutput }),
      selectStoryConcept: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; conceptId: string }) => command("select_story_concept", input.command, { projectId: input.projectId, conceptId: input.conceptId }),
      savePlanningDocument: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; kind: "story_contract" | "story_system" | "book_outline" | "stage_plan" | "chapter_contract"; payload: RecordValue }) => {
        const tool = `save_${input.kind}`;
        const field = input.kind === "story_contract" ? "contract" : input.kind === "story_system" ? "system" : input.kind === "book_outline" ? "outline" : input.kind === "stage_plan" ? "stage" : "contract";
        return command(tool, input.command, { projectId: input.projectId, [field]: input.payload });
      },
      createCreativeRecipe: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string }) => command("create_creative_recipe", input.command, { projectId: input.projectId, chapterId: input.chapterId }),
      freezeChapterContextManifest: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; manifestId: string; tokenBudget: number; reservedOutputTokens: number }) => command("freeze_chapter_context_manifest", input.command, { projectId: input.projectId, chapterId: input.chapterId, manifestId: input.manifestId, tokenBudget: input.tokenBudget, reservedOutputTokens: input.reservedOutputTokens }),
      freezeChapterReaderManifest: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; draftDocumentId: string; manifestId: string; readerKind: "immersive" | "low_patience" | "logic_sensitive"; tokenBudget: number }) => command("freeze_chapter_reader_manifest", input.command, { projectId: input.projectId, chapterId: input.chapterId, draftDocumentId: input.draftDocumentId, manifestId: input.manifestId, readerKind: input.readerKind, tokenBudget: input.tokenBudget }),
      commitChapter: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; chapterOrdinal: number; draftDocumentId: string; productionCommitId: string; outcomeId?: string; chapterDelta: RecordValue; canonPatches: RecordValue[]; characterKnowledgePatches: RecordValue[]; readerState: RecordValue; readerPromiseUpdates: RecordValue[]; outlineDrift: RecordValue }) => command("commit_chapter", input.command, { projectId: input.projectId, chapterId: input.chapterId, chapterOrdinal: input.chapterOrdinal, draftDocumentId: input.draftDocumentId, productionCommitId: input.productionCommitId, ...(input.outcomeId ? { outcomeId: input.outcomeId } : {}), chapterDelta: input.chapterDelta, canonPatches: input.canonPatches, characterKnowledgePatches: input.characterKnowledgePatches, readerState: input.readerState, readerPromiseUpdates: input.readerPromiseUpdates, outlineDrift: input.outlineDrift }),
      requestChapterCommit: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; proposalId: string }) => command("request_chapter_production_commit", input.command, { projectId: input.projectId, chapterId: input.chapterId, proposalId: input.proposalId }),
    },
    chapterMethods: {
      getWorkbench: (input: { projectId: string; chapterId: string }) => call("get_chapter_method_workbench", input),
      getApplication: (input: { projectId: string; chapterId: string }) => call("get_chapter_mechanism_application", input),
      saveApplication: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; expectedRevision: number | null; application: RecordValue }) => command("save_chapter_mechanism_application", input.command, { projectId: input.projectId, chapterId: input.chapterId, expectedRevision: input.expectedRevision, application: input.application }),
      getOutcome: (input: { projectId: string; chapterId: string }) => call("get_chapter_mechanism_outcome", input),
      saveOutcome: (input: { command: Omit<CommandEnvelope, "tool" | "args">; projectId: string; chapterId: string; expectedRevision: number | null; outcome: RecordValue }) => command("save_chapter_mechanism_outcome", input.command, { projectId: input.projectId, chapterId: input.chapterId, expectedRevision: input.expectedRevision, outcome: input.outcome }),
    },
  };
  return application as unknown as WorkspaceApplicationService;
}

function record(value: unknown): RecordValue | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null; }

function isRecoverableSidecarFailure(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /desktop MCP sidecar (is unavailable|exited unexpectedly)/i.test(message);
}
