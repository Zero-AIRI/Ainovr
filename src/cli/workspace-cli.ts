import type { CommandEnvelope } from "@/application/command-types";
import type { LocalCreationService } from "@/application/local-creation-service";
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
import type { ChapterMechanismApplicationService } from "@/application/chapter-mechanism-application-service";
import type { ChapterMechanismOutcomeService } from "@/application/chapter-mechanism-outcome-service";
import type { MechanismEffectExperimentService } from "@/application/mechanism-effect-experiment-service";
import type { MechanismEffectExperimentWriterService } from "@/application/mechanism-effect-experiment-writer-service";
import type { MechanismEffectExperimentBlindReviewService } from "@/application/mechanism-effect-experiment-blind-review-service";
import type { ChapterMethodWorkbenchService } from "@/application/chapter-method-workbench-service";
import type { ChapterContextManifestService } from "@/application/chapter-context-manifest-service";
import type { ChapterReaderManifestService } from "@/application/chapter-reader-manifest-service";
import type { ChapterReviewService } from "@/application/chapter-review-service";
import type { ChapterEditorService } from "@/application/chapter-editor-service";
import type { ChapterReaderService } from "@/application/chapter-reader-service";
import type { ChapterReviewerService } from "@/application/chapter-reviewer-service";
import type { ChapterEditorTaskService } from "@/application/chapter-editor-task-service";
import type { ChapterProductionCommitService, CanonPatch, CharacterKnowledgePatch, ReaderPromisePatch } from "@/application/chapter-production-commit-service";
import type { ChapterWriterService } from "@/application/chapter-writer-service";
import type { WorkspaceMaintenanceService } from "@/application/workspace-maintenance-service";
import type { WorkspaceExportService } from "@/application/workspace-export-service";
import type { ReferenceImportService } from "@/application/reference-import-service";
import type { ReferenceFileImportService } from "@/application/reference-file-import-service";
import type { WorkspaceApplicationService } from "@/application/workspace-application-service";
import { shouldAutoStartTask } from "@/application/automation-policy";

