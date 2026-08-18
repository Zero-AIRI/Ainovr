import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeWorkspaceCli } from "@/cli/workspace-cli";
import { createLocalCreationService } from "@/application/local-creation-service";
import { createReferenceImportService } from "@/application/reference-import-service";
import { createAnalysisCorpusService } from "@/application/analysis-corpus-service";
import { createAnalysisFactService } from "@/application/analysis-fact-service";
import { createStructuralReadingMapService } from "@/application/structural-reading-map-service";
import { createLocalFactExtractionService } from "@/application/local-fact-extraction-service";
import type { LocalFactExtractionBatchService } from "@/application/local-fact-extraction-batch-service";
import { createThreadGraphService } from "@/application/thread-graph-service";
import { createAnalysisBriefService } from "@/application/analysis-brief-service";
import { createResearchConclusionService } from "@/application/research-conclusion-service";
import { createIndependentFalsificationService } from "@/application/independent-falsification-service";
import { createResearchDossierService } from "@/application/research-dossier-service";
import { createEvidenceWorkbenchService } from "@/application/evidence-workbench-service";
import { createStoryPlanningService } from "@/application/story-planning-service";
import { createCreativeRecipeService } from "@/application/creative-recipe-service";
import type { ChapterReviewerService } from "@/application/chapter-reviewer-service";
import type { ChapterEditorTaskService } from "@/application/chapter-editor-task-service";
import type { MechanismEffectExperimentBlindReviewService } from "@/application/mechanism-effect-experiment-blind-review-service";
import { createTaskRunner } from "@/application/task-runner";
import { createWorkspaceMaintenanceService } from "@/application/workspace-maintenance-service";
import { createWorkspaceApplicationService, type WorkspaceApplicationService } from "@/application/workspace-application-service";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createNodeWorkspaceBackupRepository } from "@/persistence/node-workspace-backup";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("Workspace CLI", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-workspace-cli-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("CLI 与 MCP 共用 Application Service 创建并读取项目", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });

    await expect(executeWorkspaceCli(application, "create-novel-project", {
      commandId: "command_001", idempotencyKey: "idem_001", correlationId: "correlation_001",
      projectId: "project_001", title: "雾港记录", status: "planning", payload: { schema_version: 1 },
    })).resolves.toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "novel_project", id: "project_001" }] });
    await expect(executeWorkspaceCli(application, "get-workspace-status", {})).resolves.toEqual({ workspaceRevision: 1, changeSeq: 1, projectCount: 1 });
    await expect(executeWorkspaceCli(application, "list-novel-projects", {})).resolves.toEqual([expect.objectContaining({ projectId: "project_001", title: "雾港记录" })]);
    await expect(executeWorkspaceCli(application, "get-project-workbench", { projectId: "project_001" })).resolves.toMatchObject({ projectId: "project_001", productionCursor: null });
    await expect(executeWorkspaceCli(application, "list-pending-mechanism-assets", {})).resolves.toEqual([]);
    await expect(executeWorkspaceCli(application, "list-coverage-gaps", {})).resolves.toEqual([]);
    await expect(executeWorkspaceCli(application, "get-capabilities", {})).resolves.toMatchObject({ protocolVersion: 1, controlPlane: "stdio" });
    await expect(executeWorkspaceCli(application, "list-changes", { after: 0 })).resolves.toEqual([
      expect.objectContaining({ changeSeq: 1, resourceId: "project_001" }),
    ]);
  });

  it("CLI 通过受控 Pipeline 服务保存、冻结并复核步骤", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });

    await expect(executeWorkspaceCli(application, "save-pipeline-revision", {
      commandId: "pipeline_save", idempotencyKey: "pipeline_save", correlationId: "pipeline_save",
      pipelineId: "analysis_pipeline", name: "分析链", steps: [{ id: "facts", tool: "commit_analysis_facts", enabled: true }],
    })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(executeWorkspaceCli(application, "list-pipeline-revisions", {})).resolves.toEqual([
      expect.objectContaining({ pipelineId: "analysis_pipeline", revision: 1 }),
    ]);
    await expect(executeWorkspaceCli(application, "start-pipeline-run", {
      commandId: "pipeline_start", idempotencyKey: "pipeline_start", correlationId: "pipeline_start",
      runId: "analysis_run", pipelineId: "analysis_pipeline",
    })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "complete-pipeline-run-step", {
      commandId: "pipeline_complete", idempotencyKey: "pipeline_complete", correlationId: "pipeline_complete",
      runId: "analysis_run", stepId: "facts", note: "已通过受控 FactLedger 服务提交并由人类复核。",
    })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "list-pipeline-runs", {})).resolves.toEqual([
      expect.objectContaining({ runId: "analysis_run", status: "completed", nodes: [expect.objectContaining({ stepId: "facts", status: "completed" })] }),
    ]);
  });

  it("CLI 只经 Application Service 查询、重试和取消待处理任务", async () => {
    const calls: string[] = [];
    const application = {
      commands: {} as never,
      queries: {
        listActionableTasks: async () => [{
          taskId: "task_failed_001", resourceKey: "local_creation:project_001:draft_001", taskType: "local_creation_draft",
          status: "failed", retryCount: 0, updatedAt: 1_700_000_000_000, leaseExpiresAt: null,
        }],
      },
      taskActions: {
        get: async (taskId: string) => {
          calls.push(`get:${taskId}`);
          return { taskId, status: "failed" } as never;
        },
        wait: async (taskId: string, timeoutMs: number) => {
          calls.push(`wait:${taskId}:${timeoutMs}`);
          return { taskId, status: "failed" } as never;
        },
        retry: async (taskId: string) => {
          calls.push(`retry:${taskId}`);
          return { taskId, status: "queued" } as never;
        },
        requestCancel: async (taskId: string) => {
          calls.push(`cancel:${taskId}`);
          return { taskId, status: "cancel_requested" } as never;
        },
      },
    } as unknown as WorkspaceApplicationService;

    await expect(executeWorkspaceCli(application, "list-actionable-tasks", {})).resolves.toEqual([
      expect.objectContaining({ taskId: "task_failed_001", status: "failed" }),
    ]);
    await expect(executeWorkspaceCli(application, "get-task", { taskId: "task_failed_001" }))
      .resolves.toMatchObject({ taskId: "task_failed_001", status: "failed" });
    await expect(executeWorkspaceCli(application, "wait-task", { taskId: "task_failed_001", timeoutMs: 123 }))
      .resolves.toMatchObject({ taskId: "task_failed_001", status: "failed" });
    await expect(executeWorkspaceCli(application, "retry-task", { taskId: "task_failed_001" }))
      .resolves.toMatchObject({ taskId: "task_failed_001", status: "queued" });
    await expect(executeWorkspaceCli(application, "cancel-task", { taskId: "task_failed_001" }))
      .resolves.toMatchObject({ taskId: "task_failed_001", status: "cancel_requested" });
    expect(calls).toEqual(["get:task_failed_001", "wait:task_failed_001:123", "retry:task_failed_001", "cancel:task_failed_001"]);
  });

  it("CLI 将可恢复批量事实抽取交给领域服务，而不接受 SQL 或路径参数", async () => {
    const application = { queries: { getWorkspaceSettings: async () => ({ automationMode: "supervised" }) } } as WorkspaceApplicationService;
    const calls: string[] = [];
    const batch = {
      start: async (input: { taskId: string; analysisProjectId: string; model: string }) => {
        calls.push(`start:${input.taskId}:${input.analysisProjectId}:${input.model}`);
        return { kind: "accepted" as const, taskId: input.taskId };
      },
      run: async (taskId: string) => {
        calls.push(`run:${taskId}`);
        return { taskId, status: "succeeded" } as never;
      },
      cancel: async () => undefined,
      getTask: async (taskId: string) => ({ taskId, status: "succeeded" } as never),
    } satisfies LocalFactExtractionBatchService;

    await expect(executeWorkspaceCli(application, "extract-local-facts-batch", {
      commandId: "command_batch_001", idempotencyKey: "idem_batch_001", correlationId: "correlation_batch_001",
      taskId: "batch_task_001", analysisProjectId: "analysis_001", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 2048,
    }, { batchFactExtraction: batch })).resolves.toMatchObject({ command: { kind: "accepted", taskId: "batch_task_001" }, task: { status: "succeeded" } });
    await expect(executeWorkspaceCli(application, "resume-local-fact-extraction-batch", { taskId: "batch_task_001" }, { batchFactExtraction: batch }))
      .resolves.toMatchObject({ taskId: "batch_task_001", status: "succeeded" });
    expect(calls).toEqual(["start:batch_task_001:analysis_001:qwen3.5:9b", "run:batch_task_001", "run:batch_task_001"]);
  });

  it("CLI 读取并版本化保存工作区非秘密设置", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });

    await expect(executeWorkspaceCli(application, "get-workspace-settings", {})).resolves.toMatchObject({ revision: 0, automationMode: "supervised" });
    await expect(executeWorkspaceCli(application, "save-workspace-settings", {
      commandId: "command_workspace_settings", idempotencyKey: "idem_workspace_settings", correlationId: "correlation_workspace_settings",
      automationMode: "manual", contextWindowTokens: 16_384, maxOutputTokens: 2_048, safetyMarginRatio: 0.2, cloudEscalation: "never",
    })).resolves.toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "data_policy", id: "workspace:default" }] });
    await expect(executeWorkspaceCli(application, "get-workspace-settings", {})).resolves.toMatchObject({ revision: 1, automationMode: "manual", cloudEscalation: "never" });
  });

  it("CLI 等待本地创作任务并返回已提交草稿", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await executeWorkspaceCli(application, "create-novel-project", {
      commandId: "command_project_001", idempotencyKey: "idem_project_001", correlationId: "correlation_project_001",
      projectId: "project_001", title: "雾港记录", status: "planning", payload: { schema_version: 1 },
    });
    const creation = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }),
      objects: await createNodeObjectStore({ workspacePath }), caller: { complete: async () => ({ text: "钟声越过空街。", finishReason: "stop" }) },
      hostId: "cli-test", now: () => 1_700_000_000_000,
    });

    await expect(executeWorkspaceCli(application, "create-local-draft", {
      commandId: "command_draft_001", idempotencyKey: "idem_draft_001", correlationId: "correlation_draft_001",
      taskId: "task_draft_001", documentId: "draft_001", projectId: "project_001", title: "第一章", prompt: "写原创开场。",
      baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 2048,
    }, { creation })).resolves.toMatchObject({
      task: { status: "succeeded" },
      draft: { documentId: "draft_001", text: "钟声越过空街。" },
    });
  });

  it("CLI 只通过匿名盲评领域服务启动、恢复和读取 P6 报告", async () => {
    const calls: string[] = [];
    const application = { queries: { getWorkspaceSettings: async () => ({ automationMode: "supervised" }) } } as WorkspaceApplicationService;
    const blindReview: MechanismEffectExperimentBlindReviewService = {
      start: async (input) => {
        calls.push(`start:${input.experimentId}:${input.pairId}:${input.sourceManifestId}:${input.documentId}`);
        return { kind: "accepted", taskId: input.taskId };
      },
      run: async (taskId) => {
        calls.push(`run:${taskId}`);
        return { taskId, status: "succeeded" } as never;
      },
      cancel: async () => undefined,
      getTask: async (taskId) => ({ taskId, status: "succeeded" } as never),
      getReport: async ({ documentId }) => ({ schema_version: 1, kind: "mechanism_effect_experiment_blind_review", experimentId: "experiment_001", pairId: "pair_001", structuredTargetEffect: "candidate_002", candidateRisks: [], sourceLeakageCandidateIds: [], documentId } as never),
    };

    await expect(executeWorkspaceCli(application, "start-mechanism-effect-experiment-blind-review", {
      commandId: "blind_review_start", idempotencyKey: "blind_review_start", correlationId: "blind_review_start",
      projectId: "project_001", experimentId: "experiment_001", pairId: "pair_001", sourceManifestId: "manifest_001", taskId: "blind_review_task_001", documentId: "blind_review_001", title: "匿名盲评",
    }, { mechanismEffectBlindReview: blindReview })).resolves.toEqual({ kind: "accepted", taskId: "blind_review_task_001" });
    await expect(executeWorkspaceCli(application, "resume-mechanism-effect-experiment-blind-review", { taskId: "blind_review_task_001" }, { mechanismEffectBlindReview: blindReview }))
      .resolves.toMatchObject({ taskId: "blind_review_task_001", status: "succeeded" });
    await expect(executeWorkspaceCli(application, "get-mechanism-effect-experiment-blind-review", { documentId: "blind_review_001" }, { mechanismEffectBlindReview: blindReview }))
      .resolves.toMatchObject({ kind: "mechanism_effect_experiment_blind_review", pairId: "pair_001" });
    expect(calls).toEqual([
      "start:experiment_001:pair_001:manifest_001:blind_review_001",
      "run:blind_review_task_001",
      "run:blind_review_task_001",
    ]);
  });

  it("CLI 在 manual 模式只排队新任务，显式 resume 才执行", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await executeWorkspaceCli(application, "create-novel-project", { commandId: "manual_project", idempotencyKey: "manual_project", correlationId: "manual", projectId: "project_manual", title: "手动模式", status: "planning", payload: { schema_version: 1 } });
    await executeWorkspaceCli(application, "save-workspace-settings", { commandId: "manual_settings", idempotencyKey: "manual_settings", correlationId: "manual", automationMode: "manual", contextWindowTokens: 4096, maxOutputTokens: 1024, safetyMarginRatio: 0.2, cloudEscalation: "never" });
    const creation = createLocalCreationService({
      driver, schemas, commands: application.commands, tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }), objects: await createNodeObjectStore({ workspacePath }),
      caller: { complete: async () => ({ text: "钟声越过空街。", finishReason: "stop" }) }, hostId: "cli-manual", now: () => 1_700_000_000_000,
    });
    await expect(executeWorkspaceCli(application, "create-local-draft", {
      commandId: "manual_draft", idempotencyKey: "manual_draft", correlationId: "manual", taskId: "task_manual", documentId: "draft_manual", projectId: "project_manual", title: "第一章", prompt: "写原创开场。",
    }, { creation })).resolves.toMatchObject({ command: { kind: "accepted", taskId: "task_manual" }, task: { status: "queued" }, draft: null });
    await expect(executeWorkspaceCli(application, "resume-local-creation", { taskId: "task_manual" }, { creation })).resolves.toMatchObject({ status: "succeeded" });
    await expect(creation.getDraft("draft_manual")).resolves.toMatchObject({ text: "钟声越过空街。" });
  });

  it("CLI 通过受控任务创建备份，并在确认后恢复到新目录", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const tasks = createTaskRunner(driver);
    const maintenance = createWorkspaceMaintenanceService({
      commands: application.commands,
      tasks,
      objects: await createNodeObjectStore({ workspacePath }),
      backups: createNodeWorkspaceBackupRepository({ workspacePath, driver: driver as Awaited<ReturnType<typeof createNodeSqlDriver>> }),
      hostId: "cli-maintenance-test",
    });

    await expect(executeWorkspaceCli(application, "create-workspace-backup", {
      commandId: "command_workspace_backup", idempotencyKey: "idem_workspace_backup", correlationId: "correlation_workspace_backup",
      taskId: "task_workspace_backup", backupId: "backup-cli-001",
    }, { maintenance })).resolves.toMatchObject({ task: { status: "succeeded" } });

    const requested = await executeWorkspaceCli(application, "restore-workspace-backup", {
      commandId: "command_workspace_restore", idempotencyKey: "idem_workspace_restore", correlationId: "correlation_workspace_restore",
      taskId: "task_workspace_restore", backupId: "backup-cli-001", restoreId: "restore-cli-001",
    }, { maintenance });
    expect(requested).toMatchObject({ kind: "needs_confirmation", risk: "workspace_restore" });
    const confirmationId = (requested as { confirmationId: string }).confirmationId;
    await expect(executeWorkspaceCli(application, "approve-confirmation", {
      confirmationId, reason: "验证受控恢复目录。",
    })).resolves.toEqual({ kind: "accepted", taskId: "task_workspace_restore" });
    await expect(executeWorkspaceCli(application, "resume-workspace-maintenance", { taskId: "task_workspace_restore" }, { maintenance }))
      .resolves.toMatchObject({ status: "succeeded" });
    await expect(access(path.join(workspacePath, "data", "restores", "restore-cli-001", "data", "ainovr.sqlite3"))).resolves.toBeUndefined();
  });

  it("CLI 可启动本机 Reviewer 任务并读取正式报告", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const reviewer: ChapterReviewerService = {
      start: async () => ({ kind: "accepted", taskId: "reviewer_task_001" }),
      run: async () => ({ taskId: "reviewer_task_001", status: "succeeded" } as never),
      cancel: async () => undefined,
      getTask: async () => ({ taskId: "reviewer_task_001", status: "succeeded" } as never),
      getReview: async () => ({ schema_version: 1, kind: "chapter_review", reviewId: "review_001", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: "production:chapter_draft:chapter_001:v1", draftRevision: "v1", readerManifestIds: ["reader_immersive", "reader_low", "reader_logic"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low", "feedback_logic"], issues: [] }),
    };

    await expect(executeWorkspaceCli(application, "create-chapter-reviewer", {
      commandId: "command_reviewer_001", idempotencyKey: "idem_reviewer_001", correlationId: "correlation_reviewer_001",
      taskId: "reviewer_task_001", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: "production:chapter_draft:chapter_001:v1",
      reviewId: "review_001", readerManifestIds: ["reader_immersive", "reader_low", "reader_logic"], readerFeedbackDocumentIds: ["feedback_immersive", "feedback_low", "feedback_logic"],
      title: "第一章独立评审", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024,
    }, { reviewer })).resolves.toMatchObject({ task: { status: "succeeded" }, review: { reviewId: "review_001" } });
    await expect(executeWorkspaceCli(application, "get-chapter-reviewer-review", { projectId: "project_001", reviewId: "review_001" }, { reviewer }))
      .resolves.toMatchObject({ kind: "chapter_review", reviewId: "review_001" });
  });

  it("CLI 可启动本机定向 Editor 任务并返回正式 V2/V3 草稿", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    const editorTasks: ChapterEditorTaskService = {
      start: async () => ({ kind: "accepted", taskId: "editor_task_001" }),
      run: async () => ({ taskId: "editor_task_001", status: "succeeded" } as never),
      cancel: async () => undefined,
      getTask: async () => ({ taskId: "editor_task_001", status: "succeeded" } as never),
      getDraft: async () => ({ documentId: "production:chapter_draft:chapter_001:v2", projectId: "project_001", chapterId: "chapter_001", manifestId: "writer_manifest_001", title: "第一章 V2", text: "修订正文", model: "qwen3.5:9b", executionRef: "editor_task_001", revision: "v2", parentDocumentId: "production:chapter_draft:chapter_001:v1", parentRevision: "v1", reviewId: "review_001", selectedIssueIds: ["issue_001"], rationale: "修订", changedRange: { sourceStartByte: 0, sourceEndByte: 3, replacementByteLength: 6 } }),
    };

    await expect(executeWorkspaceCli(application, "create-chapter-editor", {
      commandId: "command_editor_001", idempotencyKey: "idem_editor_001", correlationId: "correlation_editor_001", taskId: "editor_task_001", projectId: "project_001", chapterId: "chapter_001", title: "第一章 V2",
      targetDocumentId: "production:chapter_draft:chapter_001:v2", sourceDraftDocumentId: "production:chapter_draft:chapter_001:v1", reviewId: "review_001", selectedIssueIds: ["issue_001"], rationale: "只修正局部问题。", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", maxTokens: 1024,
    }, { editorTasks })).resolves.toMatchObject({ task: { status: "succeeded" }, draft: { revision: "v2", reviewId: "review_001" } });
    await expect(executeWorkspaceCli(application, "resume-chapter-editor", { taskId: "editor_task_001" }, { editorTasks }))
      .resolves.toMatchObject({ taskId: "editor_task_001", status: "succeeded" });
  });

  it("CLI 通过 StoryPlanning Application Service 保存并读取项目规划", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await executeWorkspaceCli(application, "create-novel-project", {
      commandId: "command_planning_project", idempotencyKey: "idem_planning_project", correlationId: "correlation_planning",
      projectId: "project_planning", title: "灯塔档案", status: "planning", payload: { schema_version: 1 },
    });
    const planning = createStoryPlanningService({ driver, commands: application.commands, objects: await createNodeObjectStore({ workspacePath }) });

    await expect(executeWorkspaceCli(application, "save-project-intent", {
      commandId: "command_planning_intent", idempotencyKey: "idem_planning_intent", correlationId: "correlation_planning",
      projectId: "project_planning", intent: { genre: "科幻悬疑", audience: "成年读者", experienceGoals: ["逐层揭开的未知"], prohibitions: ["不复用参考专名"], targetScale: "中篇" },
    }, { planning })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(executeWorkspaceCli(application, "list-project-planning-documents", { projectId: "project_planning" }, { planning }))
      .resolves.toEqual([expect.objectContaining({ documentType: "project_intent", revision: 1 })]);

    await application.commands.execute({
      schemaVersion: 1, commandId: "command_cli_pending_contract", idempotencyKey: "idem_cli_pending_contract", correlationId: "correlation_planning", actor: { kind: "external_agent", id: "test" }, projectId: "project_planning", createdAt: 1_700_000_000_000,
      tool: "commit_project_planning_document", args: { projectId: "project_planning", documentId: "planning:story_contract", documentType: "story_contract", status: "pending_review", expectedRevision: null, payload: { schema_version: 1, kind: "story_contract", title: "候选契约", corePromise: "承诺", centralConflict: "冲突", endingDirection: "结局", immutableBoundaries: ["边界"] } },
    });
    const pendingReview = await executeWorkspaceCli(application, "review-project-planning-document", {
      commandId: "command_cli_review_contract", idempotencyKey: "idem_cli_review_contract", correlationId: "correlation_planning", projectId: "project_planning", documentId: "planning:story_contract", expectedRevision: 1, status: "approved",
    }, { planning });
    expect(pendingReview).toMatchObject({ kind: "needs_confirmation" });
    await expect(application.commands.approveConfirmation({ confirmationId: (pendingReview as { confirmationId: string }).confirmationId, actor: { kind: "human_via_agent", id: "test" }, reason: "测试批准规划" })).resolves.toMatchObject({ kind: "ok", revision: 2 });
  });

  it("CLI 通过同一 Application Service 创建并读取本章 CreativeRecipe", async () => {
    const schemas = createSchemaRegistry(); registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await executeWorkspaceCli(application, "create-novel-project", {
      commandId: "command_recipe_project", idempotencyKey: "idem_recipe_project", correlationId: "correlation_recipe",
      projectId: "project_recipe", title: "配方测试", status: "planning", payload: { schema_version: 1 },
    });
    await application.commands.execute({
      schemaVersion: 1, commandId: "command_recipe_contract", idempotencyKey: "idem_recipe_contract", correlationId: "correlation_recipe", actor: { kind: "human", id: "user_001" }, projectId: "project_recipe", createdAt: 1_700_000_000_000,
      tool: "commit_project_planning_document", args: { projectId: "project_recipe", documentId: "planning:chapter_contract:chapter_001", documentType: "chapter_contract", status: "approved", expectedRevision: null, payload: { schema_version: 1, kind: "chapter_contract", chapterId: "chapter_001", ordinal: 1, entryState: ["入口"], exitState: ["出口"], desire: "目标", pressure: "压力", turningPoint: "转折", mustNotHappen: [], readerPromiseAction: "establish", emotionalCycle: "变化", nextChapterInterface: ["接口"], mechanismCardIds: [] } },
    });
    const recipes = createCreativeRecipeService({ driver, commands: application.commands, mechanisms: { listAdoptedSnapshots: async () => [] }, applications: { get: async () => null } });

    await expect(executeWorkspaceCli(application, "create-creative-recipe", {
      commandId: "command_recipe_create", idempotencyKey: "idem_recipe_create", correlationId: "correlation_recipe", projectId: "project_recipe", chapterId: "chapter_001",
    }, { recipes })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(executeWorkspaceCli(application, "get-creative-recipe", { projectId: "project_recipe", chapterId: "chapter_001" }, { recipes }))
      .resolves.toMatchObject({ chapterId: "chapter_001", mechanismAssetId: null });
  });

  it("CLI 与 MCP 使用相同参考文本导入服务，不暴露路径读取", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const objects = await createNodeObjectStore({ workspacePath });
    const references = createReferenceImportService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const corpus = createAnalysisCorpusService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const facts = createAnalysisFactService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const maps = createStructuralReadingMapService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const factExtraction = createLocalFactExtractionService({
      driver, commands: application.commands, tasks: createTaskRunner(driver, { now: () => 1_700_000_000_000 }), objects, facts,
      caller: { complete: async () => ({ text: JSON.stringify({ facts: [{ id: "fact_001", kind: "event", rawLabel: null, statement: "出现中文原文", subject: null, object: null, evidenceSpanIds: ["segmentation_001:sp00001"], epistemicStatus: "observed" }] }), finishReason: "stop" }) },
      hostId: "cli-fact-test", now: () => 1_700_000_000_000,
    });
    const threads = createThreadGraphService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const brief = createAnalysisBriefService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const conclusions = createResearchConclusionService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const falsification = createIndependentFalsificationService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const dossier = createResearchDossierService({ driver, commands: application.commands, objects, now: () => 1_700_000_000_000 });
    const workbench = createEvidenceWorkbenchService({ driver });

    await expect(executeWorkspaceCli(application, "import-reference-text", {
      commandId: "command_reference_001", idempotencyKey: "idem_reference_001", correlationId: "correlation_reference_001",
      referenceWorkId: "reference_001", sourceEditionId: "edition_001", title: "示例参考", text: "中文原文",
    }, { references })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "get-source-excerpt", { sourceEditionId: "edition_001", startByte: 0, endByte: 6 }, { references }))
      .resolves.toEqual({ text: "中文", startByte: 0, endByte: 6 });
    await expect(executeWorkspaceCli(application, "prepare-analysis-corpus", {
      commandId: "command_corpus_001", idempotencyKey: "idem_corpus_001", correlationId: "correlation_corpus_001",
      analysisProjectId: "analysis_001", segmentationId: "segmentation_001", sourceEditionId: "edition_001", boundary: "complete",
      budget: { contextWindowTokens: 4096, safetyMarginRatio: 0.2, reservedOutputTokens: 512, renderedSystemPromptTokens: 64, renderedSchemaTokens: 64, envelopeTokens: 64 },
    }, { corpus })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "get-analysis-overview", { analysisProjectId: "analysis_001" }, { corpus })).resolves.toMatchObject({ spanCount: 1 });
    await expect(executeWorkspaceCli(application, "create-structural-reading-map", {
      commandId: "command_map_001", idempotencyKey: "idem_map_001", correlationId: "correlation_map_001", analysisProjectId: "analysis_001",
    }, { maps })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "get-structural-reading-map", { analysisProjectId: "analysis_001" }, { maps }))
      .resolves.toMatchObject({ kind: "structural_reading_map", totalSpans: 1 });
    const overview = await corpus.getOverview("analysis_001");
    const unitId = overview!.computeUnits[0]!.analysisUnitId;
    await expect(executeWorkspaceCli(application, "extract-local-facts", {
      commandId: "command_facts_001", idempotencyKey: "idem_facts_001", correlationId: "correlation_facts_001",
      analysisProjectId: "analysis_001", analysisUnitId: unitId,
      taskId: "fact_task_001", baseURL: "http://localhost:11434/v1", model: "qwen3:8b", maxTokens: 2048,
    }, { factExtraction })).resolves.toMatchObject({ task: { status: "succeeded" } });
    await expect(executeWorkspaceCli(application, "resume-local-fact-extraction", { taskId: "fact_task_001" }, { factExtraction }))
      .resolves.toMatchObject({ status: "succeeded" });
    await expect(executeWorkspaceCli(application, "get-fact-ledger", { analysisProjectId: "analysis_001", analysisUnitId: unitId }, { facts }))
      .resolves.toEqual([expect.objectContaining({ id: "fact_001", evidenceSpanIds: ["segmentation_001:sp00001"] })]);
    await expect(executeWorkspaceCli(application, "submit-thread-graph", {
      commandId: "command_thread_001", idempotencyKey: "idem_thread_001", correlationId: "correlation_thread_001", analysisProjectId: "analysis_001",
      rawOutput: JSON.stringify({ threads: [{ id: "thread_001", kind: "event", title: "原文事件", episodes: [{ id: "episode_001", role: "setup", rawLabel: null, summary: "原文事件出现", evidenceSpanIds: ["segmentation_001:sp00001"], ordinal: 1 }], epistemicStatus: "observed", lifecycle: "open" }] }),
    }, { threads })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "get-thread-graph", { analysisProjectId: "analysis_001" }, { threads }))
      .resolves.toEqual([expect.objectContaining({ id: "thread_001" })]);
    const briefOutput = JSON.stringify({ questions: [{ id: "question_001", question: "事件如何改变期待？", rationale: "检查事件线", productionUse: "指导信息释放", requiredEvidence: ["事件证据"], estimatedCostTokens: 256, abstentionReason: "证据不足时弃权" }] });
    await expect(executeWorkspaceCli(application, "submit-analysis-brief", {
      commandId: "command_brief_001", idempotencyKey: "idem_brief_001", correlationId: "correlation_brief_001", analysisProjectId: "analysis_001", rawOutput: briefOutput,
    }, { brief })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "approve-analysis-brief", {
      commandId: "command_brief_approve_001", idempotencyKey: "idem_brief_approve_001", correlationId: "correlation_brief_001", analysisProjectId: "analysis_001",
    }, { brief })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "get-analysis-brief", { analysisProjectId: "analysis_001" }, { brief }))
      .resolves.toMatchObject({ status: "approved" });
    const conclusionOutput = JSON.stringify({ conclusions: [{ id: "conclusion_001", researchQuestionId: "question_001", conclusion: "异常先出现能建立期待。", observations: [{ id: "observation_001", statement: "异常班次先于解释出现。", evidenceSpanIds: ["segmentation_001:sp00001"] }], evidenceSpanIds: ["segmentation_001:sp00001"], counterEvidenceSpanIds: [], alternativeExplanations: ["局部场景调度"], applicabilityBoundaries: ["信息控制释放"], productionImplications: ["先给异常再延后解释。"], coverageStatus: "complete", epistemicStatus: "inferred" }] });
    await expect(executeWorkspaceCli(application, "submit-research-conclusions", {
      commandId: "command_conclusion_001", idempotencyKey: "idem_conclusion_001", correlationId: "correlation_conclusion_001", analysisProjectId: "analysis_001", researchQuestionId: "question_001", rawOutput: conclusionOutput,
    }, { conclusions })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "get-research-conclusions", { analysisProjectId: "analysis_001", researchQuestionId: "question_001" }, { conclusions }))
      .resolves.toEqual([expect.objectContaining({ id: "conclusion_001" })]);
    await expect(executeWorkspaceCli(application, "get-falsification-work-item", { analysisProjectId: "analysis_001", conclusionId: "conclusion_001" }, { falsification }))
      .resolves.toMatchObject({ proposition: "异常先出现能建立期待。" });
    const falsificationOutput = JSON.stringify({ assessment: { conclusionId: "conclusion_001", status: "bounded", counterEvidenceSpanIds: ["segmentation_001:sp00001"], alternativeExplanations: ["局部场景调度"], applicabilityLimits: ["单一计算单元"], sampleBiasNotes: ["样本有限"] } });
    await expect(executeWorkspaceCli(application, "submit-independent-falsification", {
      commandId: "command_falsification_001", idempotencyKey: "idem_falsification_001", correlationId: "correlation_falsification_001", analysisProjectId: "analysis_001", conclusionId: "conclusion_001", rawOutput: falsificationOutput,
    }, { falsification })).resolves.toMatchObject({ kind: "ok" });
    await expect(executeWorkspaceCli(application, "get-independent-falsification", { analysisProjectId: "analysis_001", conclusionId: "conclusion_001" }, { falsification }))
      .resolves.toMatchObject({ status: "bounded" });
    await expect(executeWorkspaceCli(application, "create-research-dossier", {
      commandId: "command_dossier_001", idempotencyKey: "idem_dossier_001", correlationId: "correlation_dossier_001", analysisProjectId: "analysis_001",
    }, { dossier })).resolves.toMatchObject({ kind: "ok", revision: 1 });
    await expect(executeWorkspaceCli(application, "get-research-dossier", { analysisProjectId: "analysis_001" }, { dossier }))
      .resolves.toMatchObject({ factCount: 1, threadCount: 1 });
    await expect(executeWorkspaceCli(application, "get-analysis-evidence", { analysisProjectId: "analysis_001", conclusionId: "conclusion_001" }, { workbench }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ role: "supporting", conclusionId: "conclusion_001" }), expect.objectContaining({ role: "counter", conclusionId: "conclusion_001" })]));
    await expect(executeWorkspaceCli(application, "list-analysis-coverage", { analysisProjectId: "analysis_001", module: "research_question" }, { workbench }))
      .resolves.toEqual([expect.objectContaining({ status: "complete", reason: "research_conclusion_submitted" })]);
  });
});
