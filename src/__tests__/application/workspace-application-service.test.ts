import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "@/application/command-types";
import { createWorkspaceApplicationService } from "@/application/workspace-application-service";
import { createTaskRunner } from "@/application/task-runner";
import { createNodeObjectStore } from "@/persistence/node-object-store";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("Workspace Application Service", () => {
  let workspacePath: string;
  let driver: SqlDriver;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-workspace-application-service-"));
    driver = await createNodeSqlDriver({ workspacePath });
  });

  afterEach(async () => {
    await driver?.close();
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("通过 CommandService 创建项目，并通过 QueryService 读取同一 revision", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });

    const result = await application.commands.execute(envelope({
      tool: "create_novel_project",
      args: { projectId: "project_001", title: "雾港记录", status: "planning", payload: { schema_version: 1, intent: "近未来悬疑" } },
    }));

    expect(result).toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "novel_project", id: "project_001" }] });
    await expect(application.queries.getNovelProject("project_001")).resolves.toEqual({
      projectId: "project_001",
      title: "雾港记录",
      status: "planning",
      revision: 1,
      payload: { schema_version: 1, intent: "近未来悬疑" },
      actor: { kind: "human", id: "user_001" },
    });
    await expect(application.queries.getWorkspaceStatus()).resolves.toEqual({ workspaceRevision: 1, changeSeq: 1, projectCount: 1 });
  });

  it("为桌面工作台投影项目列表与当前文档版本，而不让 UI 读取 SQLite 或 JSON Store", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute(envelope({
      tool: "create_novel_project",
      args: { projectId: "project_001", title: "雾港记录", status: "planning", payload: { schema_version: 1, intent: "近未来悬疑" } },
    }));
    await application.commands.execute({
      ...envelope({
        tool: "commit_project_planning_document",
        args: {
          projectId: "project_001", documentId: "planning:story_contract", documentType: "story_contract", status: "approved", expectedRevision: null,
          payload: { schema_version: 1, kind: "story_contract", title: "故事契约" },
        },
      }),
      commandId: "command_document_001", idempotencyKey: "idem_document_001",
    });

    await expect(application.queries.listNovelProjects()).resolves.toEqual([
      expect.objectContaining({ projectId: "project_001", title: "雾港记录", revision: 1 }),
    ]);
    await expect(application.queries.listProjectDocuments("project_001")).resolves.toEqual([
      expect.objectContaining({ documentId: "planning:story_contract", documentType: "story_contract", status: "approved", revision: 1, title: "故事契约", contentObjectHash: null }),
    ]);
  });

  it("只通过受控 QueryService 读取项目文档的当前内容，既不暴露对象路径也不允许越过项目边界", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const objects = await createNodeObjectStore({ workspacePath });
    const application = createWorkspaceApplicationService({ driver, schemas, objects, now: () => 1_700_000_000_000 });
    await application.commands.execute(envelope({
      tool: "create_novel_project",
      args: { projectId: "project_001", title: "雾港记录", status: "planning", payload: { schema_version: 1 } },
    }));
    await application.commands.execute(envelope({
      tool: "create_novel_project",
      args: { projectId: "project_002", title: "隔离项目", status: "planning", payload: { schema_version: 1 } },
    }));
    const content = await objects.put({ content: new TextEncoder().encode("这是只能由工作台受控展示的正文。"), mediaType: "text/plain; charset=utf-8" });
    await application.commands.execute({
      ...envelope({
        tool: "commit_project_planning_document",
        args: {
          projectId: "project_001", documentId: "production:chapter_draft:chapter_001:v2", documentType: "chapter_editor_draft", status: "draft", expectedRevision: null,
          payload: { schema_version: 1, kind: "chapter_editor_draft", title: "第一章 V2" }, contentObject: content,
        },
      }),
      commandId: "command_document_content_001", idempotencyKey: "idem_document_content_001",
    });

    await expect(application.queries.getProjectDocument({ projectId: "project_001", documentId: "production:chapter_draft:chapter_001:v2" })).resolves.toEqual(expect.objectContaining({
      documentId: "production:chapter_draft:chapter_001:v2",
      title: "第一章 V2",
      content: "这是只能由工作台受控展示的正文。",
    }));
    await expect(application.queries.getProjectDocument({ projectId: "project_002", documentId: "production:chapter_draft:chapter_001:v2" })).resolves.toBeNull();
    expect("readObjectByPath" in application.queries).toBe(false);
  });

  it("为作品右侧投影 Canon、ReaderPromise 与当前生产游标，而不让组件查询业务表", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute(envelope({
      tool: "create_novel_project",
      args: { projectId: "project_truth_001", title: "潮汐档案", status: "writing", payload: { schema_version: 1 } },
    }));
    const now = 1_700_000_000_000;
    const objectHash = "c".repeat(64);
    await driver.transaction([
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, ?, ?, ?, ?)", params: [objectHash, 12, "text/plain; charset=utf-8", now, now] },
      { sql: "INSERT INTO chapters (chapter_id, project_id, branch_id, ordinal, status, current_revision, created_at, updated_at) VALUES (?, ?, NULL, ?, 'accepted', 1, ?, ?)", params: ["chapter_truth_002", "project_truth_001", 2, now, now] },
      { sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, 'project_document', 1, 'accepted', ?, ?)", params: ["document:production:chapter_text:chapter_truth_002", "project_truth_001", now, now] },
      { sql: "INSERT INTO project_documents (document_id, project_id, chapter_id, document_type, status, artifact_id, created_at, updated_at) VALUES (?, ?, ?, 'chapter_text', 'accepted', ?, ?, ?)", params: ["production:chapter_text:chapter_truth_002", "project_truth_001", "chapter_truth_002", "document:production:chapter_text:chapter_truth_002", now, now] },
      { sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, 1, NULL, ?, ?, ?, ?)", params: ["document:production:chapter_text:chapter_truth_002", '{"schema_version":1,"kind":"chapter_text","title":"第二章"}', objectHash, '{"kind":"human","id":"user_001"}', now] },
      { sql: "INSERT INTO canon_entries (canon_entry_id, project_id, payload_json, revision, status, created_at, updated_at) VALUES (?, ?, ?, 3, 'canonical', ?, ?)", params: ["canon_tide_rule", "project_truth_001", '{"schema_version":1,"summary":"倒走最多七分钟"}', now, now] },
      { sql: "INSERT INTO reader_promises (reader_promise_id, project_id, chapter_id, payload_json, status, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'establish', 2, ?, ?)", params: ["promise_future_letter", "project_truth_001", "chapter_truth_002", '{"schema_version":1,"summary":"未来来信的去向"}', now, now] },
      { sql: "INSERT INTO production_commits (production_commit_id, project_id, chapter_id, accepted_document_id, manifest_object_hash, run_id, actor_json, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)", params: ["commit_truth_002", "project_truth_001", "chapter_truth_002", "production:chapter_text:chapter_truth_002", objectHash, '{"kind":"human","id":"user_001"}', now] },
    ]);

    await expect(application.queries.getProjectWorkbench("project_truth_001")).resolves.toEqual(expect.objectContaining({
      projectId: "project_truth_001",
      canonEntries: [expect.objectContaining({ canonEntryId: "canon_tide_rule", revision: 3, summary: "倒走最多七分钟" })],
      readerPromises: [expect.objectContaining({ readerPromiseId: "promise_future_letter", chapterId: "chapter_truth_002", status: "establish", summary: "未来来信的去向" })],
      productionCursor: expect.objectContaining({ chapterId: "chapter_truth_002", ordinal: 2, productionCommitId: "commit_truth_002", nextChapterOrdinal: 3 }),
    }));
  });

  it("为待处理页汇总待采纳机制和跨参考的 Coverage 缺口，不返回原文对象", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    const now = 1_700_000_000_000;
    const objectHash = "d".repeat(64);
    await application.commands.execute(envelope({
      tool: "create_novel_project",
      args: { projectId: "project_mechanism_review_001", title: "机制待采纳项目", status: "planning", payload: { schema_version: 1 } },
    }));
    await driver.transaction([
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, 4, 'text/plain', ?, ?)", params: [objectHash, now, now] },
      { sql: "INSERT INTO reference_works (reference_work_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, 'analyzing', 1, ?, ?)", params: ["reference_pending_001", "待处理参考", now, now] },
      { sql: "INSERT INTO source_editions (source_edition_id, reference_work_id, raw_object_hash, normalized_object_hash, source_hash, encoding, byte_length, token_estimate, created_at) VALUES (?, ?, ?, ?, ?, 'utf-8', 4, 4, ?)", params: ["edition_pending_001", "reference_pending_001", objectHash, objectHash, objectHash, now] },
      { sql: "INSERT INTO analysis_projects (analysis_project_id, source_edition_id, segmentation_id, status, current_revision, created_at, updated_at) VALUES (?, ?, NULL, 'mechanism_review', 1, ?, ?)", params: ["analysis_pending_001", "edition_pending_001", now, now] },
      { sql: "INSERT INTO mechanism_assets (mechanism_asset_id, analysis_project_id, status, current_revision, created_at, updated_at) VALUES (?, ?, 'candidate', 1, ?, ?)", params: ["mechanism_pending_001", "analysis_pending_001", now, now] },
      { sql: "INSERT INTO mechanism_asset_revisions (mechanism_asset_id, revision, payload_json, neutral_example_object_hash, created_at) VALUES (?, 1, ?, ?, ?)", params: ["mechanism_pending_001", JSON.stringify({ schema_version: 1, kind: "mechanism_asset", rawOutputObjectHash: objectHash, forbiddenTerms: [], card: { id: "mechanism_pending_001", title: "异常先于解释", observation: "异常先发生", effectHypothesis: "建立可验证的下一步期待", when: ["需要建立期待"], do: ["先展示异常"], avoid: ["立即解释"], evidenceSpanIds: ["span_pending_001"], counterexampleSpanIds: [], epistemicStatus: "inferred", lifecycle: "candidate", falsification: { status: "bounded", alternativeExplanations: [], applicabilityLimits: [] }, scope: "distributed", applicability: ["章节开场"], targetLayers: ["draft"], adoption: "pending", originCandidateIds: ["conclusion_pending_001"], evidenceInstances: [{ id: "evidence_pending_001", originCandidateId: "conclusion_pending_001", spanIds: ["span_pending_001"], chapterIndexes: [0], threadIds: [] }] } }), objectHash, now] },
      { sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, NULL, 'fact_ledger', 'failed', 'invalid_output', ?, ?)", params: ["coverage_pending_001", "analysis_pending_001", '{"schema_version":1}', now] },
    ]);

    await expect(application.queries.listPendingMechanismAssets()).resolves.toEqual([
      expect.objectContaining({ mechanismAssetId: "mechanism_pending_001", analysisProjectId: "analysis_pending_001", title: "异常先于解释", revision: 1, targetLayers: ["draft"] }),
    ]);
    await expect(application.queries.listCoverageGaps()).resolves.toEqual([
      expect.objectContaining({ coverageEntryId: "coverage_pending_001", referenceWorkId: "reference_pending_001", analysisProjectId: "analysis_pending_001", status: "failed", reason: "invalid_output" }),
    ]);
    await expect(application.mechanismActions.review({
      command: { ...envelope({ tool: "unused", args: {} }), commandId: "command_mechanism_review_001", idempotencyKey: "idem_mechanism_review_001", projectId: "project_mechanism_review_001", expectedRevision: 1 },
      mechanismAssetId: "mechanism_pending_001",
      status: "adopted",
    })).resolves.toMatchObject({ kind: "ok", revision: 2 });
    await expect(application.queries.listPendingMechanismAssets()).resolves.toEqual([]);
    expect("readObjectByPath" in application.queries).toBe(false);
  });

  it("为待处理视图投影任务状态，不把 TaskRunner 的持久状态放进 UI Store", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await driver.execute({
      sql: "INSERT INTO tasks (task_id, resource_key, task_type, status, input_object_hash, output_object_hash, lease_owner, lease_expires_at, retry_count, created_at, updated_at) VALUES (?, ?, ?, 'failed', NULL, NULL, NULL, NULL, 1, ?, ?)",
      params: ["task_failed_001", "project:project_001:chapter:1", "chapter_reviewer", 1_700_000_000_000, 1_700_000_000_000],
    });

    await expect(application.queries.listActionableTasks()).resolves.toEqual([
      expect.objectContaining({ taskId: "task_failed_001", taskType: "chapter_reviewer", status: "failed", retryCount: 1 }),
    ]);
  });

  it("为待处理工作台投影待审核规划，并只经 Application Service 按 CAS revision 审核", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });
    await application.commands.execute(envelope({
      tool: "create_novel_project",
      args: { projectId: "project_review_001", title: "待审核作品", status: "planning", payload: { schema_version: 1 } },
    }));
    await application.commands.execute({
      ...envelope({
        tool: "commit_project_planning_document",
        args: {
          projectId: "project_review_001", documentId: "planning:story_contract", documentType: "story_contract", status: "pending_review", expectedRevision: null,
          payload: { schema_version: 1, kind: "story_contract", title: "待审核故事契约", corePromise: "异常带来代价", centralConflict: "是否追查", endingDirection: "承担选择", immutableBoundaries: ["不解释为梦境"] },
        },
      }),
      commandId: "command_pending_planning_001", idempotencyKey: "idem_pending_planning_001", actor: { kind: "external_agent", id: "agent_001" },
    });

    await expect(application.queries.listPendingPlanningDocuments()).resolves.toEqual([
      expect.objectContaining({ projectId: "project_review_001", documentId: "planning:story_contract", documentType: "story_contract", title: "待审核故事契约", revision: 1 }),
    ]);
    await expect(application.planningActions.reviewDocument({
      command: { ...envelope({ tool: "unused", args: {} }), commandId: "command_review_planning_001", idempotencyKey: "idem_review_planning_001", actor: { kind: "human", id: "user_001" } },
      projectId: "project_review_001", documentId: "planning:story_contract", expectedRevision: 1, status: "approved",
    })).resolves.toMatchObject({ kind: "ok", revision: 2 });
    await expect(application.queries.listPendingPlanningDocuments()).resolves.toEqual([]);
  });

  it("通过 Application Service 请求取消与重试 TaskRunner 任务，而不是让 UI 直接操作 SQLite", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const tasks = createTaskRunner(driver, { now: () => 1_700_000_000_000 });
    const application = createWorkspaceApplicationService({ driver, schemas, tasks });
    await tasks.enqueue({ taskId: "task_retry_001", resourceKey: "project:project_001:chapter:1", taskType: "chapter_writer", inputObjectHash: null });
    const claim = await tasks.claim("task_retry_001", "host_001");
    expect(claim.claimed).toBe(true);
    await tasks.fail("task_retry_001", "host_001", { code: "model_error", message: "可重试", retryable: true });

    await expect(application.taskActions.retry("task_retry_001")).resolves.toMatchObject({ taskId: "task_retry_001", status: "queued", retryCount: 1 });
    await expect(application.taskActions.requestCancel("task_retry_001")).resolves.toMatchObject({ taskId: "task_retry_001", status: "cancel_requested" });
  });

  it("为参考页投影 ReferenceWork 的元数据，不把原文对象暴露为页面列表", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await driver.execute({
      sql: "INSERT INTO reference_works (reference_work_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      params: ["reference_001", "示例参考", "imported", 1_700_000_000_000, 1_700_000_000_000],
    });

    await expect(application.queries.listReferenceWorks()).resolves.toEqual([
      { referenceWorkId: "reference_001", title: "示例参考", status: "imported", revision: 1, updatedAt: 1_700_000_000_000 },
    ]);
  });

  it("为参考工作台投影分析、证据索引与 Coverage 处置，而不读取参考原文", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, objects: { read: async () => new TextEncoder().encode("abcd") } });
    const now = 1_700_000_000_000;
    const objectHash = "a".repeat(64);
    await driver.transaction([
      { sql: "INSERT INTO objects (sha256, byte_length, media_type, created_at, verified_at) VALUES (?, 4, 'text/plain', ?, ?)", params: [objectHash, now, now] },
      { sql: "INSERT INTO reference_works (reference_work_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, 'analyzing', 1, ?, ?)", params: ["reference_001", "示例参考", now, now] },
      { sql: "INSERT INTO source_editions (source_edition_id, reference_work_id, raw_object_hash, normalized_object_hash, source_hash, encoding, byte_length, token_estimate, created_at) VALUES (?, ?, ?, ?, ?, 'utf-8', 4, 4, ?)", params: ["edition_001", "reference_001", objectHash, objectHash, objectHash, now] },
      { sql: "INSERT INTO analysis_projects (analysis_project_id, source_edition_id, segmentation_id, status, current_revision, created_at, updated_at) VALUES (?, ?, NULL, 'fact_extraction', 2, ?, ?)", params: ["analysis_001", "edition_001", now, now] },
      { sql: "INSERT INTO research_questions (research_question_id, analysis_project_id, payload_json, status, ordinal, created_at) VALUES (?, ?, ?, 'pending_review', 1, ?)", params: ["question_001", "analysis_001", '{"schema_version":1,"kind":"analysis_brief_question","question":{"question":"如何建立期待？","rationale":"核验读者期待","productionUse":"规划首章"}}', now] },
      { sql: "INSERT INTO source_spans (span_id, source_edition_id, analysis_unit_id, start_byte, end_byte, source_hash, exact_text_hash, locator_json) VALUES (?, ?, NULL, 0, 4, ?, ?, ?)", params: ["span_001", "edition_001", objectHash, "b".repeat(64), '{"schema_version":1,"kind":"scene"}'] },
      { sql: "INSERT INTO analysis_items (analysis_item_id, analysis_project_id, research_question_id, payload_json, epistemic_status, created_at) VALUES (?, ?, NULL, ?, 'supported', ?)", params: ["item_001", "analysis_001", '{"schema_version":1,"kind":"research_conclusion","conclusion":{"id":"conclusion_001"}}', now] },
      { sql: "INSERT INTO evidence_instances (evidence_instance_id, analysis_item_id, span_id, role, payload_json, created_at) VALUES (?, ?, ?, 'supporting', ?, ?)", params: ["evidence_001", "item_001", "span_001", '{"schema_version":1}', now] },
      { sql: "INSERT INTO mechanism_assets (mechanism_asset_id, analysis_project_id, status, current_revision, created_at, updated_at) VALUES (?, ?, 'pending_review', 1, ?, ?)", params: ["mechanism_001", "analysis_001", now, now] },
      { sql: "INSERT INTO mechanism_asset_revisions (mechanism_asset_id, revision, payload_json, neutral_example_object_hash, created_at) VALUES (?, 1, ?, NULL, ?)", params: ["mechanism_001", '{"schema_version":1,"kind":"mechanism_asset","title":"压力递增"}', now] },
      { sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, NULL, 'fact_ledger', 'complete', 'used', ?, ?)", params: ["coverage_complete", "analysis_001", '{"schema_version":1}', now] },
      { sql: "INSERT INTO coverage_entries (coverage_entry_id, analysis_project_id, analysis_unit_id, module, status, reason, payload_json, created_at) VALUES (?, ?, NULL, 'falsification', 'not_observed', 'unknown_insufficient_evidence', ?, ?)", params: ["coverage_open", "analysis_001", '{"schema_version":1}', now] },
    ]);

    await expect(application.queries.getReferenceWorkbench("reference_001")).resolves.toEqual(expect.objectContaining({
      referenceWorkId: "reference_001",
      sourceEditions: [expect.objectContaining({ sourceEditionId: "edition_001", tokenEstimate: 4 })],
      analyses: [expect.objectContaining({
        analysisProjectId: "analysis_001",
        evidence: [expect.objectContaining({ spanId: "span_001", exactTextHash: "b".repeat(64) })],
        coverageSummary: expect.arrayContaining([expect.objectContaining({ status: "complete", count: 1 }), expect.objectContaining({ status: "not_observed", count: 1 })]),
        unresolvedCoverage: [expect.objectContaining({ coverageEntryId: "coverage_open", reason: "unknown_insufficient_evidence" })],
        researchQuestions: [expect.objectContaining({ researchQuestionId: "question_001", status: "pending_review", question: "如何建立期待？" })],
        mechanisms: [expect.objectContaining({ mechanismAssetId: "mechanism_001", status: "pending_review", revision: 1 })],
      })],
    }));
    await expect(application.queries.getEvidenceExcerpt("evidence_001")).resolves.toMatchObject({
      evidenceInstanceId: "evidence_001", spanId: "span_001", text: "abcd", truncated: false,
    });
  });

  it("为设置页投影非秘密 Provider 与角色路由，绝不包含 API Key", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas });
    await driver.execute({
      sql: "INSERT INTO provider_profiles (provider_profile_id, name, base_url, default_model, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: ["provider_local", "本机 Ollama", "http://localhost:11434/v1", "qwen3.5:9b", '{"schema_version":1}', 1_700_000_000_000, 1_700_000_000_000],
    });
    await driver.execute({
      sql: "INSERT INTO model_routes (route_id, role, provider_profile_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      params: ["route_writer", "writer", "provider_local", "qwen3.5:9b", 1_700_000_000_000, 1_700_000_000_000],
    });

    await expect(application.queries.listProviderProfiles()).resolves.toEqual([
      {
        providerProfileId: "provider_local",
        name: "本机 Ollama",
        baseURL: "http://localhost:11434/v1",
        defaultModel: "qwen3.5:9b",
        revision: 1,
        routes: [{ role: "writer", model: "qwen3.5:9b" }],
      },
    ]);
  });

  it("通过 CommandService 版本化保存非秘密 Provider 与角色路由，不接受 API Key 字段", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });

    await expect(application.commands.execute({
      ...envelope({ tool: "save_provider_profile", args: { providerProfileId: "provider_local", name: "本机 Ollama", baseURL: "http://localhost:11434/v1", defaultModel: "qwen3.5:9b", routes: [{ role: "writer", model: "qwen3.5:9b" }] } }),
      commandId: "command_provider_create", idempotencyKey: "idem_provider_create",
    })).resolves.toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "provider_profile", id: "provider_local" }] });
    await expect(application.queries.listProviderProfiles()).resolves.toEqual([expect.objectContaining({ providerProfileId: "provider_local", revision: 1, defaultModel: "qwen3.5:9b", routes: [{ role: "writer", model: "qwen3.5:9b" }] })]);

    await expect(application.commands.execute({
      ...envelope({ tool: "save_provider_profile", args: { providerProfileId: "provider_local", name: "本机 Ollama", baseURL: "http://localhost:11434/v1", defaultModel: "qwen3:8b", routes: [{ role: "writer", model: "qwen3:8b" }, { role: "reviewer", model: "qwen3.5:9b" }] } }),
      commandId: "command_provider_update", idempotencyKey: "idem_provider_update", expectedRevision: 1,
    })).resolves.toEqual({ kind: "ok", revision: 2, resourceRefs: [{ type: "provider_profile", id: "provider_local" }] });
    await expect(application.queries.listProviderProfiles()).resolves.toEqual([expect.objectContaining({ providerProfileId: "provider_local", revision: 2, defaultModel: "qwen3:8b", routes: [{ role: "reviewer", model: "qwen3.5:9b" }, { role: "writer", model: "qwen3:8b" }] })]);

    await expect(application.commands.execute({
      ...envelope({ tool: "save_provider_profile", args: { providerProfileId: "provider_local", name: "过期窗口中的本机 Ollama", baseURL: "http://localhost:11434/v1", defaultModel: "qwen3:8b", routes: [{ role: "writer", model: "qwen3:8b" }] } }),
      commandId: "command_provider_stale", idempotencyKey: "idem_provider_stale", expectedRevision: 1,
    })).resolves.toEqual({
      kind: "conflict",
      currentRevision: 2,
      diagnostics: [{ code: "revision_conflict", message: "Provider 配置已被其他写入更新，请比较当前版本后重试。" }],
    });
    await expect(application.queries.listProviderProfiles()).resolves.toEqual([expect.objectContaining({ providerProfileId: "provider_local", revision: 2, name: "本机 Ollama" })]);

    await expect(application.commands.execute({
      ...envelope({ tool: "save_provider_profile", args: { providerProfileId: "provider_rejected", name: "不安全", baseURL: "https://example.invalid/v1", defaultModel: "x", apiKey: "must-not-be-stored", routes: [] } }),
      commandId: "command_provider_secret", idempotencyKey: "idem_provider_secret",
    })).resolves.toMatchObject({ kind: "blocked", diagnostics: [expect.objectContaining({ code: "invalid_args" })] });

    await expect(application.commands.execute({
      ...envelope({ tool: "save_provider_profile", args: { providerProfileId: "provider_url_secret", name: "不安全 URL", baseURL: "https://key@example.invalid/v1?token=hidden", defaultModel: "x", routes: [{ role: "writer", model: "x" }] } }),
      commandId: "command_provider_url_secret", idempotencyKey: "idem_provider_url_secret",
    })).resolves.toMatchObject({ kind: "blocked", diagnostics: [expect.objectContaining({ code: "invalid_args" })] });
  });

  it("版本化保存工作区 DataPolicy、预算与自动化模式，并对过期 revision 返回冲突", async () => {
    const schemas = createSchemaRegistry();
    registerCorePayloadSchemas(schemas);
    const application = createWorkspaceApplicationService({ driver, schemas, now: () => 1_700_000_000_000 });

    await expect(application.queries.getWorkspaceSettings()).resolves.toEqual({
      revision: 0,
      automationMode: "supervised",
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      safetyMarginRatio: 0.2,
      cloudEscalation: "complex_only",
    });
    await expect(application.commands.execute({
      ...envelope({ tool: "save_workspace_settings", args: { automationMode: "supervised", contextWindowTokens: 32_768, maxOutputTokens: 4_096, safetyMarginRatio: 0.2, cloudEscalation: "complex_only" } }),
      commandId: "command_workspace_settings_create", idempotencyKey: "idem_workspace_settings_create",
    })).resolves.toEqual({ kind: "ok", revision: 1, resourceRefs: [{ type: "data_policy", id: "workspace:default" }] });
    await expect(application.queries.getWorkspaceSettings()).resolves.toEqual({
      revision: 1,
      automationMode: "supervised",
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      safetyMarginRatio: 0.2,
      cloudEscalation: "complex_only",
    });

    await expect(application.commands.execute({
      ...envelope({ tool: "save_workspace_settings", args: { automationMode: "autonomous", contextWindowTokens: 65_536, maxOutputTokens: 8_192, safetyMarginRatio: 0.15, cloudEscalation: "never" } }),
      commandId: "command_workspace_settings_update", idempotencyKey: "idem_workspace_settings_update", expectedRevision: 1,
    })).resolves.toEqual({ kind: "ok", revision: 2, resourceRefs: [{ type: "data_policy", id: "workspace:default" }] });
    await expect(application.commands.execute({
      ...envelope({ tool: "save_workspace_settings", args: { automationMode: "manual", contextWindowTokens: 16_384, maxOutputTokens: 2_048, safetyMarginRatio: 0.25, cloudEscalation: "always" } }),
      commandId: "command_workspace_settings_stale", idempotencyKey: "idem_workspace_settings_stale", expectedRevision: 1,
    })).resolves.toEqual({
      kind: "conflict",
      currentRevision: 2,
      diagnostics: [{ code: "revision_conflict", message: "工作区设置已被其他写入更新，请比较当前版本后重试。" }],
    });
    await expect(application.queries.getWorkspaceSettings()).resolves.toEqual({
      revision: 2,
      automationMode: "autonomous",
      contextWindowTokens: 65_536,
      maxOutputTokens: 8_192,
      safetyMarginRatio: 0.15,
      cloudEscalation: "never",
    });
  });
});

function envelope(overrides: Pick<CommandEnvelope, "tool" | "args">): CommandEnvelope {
  return {
    schemaVersion: 1,
    commandId: "command_001",
    idempotencyKey: "idem_001",
    correlationId: "correlation_001",
    actor: { kind: "human", id: "user_001" },
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}