/** 薄 CLI 适配器；所有业务动作转给与 MCP 相同的 Application Service。 */
export async function executeWorkspaceCli(application: WorkspaceApplicationService, commandName: string, args: Record<string, unknown>, dependencies: { creation?: LocalCreationService; maintenance?: WorkspaceMaintenanceService; exporter?: WorkspaceExportService; references?: ReferenceImportService; referenceFileImport?: ReferenceFileImportService; corpus?: AnalysisCorpusService; facts?: AnalysisFactService; maps?: StructuralReadingMapService; factExtraction?: LocalFactExtractionService; batchFactExtraction?: LocalFactExtractionBatchService; threads?: ThreadGraphService; brief?: AnalysisBriefService; conclusions?: ResearchConclusionService; falsification?: IndependentFalsificationService; dossier?: ResearchDossierService; workbench?: EvidenceWorkbenchService; mechanisms?: MechanismAssetService; planning?: StoryPlanningService; chapterApplications?: ChapterMechanismApplicationService; chapterOutcomes?: ChapterMechanismOutcomeService; mechanismEffectExperiments?: MechanismEffectExperimentService; mechanismEffectWriter?: MechanismEffectExperimentWriterService; mechanismEffectBlindReview?: MechanismEffectExperimentBlindReviewService; chapterMethodWorkbench?: ChapterMethodWorkbenchService; recipes?: CreativeRecipeService; manifests?: ChapterContextManifestService; readerManifests?: ChapterReaderManifestService; readers?: ChapterReaderService; reviewer?: ChapterReviewerService; reviews?: ChapterReviewService; editor?: ChapterEditorService; editorTasks?: ChapterEditorTaskService; production?: ChapterProductionCommitService; writer?: ChapterWriterService } = {}): Promise<unknown> {
  if (commandName === "get-workspace-status") return application.queries.getWorkspaceStatus();
  if (commandName === "get-capabilities") return application.queries.getCapabilities();
  if (commandName === "list-actionable-tasks") return application.queries.listActionableTasks();
  if (commandName === "get-task") return application.taskActions.get(requiredString(args, "taskId"));
  if (commandName === "wait-task") return application.taskActions.wait(requiredString(args, "taskId"), args.timeoutMs === undefined ? 30_000 : requiredIntegerInRange(args, "timeoutMs", 0, 30_000));
  if (commandName === "retry-task") return application.taskActions.retry(requiredString(args, "taskId"));
  if (commandName === "cancel-task") return application.taskActions.requestCancel(requiredString(args, "taskId"));
  if (commandName === "list-changes") {
    const after = requiredNonNegativeInteger(args, "after");
    const limit = args.limit === undefined ? undefined : requiredIntegerInRange(args, "limit", 1, 100);
    return application.queries.listChanges(after, limit);
  }
  if (commandName === "get-confirmation") return application.queries.getConfirmation(requiredString(args, "confirmationId"));
  if (commandName === "approve-confirmation") {
    return application.commands.approveConfirmation({
      confirmationId: requiredString(args, "confirmationId"),
      actor: { kind: "human_via_agent", id: "cli" },
      reason: requiredString(args, "reason"),
    });
  }
  if (commandName === "reject-confirmation") {
    return application.commands.rejectConfirmation({
      confirmationId: requiredString(args, "confirmationId"),
      actor: { kind: "human_via_agent", id: "cli" },
      reason: requiredString(args, "reason"),
    });
  }
  if (commandName === "get-novel-project") return application.queries.getNovelProject(requiredString(args, "projectId"));
  if (commandName === "list-novel-projects") return application.queries.listNovelProjects();
  if (commandName === "get-project-workbench") return application.queries.getProjectWorkbench(requiredString(args, "projectId"));
  if (commandName === "list-project-documents") return application.queries.listProjectDocuments(requiredString(args, "projectId"));
  if (commandName === "get-document") return application.queries.getProjectDocument({ projectId: requiredString(args, "projectId"), documentId: requiredString(args, "documentId") });
  if (commandName === "get-reference-workbench") return application.queries.getReferenceWorkbench(requiredString(args, "referenceWorkId"));
  if (commandName === "list-pending-mechanism-assets") return application.queries.listPendingMechanismAssets();
  if (commandName === "list-coverage-gaps") return application.queries.listCoverageGaps();
  if (commandName === "list-provider-profiles") return application.queries.listProviderProfiles();
  if (commandName === "get-workspace-settings") return application.queries.getWorkspaceSettings();
  if (commandName === "get-chapter-method-workbench") return requireChapterMethodWorkbenchService(dependencies.chapterMethodWorkbench).get({ projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  if (commandName === "get-chapter-mechanism-application") return requireChapterApplicationService(dependencies.chapterApplications).get({ projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  if (commandName === "save-chapter-mechanism-application") return requireChapterApplicationService(dependencies.chapterApplications).save({ command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), expectedRevision: args.expectedRevision === null ? null : requiredPositiveInteger(args, "expectedRevision"), application: requiredRecord(args, "application") as never });
  if (commandName === "get-chapter-mechanism-outcome") return requireChapterOutcomeService(dependencies.chapterOutcomes).get({ projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  if (commandName === "save-chapter-mechanism-outcome") return requireChapterOutcomeService(dependencies.chapterOutcomes).save({ command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), expectedRevision: args.expectedRevision === null ? null : requiredPositiveInteger(args, "expectedRevision"), outcome: requiredRecord(args, "outcome") as never });
  if (commandName === "save-mechanism-effect-experiment") return requireMechanismEffectExperimentService(dependencies.mechanismEffectExperiments).save({ command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), expectedRevision: args.expectedRevision === null ? null : requiredPositiveInteger(args, "expectedRevision"), experiment: requiredRecord(args, "experiment") as never });
  if (commandName === "get-mechanism-effect-experiment") return requireMechanismEffectExperimentService(dependencies.mechanismEffectExperiments).get({ projectId: requiredString(args, "projectId"), experimentId: requiredString(args, "experimentId") });
  if (commandName === "start-mechanism-effect-experiment-candidate") {
    const writer = requireMechanismEffectExperimentWriterService(dependencies.mechanismEffectWriter);
    const result = await writer.start({ command: planningCommand(args), projectId: requiredString(args, "projectId"), experimentId: requiredString(args, "experimentId"), pairId: requiredString(args, "pairId"), candidateId: requiredString(args, "candidateId"), sourceManifestId: requiredString(args, "sourceManifestId"), taskId: requiredString(args, "taskId"), title: requiredString(args, "title") });
    if (result.kind === "accepted" && await autoStartEnabled(application)) await writer.run(result.taskId);
    return result;
  }
  if (commandName === "resume-mechanism-effect-experiment-candidate") {
    const writer = requireMechanismEffectExperimentWriterService(dependencies.mechanismEffectWriter);
    const taskId = requiredString(args, "taskId");
    await writer.run(taskId);
    return writer.getTask(taskId);
  }
  if (commandName === "start-mechanism-effect-experiment-blind-review") {
    const blindReview = requireMechanismEffectExperimentBlindReviewService(dependencies.mechanismEffectBlindReview);
    const result = await blindReview.start({ command: planningCommand(args), projectId: requiredString(args, "projectId"), experimentId: requiredString(args, "experimentId"), pairId: requiredString(args, "pairId"), sourceManifestId: requiredString(args, "sourceManifestId"), taskId: requiredString(args, "taskId"), documentId: requiredString(args, "documentId"), title: requiredString(args, "title") });
    if (result.kind === "accepted" && await autoStartEnabled(application)) await blindReview.run(result.taskId);
    return result;
  }
  if (commandName === "resume-mechanism-effect-experiment-blind-review") {
    const blindReview = requireMechanismEffectExperimentBlindReviewService(dependencies.mechanismEffectBlindReview);
    const taskId = requiredString(args, "taskId");
    await blindReview.run(taskId);
    return blindReview.getTask(taskId);
  }
  if (commandName === "get-mechanism-effect-experiment-blind-review") return requireMechanismEffectExperimentBlindReviewService(dependencies.mechanismEffectBlindReview).getReport({ documentId: requiredString(args, "documentId") });
  if (commandName === "save-chapter-production-commit-proposal") return requireChapterProductionCommitService(dependencies.production).saveProposal({ command: planningCommand(args), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), expectedRevision: args.expectedRevision === null ? null : requiredPositiveInteger(args, "expectedRevision"), proposal: requiredRecord(args, "proposal") as never });
  if (commandName === "get-chapter-production-commit-proposal") return requireChapterProductionCommitService(dependencies.production).getProposal({ projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  if (commandName === "request-chapter-production-commit") return requireChapterProductionCommitService(dependencies.production).acceptProposal({ command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), proposalId: requiredString(args, "proposalId") });
  if (commandName === "list-pipeline-revisions") return application.pipelines.list();
  if (commandName === "save-pipeline-revision") {
    const steps = args.steps;
    if (!Array.isArray(steps)) throw new Error("steps 必须是数组。 ");
    const expectedRevision = args.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1)) throw new Error("expectedRevision 必须是正整数。 ");
    return application.pipelines.save({
      command: planningCommand(args),
      pipelineId: requiredString(args, "pipelineId"),
      name: requiredString(args, "name"),
      steps: steps as never,
      ...(typeof args.status === "string" ? { status: args.status } : {}),
      ...(expectedRevision === undefined ? {} : { expectedRevision: expectedRevision as number }),
    });
  }
  if (commandName === "start-pipeline-run") {
    return application.pipelineRuns.start({
      command: planningCommand(args),
      runId: requiredString(args, "runId"),
      pipelineId: requiredString(args, "pipelineId"),
      ...(typeof args.projectId === "string" ? { projectId: args.projectId } : {}),
    });
  }
  if (commandName === "list-pipeline-runs") {
    return application.pipelineRuns.list(args.limit === undefined ? 20 : requiredIntegerInRange(args, "limit", 1, 100));
  }
  if (commandName === "complete-pipeline-run-step") {
    return application.pipelineRuns.completeStep({
      command: planningCommand(args, "human_via_agent"),
      runId: requiredString(args, "runId"),
      stepId: requiredString(args, "stepId"),
      note: requiredString(args, "note"),
    });
  }
  if (commandName === "save-workspace-settings") {
    const expectedRevision = args.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1)) throw new Error("expectedRevision 必须是正整数。 ");
    return application.commands.execute({
      schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" },
      ...(expectedRevision === undefined ? {} : { expectedRevision: expectedRevision as number }), tool: "save_workspace_settings",
      args: {
        automationMode: requiredString(args, "automationMode"),
        contextWindowTokens: requiredIntegerInRange(args, "contextWindowTokens", 1024, 1_000_000),
        maxOutputTokens: requiredIntegerInRange(args, "maxOutputTokens", 256, 999_999),
        safetyMarginRatio: requiredRatio(args, "safetyMarginRatio"),
        cloudEscalation: requiredString(args, "cloudEscalation"),
      }, createdAt: Date.now(),
    });
  }
  if (commandName === "save-provider-profile") {
    const expectedRevision = args.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1)) throw new Error("expectedRevision 必须是正整数。 ");
    const commandId = requiredString(args, "commandId");
    return application.commands.execute({
      schemaVersion: 1, commandId, idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" },
      ...(expectedRevision === undefined ? {} : { expectedRevision: expectedRevision as number }), tool: "save_provider_profile",
      args: { providerProfileId: requiredString(args, "providerProfileId"), name: requiredString(args, "name"), baseURL: requiredString(args, "baseURL"), protocol: requiredString(args, "protocol"), defaultModel: requiredString(args, "defaultModel"), contextWindowTokens: requiredIntegerInRange(args, "contextWindowTokens", 1024, 1_000_000), maxOutputTokens: requiredIntegerInRange(args, "maxOutputTokens", 256, 999_999), safetyMarginRatio: requiredRatio(args, "safetyMarginRatio"), routes: requiredRecords(args, "routes") }, createdAt: Date.now(),
    });
  }
  if (commandName === "create-novel-project") {
    const payload = record(args.payload);
    if (!payload) throw new Error("payload 必须是对象");
    const command: CommandEnvelope = {
      schemaVersion: 1,
      commandId: requiredString(args, "commandId"),
      idempotencyKey: requiredString(args, "idempotencyKey"),
      correlationId: requiredString(args, "correlationId"),
      actor: { kind: "external_agent", id: "cli" },
      tool: "create_novel_project",
      args: { projectId: requiredString(args, "projectId"), title: requiredString(args, "title"), status: requiredString(args, "status"), payload },
      createdAt: Date.now(),
    };
    return application.commands.execute(command);
  }
  if (commandName === "create-local-draft") {
    const creation = dependencies.creation;
    if (!creation) throw new Error("当前 CLI 未配置本地创作服务。");
    const result = await creation.start({
      command: {
        schemaVersion: 1,
        commandId: requiredString(args, "commandId"),
        idempotencyKey: requiredString(args, "idempotencyKey"),
        correlationId: requiredString(args, "correlationId"),
        actor: { kind: "external_agent", id: "cli" },
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
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await creation.run(result.taskId);
    return { command: result, task: await creation.getTask(result.taskId), draft: await creation.getDraft(requiredString(args, "documentId")) };
  }
  if (commandName === "resume-local-creation") {
    const creation = dependencies.creation;
    if (!creation) throw new Error("当前 CLI 未配置本地创作服务。");
    const taskId = requiredString(args, "taskId");
    await creation.run(taskId);
    return creation.getTask(taskId);
  }
  if (commandName === "create-workspace-backup") {
    const maintenance = requireWorkspaceMaintenanceService(dependencies.maintenance);
    const result = await maintenance.startBackup({
      command: planningCommand(args), taskId: requiredString(args, "taskId"), backupId: requiredString(args, "backupId"),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await maintenance.run(result.taskId);
    return { command: result, task: await maintenance.getTask(result.taskId) };
  }
  if (commandName === "restore-workspace-backup") {
    const maintenance = requireWorkspaceMaintenanceService(dependencies.maintenance);
    const result = await maintenance.startRestore({
      command: planningCommand(args), taskId: requiredString(args, "taskId"), backupId: requiredString(args, "backupId"), restoreId: requiredString(args, "restoreId"),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await maintenance.run(result.taskId);
    return { command: result, task: await maintenance.getTask(result.taskId) };
  }
  if (commandName === "resume-workspace-maintenance") {
    const maintenance = requireWorkspaceMaintenanceService(dependencies.maintenance);
    const taskId = requiredString(args, "taskId");
    await maintenance.run(taskId);
    return maintenance.getTask(taskId);
  }
  if (commandName === "export-project") {
    const exporter = requireWorkspaceExportService(dependencies.exporter);
    const result = await exporter.startProjectExport({
      command: planningCommand(args), taskId: requiredString(args, "taskId"), projectId: requiredString(args, "projectId"), exportId: requiredString(args, "exportId"),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await exporter.run(result.taskId);
    return { command: result, task: await exporter.getTask(result.taskId) };
  }
  if (commandName === "export-analysis") {
    const exporter = requireWorkspaceExportService(dependencies.exporter);
    const result = await exporter.startAnalysisExport({
      command: planningCommand(args), taskId: requiredString(args, "taskId"), referenceWorkId: requiredString(args, "referenceWorkId"), exportId: requiredString(args, "exportId"),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await exporter.run(result.taskId);
    return { command: result, task: await exporter.getTask(result.taskId) };
  }
  if (commandName === "resume-workspace-export") {
    const exporter = requireWorkspaceExportService(dependencies.exporter);
    const taskId = requiredString(args, "taskId");
    await exporter.run(taskId);
    return exporter.getTask(taskId);
  }
  if (commandName === "get-local-creation-draft") {
    const creation = dependencies.creation;
    if (!creation) throw new Error("当前 CLI 未配置本地创作服务。");
    return creation.getDraft(requiredString(args, "documentId"));
  }
  if (commandName === "list-reference-works") {
    const references = requireReferenceService(dependencies.references);
    return references.listReferenceWorks();
  }
  if (commandName === "get-reference-work") {
    const references = requireReferenceService(dependencies.references);
    return references.getReferenceWork(requiredString(args, "referenceWorkId"));
  }
  if (commandName === "import-reference-text") {
    const references = requireReferenceService(dependencies.references);
    return references.importText({
      command: {
        schemaVersion: 1,
        commandId: requiredString(args, "commandId"),
        idempotencyKey: requiredString(args, "idempotencyKey"),
        correlationId: requiredString(args, "correlationId"),
      actor: { kind: "external_agent", id: "cli" },
        createdAt: Date.now(),
      },
      referenceWorkId: requiredString(args, "referenceWorkId"),
      sourceEditionId: requiredString(args, "sourceEditionId"),
      title: requiredString(args, "title"),
      text: requiredString(args, "text"),
    });
  }
  if (commandName === "import-reference-file") {
    const files = requireReferenceFileImportService(dependencies.referenceFileImport);
    const result = await files.start({
      command: planningCommand(args),
      taskId: requiredString(args, "taskId"),
      referenceWorkId: requiredString(args, "referenceWorkId"),
      sourceEditionId: requiredString(args, "sourceEditionId"),
      title: requiredString(args, "title"),
      sourcePath: requiredString(args, "sourcePath"),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await files.run(result.taskId);
    return { command: result, task: await files.getTask(result.taskId) };
  }
  if (commandName === "resume-reference-file-import") {
    const files = requireReferenceFileImportService(dependencies.referenceFileImport);
    const taskId = requiredString(args, "taskId");
    await files.run(taskId);
    return files.getTask(taskId);
  }
  if (commandName === "find-source-text") {
    const references = requireReferenceService(dependencies.references);
    return references.findText({
      sourceEditionId: requiredString(args, "sourceEditionId"),
      query: requiredString(args, "query"),
      limit: args.limit === undefined ? 10 : requiredIntegerInRange(args, "limit", 1, 50),
    });
  }
  if (commandName === "get-source-excerpt") {
    const references = requireReferenceService(dependencies.references);
    return references.getExcerpt({
      sourceEditionId: requiredString(args, "sourceEditionId"),
      startByte: requiredNonNegativeInteger(args, "startByte"),
      endByte: requiredNonNegativeInteger(args, "endByte"),
    });
  }
  if (commandName === "prepare-analysis-corpus") {
    const corpus = requireCorpusService(dependencies.corpus);
    const budget = record(args.budget);
    if (!budget) throw new Error("budget 必须是对象");
    const boundary = args.boundary;
    if (boundary !== "complete" && boundary !== "volume" && boundary !== "fragment") throw new Error("boundary 非法");
    return corpus.prepare({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "human_via_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      segmentationId: requiredString(args, "segmentationId"),
      sourceEditionId: requiredString(args, "sourceEditionId"),
      boundary,
      ...(args.byteRange === undefined ? {} : { byteRange: requiredByteRange(args, "byteRange") }),
      budget: {
        contextWindowTokens: requiredIntegerInRange(budget, "contextWindowTokens", 1, Number.MAX_SAFE_INTEGER),
        safetyMarginRatio: requiredRatio(budget, "safetyMarginRatio"),
        reservedOutputTokens: requiredNonNegativeInteger(budget, "reservedOutputTokens"),
        renderedSystemPromptTokens: requiredNonNegativeInteger(budget, "renderedSystemPromptTokens"),
        renderedSchemaTokens: requiredNonNegativeInteger(budget, "renderedSchemaTokens"),
        envelopeTokens: requiredNonNegativeInteger(budget, "envelopeTokens"),
      },
    });
  }
  if (commandName === "get-analysis-overview") return requireCorpusService(dependencies.corpus).getOverview(requiredString(args, "analysisProjectId"));
  if (commandName === "get-source-span") return requireCorpusService(dependencies.corpus).getSourceSpan(requiredString(args, "spanId"));
  if (commandName === "create-structural-reading-map") {
    return requireReadingMapService(dependencies.maps).create({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
    });
  }
  if (commandName === "get-structural-reading-map") return requireReadingMapService(dependencies.maps).get(requiredString(args, "analysisProjectId"));
  if (commandName === "submit-analysis-facts") {
    return requireFactService(dependencies.facts).submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      analysisUnitId: requiredString(args, "analysisUnitId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (commandName === "get-fact-ledger") return requireFactService(dependencies.facts).getFactLedger(requiredString(args, "analysisProjectId"), requiredString(args, "analysisUnitId"));
  if (commandName === "extract-local-facts") {
    const extraction = requireFactExtractionService(dependencies.factExtraction);
    const result = await extraction.start({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"),
      analysisProjectId: requiredString(args, "analysisProjectId"),
      analysisUnitId: requiredString(args, "analysisUnitId"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await extraction.run(result.taskId);
    return { command: result, task: await extraction.getTask(result.taskId) };
  }
  if (commandName === "resume-local-fact-extraction") {
    const extraction = requireFactExtractionService(dependencies.factExtraction);
    const taskId = requiredString(args, "taskId");
    await extraction.run(taskId);
    return extraction.getTask(taskId);
  }
  if (commandName === "reconfigure-local-facts") {
    const extraction = requireFactExtractionService(dependencies.factExtraction);
    const result = await extraction.reconfigure({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"),
      baseURL: configuredBaseURL(args),
      model: configuredModel(args),
      ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await extraction.run(result.taskId);
    return { command: result, task: await extraction.getTask(result.taskId) };
  }
  if (commandName === "extract-local-facts-batch") {
    const extraction = requireFactExtractionBatchService(dependencies.batchFactExtraction);
    const result = await extraction.start({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      taskId: requiredString(args, "taskId"), analysisProjectId: requiredString(args, "analysisProjectId"), baseURL: configuredBaseURL(args), model: configuredModel(args),
      ...(args.maxTokens === undefined ? {} : { maxTokens: requiredIntegerInRange(args, "maxTokens", 256, 16_384) }),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await extraction.run(result.taskId);
    return { command: result, task: await extraction.getTask(result.taskId) };
  }
  if (commandName === "resume-local-fact-extraction-batch") {
    const extraction = requireFactExtractionBatchService(dependencies.batchFactExtraction);
    const taskId = requiredString(args, "taskId");
    await extraction.run(taskId);
    return extraction.getTask(taskId);
  }
  if (commandName === "submit-thread-graph") {
    return requireThreadGraphService(dependencies.threads).submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (commandName === "get-thread-graph") return requireThreadGraphService(dependencies.threads).getThreads(requiredString(args, "analysisProjectId"));
  if (commandName === "submit-analysis-brief") {
    return requireAnalysisBriefService(dependencies.brief).submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (commandName === "get-analysis-brief") return requireAnalysisBriefService(dependencies.brief).get(requiredString(args, "analysisProjectId"));
  if (commandName === "approve-analysis-brief") {
    return requireAnalysisBriefService(dependencies.brief).approve({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "human_via_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
    });
  }
  if (commandName === "submit-research-conclusions") {
    return requireResearchConclusionService(dependencies.conclusions).submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      researchQuestionId: requiredString(args, "researchQuestionId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (commandName === "get-research-conclusions") return requireResearchConclusionService(dependencies.conclusions).getByQuestion(requiredString(args, "analysisProjectId"), requiredString(args, "researchQuestionId"));
  if (commandName === "get-falsification-work-item") return requireIndependentFalsificationService(dependencies.falsification).getWorkItem(requiredString(args, "analysisProjectId"), requiredString(args, "conclusionId"));
  if (commandName === "submit-independent-falsification") {
    return requireIndependentFalsificationService(dependencies.falsification).submit({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "external_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      conclusionId: requiredString(args, "conclusionId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (commandName === "get-independent-falsification") return requireIndependentFalsificationService(dependencies.falsification).getByConclusion(requiredString(args, "analysisProjectId"), requiredString(args, "conclusionId"));
  if (commandName === "create-research-dossier") {
    return requireResearchDossierService(dependencies.dossier).create({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "human_via_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
    });
  }
  if (commandName === "get-research-dossier") return requireResearchDossierService(dependencies.dossier).getLatest(requiredString(args, "analysisProjectId"));
  if (commandName === "get-analysis-evidence") {
    return requireEvidenceWorkbenchService(dependencies.workbench).getEvidence({
      analysisProjectId: requiredString(args, "analysisProjectId"),
      ...(args.researchQuestionId === undefined ? {} : { researchQuestionId: requiredString(args, "researchQuestionId") }),
      ...(args.conclusionId === undefined ? {} : { conclusionId: requiredString(args, "conclusionId") }),
      ...(args.spanId === undefined ? {} : { spanId: requiredString(args, "spanId") }),
    });
  }
  if (commandName === "list-analysis-coverage") {
    return requireEvidenceWorkbenchService(dependencies.workbench).listCoverage({
      analysisProjectId: requiredString(args, "analysisProjectId"),
      ...(args.module === undefined ? {} : { module: requiredString(args, "module") }),
      ...(args.analysisUnitId === undefined ? {} : { analysisUnitId: requiredString(args, "analysisUnitId") }),
    });
  }
  if (commandName === "propose-mechanism-candidate") {
    return requireMechanismAssetService(dependencies.mechanisms).propose({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "human_via_agent", id: "cli" }, createdAt: Date.now() },
      analysisProjectId: requiredString(args, "analysisProjectId"),
      rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (commandName === "list-mechanism-candidates") return requireMechanismAssetService(dependencies.mechanisms).listCandidates(args.analysisProjectId === undefined ? undefined : requiredString(args, "analysisProjectId"));
  if (commandName === "get-mechanism-asset") return requireMechanismAssetService(dependencies.mechanisms).get(requiredString(args, "mechanismAssetId"));
  if (commandName === "review-mechanism-asset") {
    const status = requiredString(args, "status");
    if (status !== "adopted" && status !== "editor_only" && status !== "rejected") throw new Error("status 必须为 adopted、editor_only 或 rejected");
    return requireMechanismAssetService(dependencies.mechanisms).review({
      command: { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind: "human_via_agent", id: "cli" }, projectId: requiredString(args, "projectId"), expectedRevision: requiredIntegerInRange(args, "expectedRevision", 1, Number.MAX_SAFE_INTEGER), createdAt: Date.now() },
      mechanismAssetId: requiredString(args, "mechanismAssetId"), status,
    });
  }
  if (commandName === "list-adopted-mechanisms") return requireMechanismAssetService(dependencies.mechanisms).listAdopted(requiredString(args, "projectId"));
  if (commandName === "list-project-planning-documents") return requireStoryPlanningService(dependencies.planning).listDocuments(requiredString(args, "projectId"));
  if (commandName === "save-project-intent") {
    return requireStoryPlanningService(dependencies.planning).saveProjectIntent({ command: planningCommand(args), projectId: requiredString(args, "projectId"), intent: requiredRecord(args, "intent") });
  }
  if (commandName === "submit-story-concepts") {
    return requireStoryPlanningService(dependencies.planning).submitStoryConcepts({ command: planningCommand(args), projectId: requiredString(args, "projectId"), rawOutput: requiredString(args, "rawOutput") });
  }
  if (commandName === "select-story-concept") {
    return requireStoryPlanningService(dependencies.planning).selectStoryConcept({ command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), conceptId: requiredString(args, "conceptId") });
  }
  if (commandName === "review-project-planning-document") {
    const status = requiredString(args, "status");
    if (status !== "approved" && status !== "rejected") throw new Error("status 必须为 approved 或 rejected");
    return requireStoryPlanningService(dependencies.planning).reviewDocument({
      command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), documentId: requiredString(args, "documentId"),
      expectedRevision: requiredIntegerInRange(args, "expectedRevision", 1, Number.MAX_SAFE_INTEGER), status,
    });
  }
  if (commandName === "save-story-contract") {
    return requireStoryPlanningService(dependencies.planning).saveStoryContract({ command: planningCommand(args), projectId: requiredString(args, "projectId"), contract: requiredRecord(args, "contract") });
  }
  if (commandName === "save-story-system") {
    return requireStoryPlanningService(dependencies.planning).saveStorySystem({ command: planningCommand(args), projectId: requiredString(args, "projectId"), system: requiredRecord(args, "system") });
  }
  if (commandName === "save-book-outline") {
    return requireStoryPlanningService(dependencies.planning).saveBookOutline({ command: planningCommand(args), projectId: requiredString(args, "projectId"), outline: requiredRecord(args, "outline") });
  }
  if (commandName === "save-stage-plan") {
    return requireStoryPlanningService(dependencies.planning).saveStagePlan({ command: planningCommand(args), projectId: requiredString(args, "projectId"), stage: requiredRecord(args, "stage") });
  }
  if (commandName === "save-chapter-contract") {
    return requireStoryPlanningService(dependencies.planning).saveChapterContract({ command: planningCommand(args), projectId: requiredString(args, "projectId"), contract: requiredRecord(args, "contract") });
  }
  if (commandName === "create-creative-recipe") {
    return requireCreativeRecipeService(dependencies.recipes).create({ command: planningCommand(args), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  }
  if (commandName === "get-creative-recipe") {
    return requireCreativeRecipeService(dependencies.recipes).get({ projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  }
  if (commandName === "freeze-chapter-context-manifest") {
    return requireChapterContextManifestService(dependencies.manifests).freeze({
      command: planningCommand(args), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), manifestId: requiredString(args, "manifestId"), tokenBudget: requiredIntegerInRange(args, "tokenBudget", 2, Number.MAX_SAFE_INTEGER), reservedOutputTokens: requiredIntegerInRange(args, "reservedOutputTokens", 1, Number.MAX_SAFE_INTEGER),
    });
  }
  if (commandName === "get-chapter-context-manifest") {
    return requireChapterContextManifestService(dependencies.manifests).get({ projectId: requiredString(args, "projectId"), manifestId: requiredString(args, "manifestId") });
  }
  if (commandName === "freeze-chapter-reader-manifest") {
    const readerKind = requiredString(args, "readerKind");
    if (readerKind !== "immersive" && readerKind !== "low_patience" && readerKind !== "logic_sensitive") throw new Error("readerKind 非法");
    return requireChapterReaderManifestService(dependencies.readerManifests).freeze({
      command: planningCommand(args), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), draftDocumentId: requiredString(args, "draftDocumentId"), manifestId: requiredString(args, "manifestId"), readerKind, tokenBudget: requiredIntegerInRange(args, "tokenBudget", 2, Number.MAX_SAFE_INTEGER),
    });
  }
  if (commandName === "get-chapter-reader-manifest") {
    return requireChapterReaderManifestService(dependencies.readerManifests).get({ projectId: requiredString(args, "projectId"), manifestId: requiredString(args, "manifestId") });
  }
  if (commandName === "create-chapter-reader") {
    const readers = requireChapterReaderService(dependencies.readers);
    const result = await readers.start({
      command: planningCommand(args), taskId: requiredString(args, "taskId"), documentId: requiredString(args, "documentId"), reportId: requiredString(args, "reportId"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), manifestId: requiredString(args, "manifestId"), title: requiredString(args, "title"), baseURL: configuredBaseURL(args), model: configuredModel(args), ...(args.maxTokens === undefined ? {} : { maxTokens: requiredIntegerInRange(args, "maxTokens", 256, 16_384) }),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await readers.run(result.taskId);
    return { command: result, task: await readers.getTask(result.taskId), feedback: await readers.getReport({ documentId: requiredString(args, "documentId") }) };
  }
  if (commandName === "get-chapter-reader-feedback") {
    return requireChapterReaderService(dependencies.readers).getReport({ documentId: requiredString(args, "documentId") });
  }
  if (commandName === "create-chapter-reviewer") {
    const reviewer = requireChapterReviewerService(dependencies.reviewer);
    const result = await reviewer.start({
      command: planningCommand(args), taskId: requiredString(args, "taskId"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"),
      draftDocumentId: requiredString(args, "draftDocumentId"), reviewId: requiredString(args, "reviewId"), readerManifestIds: requiredStrings(args, "readerManifestIds"), readerFeedbackDocumentIds: requiredStrings(args, "readerFeedbackDocumentIds"),
      title: requiredString(args, "title"), baseURL: configuredBaseURL(args), model: configuredModel(args), ...(args.maxTokens === undefined ? {} : { maxTokens: requiredIntegerInRange(args, "maxTokens", 256, 16_384) }),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await reviewer.run(result.taskId);
    return { command: result, task: await reviewer.getTask(result.taskId), review: await reviewer.getReview({ projectId: requiredString(args, "projectId"), reviewId: requiredString(args, "reviewId") }) };
  }
  if (commandName === "get-chapter-reviewer-review") {
    return requireChapterReviewerService(dependencies.reviewer).getReview({ projectId: requiredString(args, "projectId"), reviewId: requiredString(args, "reviewId") });
  }
  if (commandName === "submit-chapter-review") {
    return requireChapterReviewService(dependencies.reviews).submit({
      command: planningCommand(args), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), draftDocumentId: requiredString(args, "draftDocumentId"), reviewId: requiredString(args, "reviewId"), readerManifestIds: requiredStrings(args, "readerManifestIds"), readerFeedbackDocumentIds: requiredStrings(args, "readerFeedbackDocumentIds"), rawOutput: requiredString(args, "rawOutput"),
    });
  }
  if (commandName === "get-chapter-review") {
    return requireChapterReviewService(dependencies.reviews).get({ projectId: requiredString(args, "projectId"), reviewId: requiredString(args, "reviewId") });
  }
  if (commandName === "create-chapter-editor-draft") {
    const command = planningCommand(args);
    return requireChapterEditorService(dependencies.editor).create({
      command, executionRef: command.commandId, projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), documentId: requiredString(args, "documentId"), title: requiredString(args, "title"), sourceDraftDocumentId: requiredString(args, "sourceDraftDocumentId"), reviewId: requiredString(args, "reviewId"), selectedIssueIds: requiredStrings(args, "selectedIssueIds"), editedText: requiredString(args, "editedText"), rationale: requiredString(args, "rationale"),
    });
  }
  if (commandName === "get-chapter-editor-draft") {
    return requireChapterEditorService(dependencies.editor).getDraft(requiredString(args, "documentId"));
  }
  if (commandName === "create-chapter-editor") {
    const editorTasks = requireChapterEditorTaskService(dependencies.editorTasks);
    const result = await editorTasks.start({
      command: planningCommand(args), taskId: requiredString(args, "taskId"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), title: requiredString(args, "title"),
      targetDocumentId: requiredString(args, "targetDocumentId"), sourceDraftDocumentId: requiredString(args, "sourceDraftDocumentId"), reviewId: requiredString(args, "reviewId"), selectedIssueIds: requiredStrings(args, "selectedIssueIds"), rationale: requiredString(args, "rationale"),
      baseURL: configuredBaseURL(args), model: configuredModel(args), ...(args.maxTokens === undefined ? {} : { maxTokens: requiredIntegerInRange(args, "maxTokens", 256, 16_384) }),
    });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await editorTasks.run(result.taskId);
    return { command: result, task: await editorTasks.getTask(result.taskId), draft: await editorTasks.getDraft(requiredString(args, "targetDocumentId")) };
  }
  if (commandName === "resume-chapter-editor") {
    const editorTasks = requireChapterEditorTaskService(dependencies.editorTasks);
    const taskId = requiredString(args, "taskId");
    await editorTasks.run(taskId);
    return editorTasks.getTask(taskId);
  }
  if (commandName === "commit-chapter") {
    return requireChapterProductionCommitService(dependencies.production).acceptDraft({
      command: planningCommand(args, "human_via_agent"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), chapterOrdinal: requiredIntegerInRange(args, "chapterOrdinal", 1, Number.MAX_SAFE_INTEGER), productionCommitId: requiredString(args, "productionCommitId"), draftDocumentId: requiredString(args, "draftDocumentId"), chapterDelta: requiredRecord(args, "chapterDelta"), canonPatches: requiredRecords(args, "canonPatches") as unknown as CanonPatch[], characterKnowledgePatches: requiredRecords(args, "characterKnowledgePatches") as unknown as CharacterKnowledgePatch[], readerState: requiredRecord(args, "readerState") as { readerStateId: string; payload: Record<string, unknown> }, readerPromiseUpdates: requiredRecords(args, "readerPromiseUpdates") as unknown as ReaderPromisePatch[], outlineDrift: requiredRecord(args, "outlineDrift") as { payload: Record<string, unknown> },
    });
  }
  if (commandName === "get-accepted-chapter") {
    return requireChapterProductionCommitService(dependencies.production).getAcceptedChapter({ projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId") });
  }
  if (commandName === "create-chapter-writer-v1") {
    const writer = requireChapterWriterService(dependencies.writer);
    const result = await writer.start({ command: planningCommand(args), taskId: requiredString(args, "taskId"), documentId: requiredString(args, "documentId"), projectId: requiredString(args, "projectId"), chapterId: requiredString(args, "chapterId"), manifestId: requiredString(args, "manifestId"), title: requiredString(args, "title"), baseURL: configuredBaseURL(args), model: configuredModel(args), ...(args.maxTokens === undefined ? {} : { maxTokens: requiredIntegerInRange(args, "maxTokens", 256, 16_384) }) });
    if (result.kind !== "accepted") return result;
    if (await autoStartEnabled(application)) await writer.run(result.taskId);
    return { command: result, task: await writer.getTask(result.taskId), draft: await writer.getDraft({ documentId: requiredString(args, "documentId") }) };
  }
  if (commandName === "get-chapter-writer-draft") {
    return requireChapterWriterService(dependencies.writer).getDraft({ documentId: requiredString(args, "documentId") });
  }
  throw new Error(`未知 CLI 命令：${commandName}`);
}

function planningCommand(args: Record<string, unknown>, kind: "external_agent" | "human_via_agent" = "external_agent"): Omit<CommandEnvelope, "tool" | "args"> {
  return { schemaVersion: 1, commandId: requiredString(args, "commandId"), idempotencyKey: requiredString(args, "idempotencyKey"), correlationId: requiredString(args, "correlationId"), actor: { kind, id: "cli" }, createdAt: Date.now() };
}

async function autoStartEnabled(application: WorkspaceApplicationService): Promise<boolean> {
  return shouldAutoStartTask((await application.queries.getWorkspaceSettings()).automationMode);
}

function requireChapterReaderManifestService(service: ChapterReaderManifestService | undefined): ChapterReaderManifestService {
  if (!service) throw new Error("当前 CLI 未配置 ChapterReaderManifest 服务。 ");
  return service;
}

function requireChapterApplicationService(service: ChapterMechanismApplicationService | undefined): ChapterMechanismApplicationService {
  if (!service) throw new Error("当前 CLI 未配置本章采用记录服务。 ");
  return service;
}

function requireChapterOutcomeService(service: ChapterMechanismOutcomeService | undefined): ChapterMechanismOutcomeService {
  if (!service) throw new Error("当前 CLI 未配置本章应用结果服务。 ");
  return service;
}

function requireMechanismEffectExperimentService(service: MechanismEffectExperimentService | undefined): MechanismEffectExperimentService {
  if (!service) throw new Error("机制效用实验服务未配置。 ");
  return service;
}

function requireMechanismEffectExperimentWriterService(service: MechanismEffectExperimentWriterService | undefined): MechanismEffectExperimentWriterService {
  if (!service) throw new Error("机制效用实验 Writer 未配置。 ");
  return service;
}

function requireMechanismEffectExperimentBlindReviewService(service: MechanismEffectExperimentBlindReviewService | undefined): MechanismEffectExperimentBlindReviewService {
  if (!service) throw new Error("机制效用实验盲评未配置。 ");
  return service;
}

function requireChapterMethodWorkbenchService(service: ChapterMethodWorkbenchService | undefined): ChapterMethodWorkbenchService {
  if (!service) throw new Error("当前 CLI 未配置章节方法工作台服务。 ");
  return service;
}

function requireChapterReviewService(service: ChapterReviewService | undefined): ChapterReviewService {
  if (!service) throw new Error("当前 CLI 未配置 ChapterReview 服务。 ");
  return service;
}

function requireChapterEditorService(service: ChapterEditorService | undefined): ChapterEditorService {
  if (!service) throw new Error("当前 CLI 未配置 ChapterEditor 服务。 ");
  return service;
}

function requireChapterEditorTaskService(service: ChapterEditorTaskService | undefined): ChapterEditorTaskService {
  if (!service) throw new Error("当前 CLI 未配置 ChapterEditorTask 服务。 ");
  return service;
}

function requireChapterReaderService(service: ChapterReaderService | undefined): ChapterReaderService {
  if (!service) throw new Error("当前 CLI 未配置 ChapterReader 服务。 ");
  return service;
}

function requireChapterReviewerService(service: ChapterReviewerService | undefined): ChapterReviewerService {
  if (!service) throw new Error("当前 CLI 未配置 ChapterReviewer 服务。 ");
  return service;
}

function requiredRecord(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record(args[key]);
  if (!value) throw new Error(`${key} 必须是对象`);
  return value;
}

function requiredRecords(args: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => !record(item))) throw new Error(`${key} 必须是对象数组`);
  return value as Record<string, unknown>[];
}

function requiredStrings(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${key} 必须是非空字符串数组`);
  return value as string[];
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 必须是非空字符串`);
  return value;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredNonNegativeInteger(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${key} 必须是非负整数`);
  return value as number;
}

function requiredPositiveInteger(args: Record<string, unknown>, key: string): number {
  const value = requiredNonNegativeInteger(args, key);
  if (value < 1) throw new Error(`${key} 必须是正整数`);
  return value;
}

function requiredByteRange(args: Record<string, unknown>, key: string): { startByte: number; endByte: number } {
  const value = record(args[key]);
  if (!value) throw new Error(`${key} 必须是对象`);
  const startByte = requiredNonNegativeInteger(value, "startByte");
  const endByte = requiredNonNegativeInteger(value, "endByte");
  if (endByte <= startByte) throw new Error(`${key}.endByte 必须大于 startByte`);
  return { startByte, endByte };
}

function requiredIntegerInRange(args: Record<string, unknown>, key: string, minimum: number, maximum: number): number {
  const value = args[key];
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${key} 必须介于 ${minimum} 和 ${maximum}`);
  return value as number;
}

function requireReferenceService(references: ReferenceImportService | undefined): ReferenceImportService {
  if (!references) throw new Error("当前 CLI 未配置参考文本服务。");
  return references;
}

function requireReferenceFileImportService(service: ReferenceFileImportService | undefined): ReferenceFileImportService {
  if (!service) throw new Error("当前 CLI 未配置参考文件导入服务。");
  return service;
}

function requireCorpusService(corpus: AnalysisCorpusService | undefined): AnalysisCorpusService {
  if (!corpus) throw new Error("当前 CLI 未配置 AnalysisCorpus 服务。");
  return corpus;
}

function requireFactService(facts: AnalysisFactService | undefined): AnalysisFactService {
  if (!facts) throw new Error("当前 CLI 未配置 FactLedger 服务。");
  return facts;
}

function requireReadingMapService(maps: StructuralReadingMapService | undefined): StructuralReadingMapService {
  if (!maps) throw new Error("当前 CLI 未配置 ReadingMap 服务。");
  return maps;
}

function requireFactExtractionService(extraction: LocalFactExtractionService | undefined): LocalFactExtractionService {
  if (!extraction) throw new Error("当前 CLI 未配置本地 FactExtractor 服务。");
  return extraction;
}

function requireFactExtractionBatchService(extraction: LocalFactExtractionBatchService | undefined): LocalFactExtractionBatchService {
  if (!extraction) throw new Error("当前 CLI 未配置本地 FactExtractor 批服务。 ");
  return extraction;
}

function requireThreadGraphService(threads: ThreadGraphService | undefined): ThreadGraphService {
  if (!threads) throw new Error("当前 CLI 未配置 ThreadGraph 服务。");
  return threads;
}

function requireAnalysisBriefService(brief: AnalysisBriefService | undefined): AnalysisBriefService {
  if (!brief) throw new Error("当前 CLI 未配置 AnalysisBrief 服务。");
  return brief;
}

function requireResearchConclusionService(conclusions: ResearchConclusionService | undefined): ResearchConclusionService {
  if (!conclusions) throw new Error("当前 CLI 未配置 ResearchConclusion 服务。");
  return conclusions;
}

function requireIndependentFalsificationService(falsification: IndependentFalsificationService | undefined): IndependentFalsificationService {
  if (!falsification) throw new Error("当前 CLI 未配置 IndependentFalsification 服务。");
  return falsification;
}

function requireResearchDossierService(dossier: ResearchDossierService | undefined): ResearchDossierService {
  if (!dossier) throw new Error("当前 CLI 未配置 ResearchDossier 服务。");
  return dossier;
}

function requireEvidenceWorkbenchService(workbench: EvidenceWorkbenchService | undefined): EvidenceWorkbenchService {
  if (!workbench) throw new Error("当前 CLI 未配置 EvidenceWorkbench 服务。");
  return workbench;
}

function requireMechanismAssetService(mechanisms: MechanismAssetService | undefined): MechanismAssetService {
  if (!mechanisms) throw new Error("当前 CLI 未配置 MechanismAsset 服务。");
  return mechanisms;
}

function requireStoryPlanningService(planning: StoryPlanningService | undefined): StoryPlanningService {
  if (!planning) throw new Error("当前 CLI 未配置 StoryPlanning 服务。");
  return planning;
}

function requireCreativeRecipeService(recipes: CreativeRecipeService | undefined): CreativeRecipeService {
  if (!recipes) throw new Error("当前 CLI 未配置 CreativeRecipe 服务。");
  return recipes;
}

function requireChapterContextManifestService(manifests: ChapterContextManifestService | undefined): ChapterContextManifestService {
  if (!manifests) throw new Error("当前 CLI 未配置 ChapterContextManifest 服务。");
  return manifests;
}

function requireChapterProductionCommitService(production: ChapterProductionCommitService | undefined): ChapterProductionCommitService {
  if (!production) throw new Error("当前 CLI 未配置 ChapterProductionCommit 服务。");
  return production;
}

function requireWorkspaceMaintenanceService(maintenance: WorkspaceMaintenanceService | undefined): WorkspaceMaintenanceService {
  if (!maintenance) throw new Error("当前 CLI 未配置工作区备份恢复服务。 ");
  return maintenance;
}

function requireWorkspaceExportService(exporter: WorkspaceExportService | undefined): WorkspaceExportService {
  if (!exporter) throw new Error("当前 CLI 未配置工作区导出服务。 ");
  return exporter;
}

function requireChapterWriterService(writer: ChapterWriterService | undefined): ChapterWriterService {
  if (!writer) throw new Error("当前 CLI 未配置 ChapterWriter 服务。");
  return writer;
}

function requiredRatio(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) throw new Error(`${key} 必须在 [0, 1) 内`);
  return value;
}

/** Runtime ModelResolver replaces these compatibility values before a task is
 * persisted. Explicit values stay supported for older hosts and test harnesses. */
function configuredBaseURL(args: Record<string, unknown>): string {
  const value = args.baseURL;
  return typeof value === "string" && value.trim() ? value.trim() : "http://configured-route.invalid/v1";
}

function configuredModel(args: Record<string, unknown>): string {
  const value = args.model;
  return typeof value === "string" && value.trim() ? value.trim() : "configured-route";
}
