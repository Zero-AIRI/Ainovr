import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ActionableTaskView,
  CoverageGapView,
  PendingPlanningDocumentView,
  PendingMechanismAssetView,
  ProviderProfileView,
  ProjectDocumentContentView,
  ProjectDocumentView,
  ProjectWorkbenchView,
  ReferenceWorkbenchView,
  ReferenceWorkSummary,
  WorkspaceSettingsView,
  WorkspaceApplicationService,
} from "@/application/workspace-application-service";
import type { ConfirmationView } from "@/application/workspace-application-service";
import type { PipelineRevision } from "@/application/pipeline-revision-service";
import type { PipelineRunView } from "@/application/pipeline-run-service";
import type { NovelProjectRecord } from "@/persistence/novel-project-repository";
import { isTauri } from "@/lib/is-tauri";
import { createDesktopWorkspaceApplication } from "@/runtime/desktop-workspace-application";
import {
  calculateTextDiff,
  compareProviderProfileDraft,
  parseProviderRoutes,
  selectExistingProject,
  WORKBENCH_NAVIGATION,
  type WorkbenchSection,
} from "./desktop-workbench-model";

interface WorkspaceSnapshot {
  workspaceRevision: number;
  changeSeq: number;
  projectCount: number;
  projects: NovelProjectRecord[];
  references: ReferenceWorkSummary[];
  confirmations: Array<
    Pick<
      ConfirmationView,
      "confirmationId" | "risk" | "expiresAt" | "targetSummary"
    >
  >;
  tasks: ActionableTaskView[];
  pendingPlanningDocuments: PendingPlanningDocumentView[];
  pendingMechanismAssets: PendingMechanismAssetView[];
  coverageGaps: CoverageGapView[];
  providers: ProviderProfileView[];
  workspaceSettings: WorkspaceSettingsView;
  pipelines: PipelineRevision[];
  pipelineRuns: PipelineRunView[];
}

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  workspaceRevision: 0,
  changeSeq: 0,
  projectCount: 0,
  projects: [],
  references: [],
  confirmations: [],
  tasks: [],
  pendingPlanningDocuments: [],
  pendingMechanismAssets: [],
  coverageGaps: [],
  providers: [],
  workspaceSettings: {
    revision: 0,
    automationMode: "supervised",
    contextWindowTokens: 32_768,
    maxOutputTokens: 4_096,
    safetyMarginRatio: 0.2,
    cloudEscalation: "complex_only",
  },
  pipelines: [],
  pipelineRuns: [],
};

/**
 * R6 的桌面工作台：它只保存视图选择和未保存表单草稿。
 * 所有业务事实均来自 QueryService，所有写入均经 CommandEnvelope/CommandService。
 */
export function AinovrWorkbench() {
  const [application, setApplication] =
    useState<WorkspaceApplicationService | null>(null);
  const [section, setSection] = useState<WorkbenchSection>("works");
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_SNAPSHOT);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [documents, setDocuments] = useState<ProjectDocumentView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const changeCursor = useRef(0);

  useEffect(() => {
    if (!isTauri()) {
      setError(
        "当前是浏览器开发预览。请在 Ainovr 桌面端打开工作台，以连接 SQLite 项目真相库。",
      );
      setIsLoading(false);
      return;
    }
    setApplication(createDesktopWorkspaceApplication({ invoke }));
  }, []);

  const refresh = useCallback(async (service: WorkspaceApplicationService) => {
    const [
      status,
      projects,
      references,
      confirmations,
      tasks,
      pendingPlanningDocuments,
      pendingMechanismAssets,
      coverageGaps,
      providers,
      workspaceSettings,
      pipelines,
      pipelineRuns,
    ] = await Promise.all([
      service.queries.getWorkspaceStatus(),
      service.queries.listNovelProjects(),
      service.queries.listReferenceWorks(),
      service.queries
        .listPendingConfirmations()
        .then(async (items) =>
          Promise.all(
            items.map(async (item) => ({
              ...item,
              targetSummary:
                (await service.queries.getConfirmation(item.confirmationId))
                  ?.targetSummary ?? `命令：${item.risk}`,
            })),
          ),
        ),
      service.queries.listActionableTasks(),
      service.queries.listPendingPlanningDocuments(),
      service.queries.listPendingMechanismAssets(),
      service.queries.listCoverageGaps(),
      service.queries.listProviderProfiles(),
      service.queries.getWorkspaceSettings(),
      service.pipelines.list(),
      service.pipelineRuns.list(),
    ]);
    changeCursor.current = status.changeSeq;
    setSnapshot({
      ...status,
      projects,
      references,
      confirmations,
      tasks,
      pendingPlanningDocuments,
      pendingMechanismAssets,
      coverageGaps,
      providers,
      workspaceSettings,
      pipelines,
      pipelineRuns,
    });
    setSelectedProjectId((current) => selectExistingProject(current, projects));
  }, []);

  useEffect(() => {
    if (!application) return;
    let active = true;
    const load = async () => {
      try {
        await refresh(application);
        if (active) setError(null);
      } catch (cause) {
        if (active) setError(messageOf(cause));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    const poll = async () => {
      if (!active || document.visibilityState !== "visible") return;
      try {
        const changes = await application.queries.listChanges(
          changeCursor.current,
        );
        if (changes.length > 0) await refresh(application);
      } catch (cause) {
        if (active) setError(messageOf(cause));
      }
    };
    const interval = window.setInterval(() => void poll(), 1_000);
    window.addEventListener("focus", poll);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", poll);
    };
  }, [application, refresh]);

  useEffect(() => {
    if (!application || !selectedProjectId) {
      setDocuments([]);
      return;
    }
    let active = true;
    void application.queries
      .listProjectDocuments(selectedProjectId)
      .then((next) => {
        if (active) setDocuments(next);
      })
      .catch((cause) => {
        if (active) setError(messageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [application, selectedProjectId, snapshot.changeSeq]);

  const selectedProject =
    snapshot.projects.find(
      (project) => project.projectId === selectedProjectId,
    ) ?? null;
  const commandSucceeded = useCallback(async () => {
    if (!application) return;
    await refresh(application);
  }, [application, refresh]);

  return (
    <div className="min-h-screen bg-[var(--color-surface-subtle)] text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-5 border-b border-[var(--color-border-default)] bg-[var(--color-surface)] px-5">
        <div className="font-semibold tracking-tight">Ainovr</div>
        <nav className="flex h-full gap-1" aria-label="主导航">
          {WORKBENCH_NAVIGATION.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`px-3 py-3 text-sm transition-colors ${section === item.id ? "border-b-2 border-[var(--color-accent)] font-medium text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto text-xs text-[var(--color-text-tertiary)]">
          revision {snapshot.workspaceRevision} · change {snapshot.changeSeq}
        </div>
      </header>

      {error && (
        <div className="mx-5 mt-4 rounded border border-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}
      {isLoading ? (
        <div className="p-8 text-sm text-[var(--color-text-tertiary)]">
          正在读取项目真相库…
        </div>
      ) : (
        <main className="p-5">
          {section === "works" && (
            <WorksPanel
              application={application}
              projects={snapshot.projects}
              selectedProject={selectedProject}
              selectedProjectId={selectedProjectId}
              documents={documents}
              onSelectProject={setSelectedProjectId}
              onCommandSucceeded={commandSucceeded}
            />
          )}
          {section === "references" && (
            <ReferencesPanel
              application={application}
              references={snapshot.references}
              onCommandSucceeded={commandSucceeded}
            />
          )}
          {section === "pending" && (
            <PendingPanel
              application={application}
              projects={snapshot.projects}
              confirmations={snapshot.confirmations}
              tasks={snapshot.tasks}
              pendingPlanningDocuments={snapshot.pendingPlanningDocuments}
              pendingMechanismAssets={snapshot.pendingMechanismAssets}
              coverageGaps={snapshot.coverageGaps}
              onCommandSucceeded={commandSucceeded}
            />
          )}
          {section === "settings" && (
            <SettingsPanel
              application={application}
              providers={snapshot.providers}
              workspaceSettings={snapshot.workspaceSettings}
              pipelines={snapshot.pipelines}
              pipelineRuns={snapshot.pipelineRuns}
              onCommandSucceeded={commandSucceeded}
            />
          )}
        </main>
      )}
    </div>
  );
}

function WorksPanel({
  application,
  projects,
  selectedProject,
  selectedProjectId,
  documents,
  onSelectProject,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  projects: readonly NovelProjectRecord[];
  selectedProject: NovelProjectRecord | null;
  selectedProjectId: string;
  documents: readonly ProjectDocumentView[];
  onSelectProject: (projectId: string) => void;
  onCommandSucceeded: () => Promise<void>;
}) {
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [compareDocumentId, setCompareDocumentId] = useState("");
  const [selectedDocument, setSelectedDocument] =
    useState<ProjectDocumentContentView | null>(null);
  const [compareDocument, setCompareDocument] =
    useState<ProjectDocumentContentView | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  // 纯渲染组装豁免：工作台只保存已查询投影的显示状态，不复制业务事实或直接查询 SQLite。
  const [projectWorkbench, setProjectWorkbench] =
    useState<ProjectWorkbenchView | null>(null);
  const [projectWorkbenchError, setProjectWorkbenchError] = useState<
    string | null
  >(null);
  const createProject = async () => {
    if (!application || !projectId.trim() || !title.trim()) return;
    const requestId = `ui:create-project:${crypto.randomUUID()}`;
    setIsSubmitting(true);
    try {
      const result = await application.commands.execute({
        schemaVersion: 1,
        commandId: requestId,
        idempotencyKey: requestId,
        correlationId: requestId,
        actor: { kind: "human", id: "tauri-ui" },
        tool: "create_novel_project",
        args: {
          projectId: projectId.trim(),
          title: title.trim(),
          status: "planning",
          payload: { schema_version: 1 },
        },
        createdAt: Date.now(),
      });
      if (result.kind !== "ok")
        throw new Error(
          result.kind === "blocked"
            ? result.diagnostics.map((item) => item.message).join("；")
            : "创建项目未完成。",
        );
      setProjectId("");
      setTitle("");
      await onCommandSucceeded();
      toast.success("项目已创建");
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    setSelectedDocumentId((current) =>
      documents.some((document) => document.documentId === current)
        ? current
        : (documents[0]?.documentId ?? ""),
    );
    setCompareDocumentId((current) =>
      documents.some((document) => document.documentId === current)
        ? current
        : "",
    );
  }, [documents]);

  useEffect(() => {
    if (!application || !selectedProject || !selectedDocumentId) {
      setSelectedDocument(null);
      return;
    }
    let active = true;
    void application.queries
      .getProjectDocument({
        projectId: selectedProject.projectId,
        documentId: selectedDocumentId,
      })
      .then((document) => {
        if (!active) return;
        setSelectedDocument(document);
        setDocumentError(null);
      })
      .catch((cause) => {
        if (active) setDocumentError(messageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [application, selectedProject, selectedDocumentId]);

  useEffect(() => {
    if (!application || !selectedProject || !compareDocumentId) {
      setCompareDocument(null);
      return;
    }
    let active = true;
    void application.queries
      .getProjectDocument({
        projectId: selectedProject.projectId,
        documentId: compareDocumentId,
      })
      .then((document) => {
        if (active) setCompareDocument(document);
      })
      .catch((cause) => {
        if (active) setDocumentError(messageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [application, compareDocumentId, selectedProject]);

  useEffect(() => {
    if (!application || !selectedProject) {
      setProjectWorkbench(null);
      return;
    }
    let active = true;
    void application.queries
      .getProjectWorkbench(selectedProject.projectId)
      .then((workbench) => {
        if (!active) return;
        setProjectWorkbench(workbench);
        setProjectWorkbenchError(null);
      })
      .catch((cause) => {
        if (active) setProjectWorkbenchError(messageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [application, selectedProject, documents]);

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)_18rem]">
      <aside className="space-y-3">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-4">
          <div className="text-sm font-medium">作品</div>
          <div className="mt-3 space-y-1">
            {projects.map((project) => (
              <button
                type="button"
                key={project.projectId}
                onClick={() => onSelectProject(project.projectId)}
                className={`w-full rounded px-2 py-2 text-left text-sm ${project.projectId === selectedProjectId ? "bg-[var(--color-surface-subtle)] font-medium" : "hover:bg-[var(--color-surface-subtle)]"}`}
              >
                <div>{project.title}</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                  {project.status} · r{project.revision}
                </div>
              </button>
            ))}
          </div>
          {projects.length === 0 && (
            <div className="mt-3 text-xs text-[var(--color-text-tertiary)]">
              还没有原创项目。
            </div>
          )}
        </section>
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-4">
          <div className="text-sm font-medium">新建原创项目</div>
          <input
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder="项目 ID"
            className="mt-3 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm"
          />
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="作品名称"
            className="mt-2 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={
              !application || isSubmitting || !projectId.trim() || !title.trim()
            }
            onClick={() => void createProject()}
            className="mt-3 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            创建项目
          </button>
        </section>
      </aside>
      <section className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
        {selectedProject ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{selectedProject.title}</h1>
              <span className="rounded border border-[var(--color-border-default)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">
                {selectedProject.status}
              </span>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                项目 revision {selectedProject.revision}
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              章节、正文、ContextManifest 与评审均经 SQLite 当前 revision 的受控
              QueryService 显示；页面本身不保留业务副本。
            </p>
            <ProductionPlanningActions
              application={application}
              projectId={selectedProject.projectId}
              documents={documents}
              onCommandSucceeded={onCommandSucceeded}
            />
            <DocumentList
              documents={documents}
              selectedDocumentId={selectedDocumentId}
              onSelectDocument={setSelectedDocumentId}
            />
            <DocumentDetail
              document={selectedDocument}
              documents={documents}
              compareDocumentId={compareDocumentId}
              compareDocument={compareDocument}
              onCompareDocument={setCompareDocumentId}
              error={documentError}
            />
          </>
        ) : (
          <EmptyState
            title="选择或创建一部作品"
            detail="外部 Agent 与桌面工作台会看到同一份 SQLite 项目真相。"
          />
        )}
      </section>
      <ProjectWorkbenchSidebar
        workbench={projectWorkbench}
        error={projectWorkbenchError}
      />
    </div>
  );
}

/** 作品页右侧只消费 QueryService 的短投影；完整正文、Prompt 与参考侧内容不在此显示。 */
function ProjectWorkbenchSidebar({
  workbench,
  error,
}: {
  workbench: ProjectWorkbenchView | null;
  error: string | null;
}) {
  if (error)
    return (
      <aside className="space-y-3">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-danger)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-danger)]">
          作品状态读取失败：{error}
        </section>
      </aside>
    );
  if (!workbench)
    return (
      <aside className="space-y-3">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-4">
          <div className="text-sm font-medium">生产状态</div>
          <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
            正在读取当前章节、Canon 与 ReaderPromise…
          </div>
        </section>
      </aside>
    );
  const cursor = workbench.productionCursor;
  const acceptedChapters = workbench.chapters.filter(
    (chapter) => chapter.acceptedDocumentId !== null,
  );
  return (
    <aside className="space-y-3">
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-4">
        <div className="text-sm font-medium">生产状态</div>
        {cursor ? (
          <div className="mt-2 space-y-1 text-sm text-[var(--color-text-secondary)]">
            <div>
              当前已接受：第 {cursor.ordinal} 章 · r
              {cursor.acceptedDocumentRevision}
            </div>
            <div className="text-xs text-[var(--color-text-tertiary)]">
              {cursor.chapterId} · commit {cursor.productionCommitId}
            </div>
            <div className="pt-1">
              下一生产游标：第 {cursor.nextChapterOrdinal} 章
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
            尚无已接受正文；草稿不会自动成为正式章节。
          </div>
        )}
        <div className="mt-3 text-xs text-[var(--color-text-tertiary)]">
          章节 {workbench.chapters.length} · 已接受 {acceptedChapters.length}
        </div>
      </section>
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-4">
        <div className="text-sm font-medium">Canon</div>
        <div className="mt-3 space-y-2">
          {workbench.canonEntries.slice(0, 8).map((entry) => (
            <div
              key={entry.canonEntryId}
              className="rounded bg-[var(--color-surface-subtle)] p-2 text-xs"
            >
              <div>{entry.summary ?? entry.canonEntryId}</div>
              <div className="mt-1 text-[var(--color-text-tertiary)]">
                {entry.canonEntryId} · r{entry.revision} · {entry.status}
              </div>
            </div>
          ))}
          {workbench.canonEntries.length === 0 && (
            <div className="text-sm text-[var(--color-text-tertiary)]">
              尚未提交 Canon。
            </div>
          )}
        </div>
      </section>
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-4">
        <div className="text-sm font-medium">ReaderPromise</div>
        <div className="mt-3 space-y-2">
          {workbench.readerPromises.slice(0, 8).map((promise) => (
            <div
              key={promise.readerPromiseId}
              className="rounded bg-[var(--color-surface-subtle)] p-2 text-xs"
            >
              <div>{promise.summary ?? promise.readerPromiseId}</div>
              <div className="mt-1 text-[var(--color-text-tertiary)]">
                {promise.status} · r{promise.revision}
                {promise.chapterId ? ` · ${promise.chapterId}` : ""}
              </div>
            </div>
          ))}
          {workbench.readerPromises.length === 0 && (
            <div className="text-sm text-[var(--color-text-tertiary)]">
              尚未记录 ReaderPromise。
            </div>
          )}
        </div>
      </section>
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-4">
        <div className="text-sm font-medium">下一步</div>
        <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
          在外部 Agent 中使用 MCP/CLI 启动分析或创作；工作台每秒同步其变更。
        </div>
      </section>
    </aside>
  );
}

/** 原创生产前置的逐步入口；所有持久化仍由桌面 sidecar 的 MCP 领域工具完成。 */
function ProductionPlanningActions({
  application,
  projectId,
  documents,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  projectId: string;
  documents: readonly ProjectDocumentView[];
  onCommandSucceeded: () => Promise<void>;
}) {
  const [kind, setKind] = useState<"project_intent" | "story_concepts" | "select_concept" | "story_contract" | "story_system" | "book_outline" | "stage_plan" | "chapter_contract">("project_intent");
  const [payload, setPayload] = useState("{\n  \"genre\": \"\",\n  \"audience\": \"\",\n  \"targetScale\": \"\",\n  \"experienceGoals\": [\"\"],\n  \"prohibitions\": [\"\"]\n}");
  const [conceptId, setConceptId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [draftDocumentId, setDraftDocumentId] = useState("");
  const [manifestId, setManifestId] = useState("");
  const [readerKind, setReaderKind] = useState<"immersive" | "low_patience" | "logic_sensitive">("immersive");
  const [chapterOrdinal, setChapterOrdinal] = useState("1");
  const [productionCommitId, setProductionCommitId] = useState("");
  const [commitPayload, setCommitPayload] = useState("{\n  \"chapterDelta\": {},\n  \"canonPatches\": [],\n  \"characterKnowledgePatches\": [],\n  \"readerState\": { \"readerStateId\": \"\", \"payload\": {} },\n  \"readerPromiseUpdates\": [],\n  \"outlineDrift\": { \"payload\": {} }\n}");
  const [submitting, setSubmitting] = useState(false);
  const command = () => {
    const id = `ui:production:${crypto.randomUUID()}`;
    return { schemaVersion: 1 as const, commandId: id, idempotencyKey: id, correlationId: id, actor: { kind: "human", id: "tauri-ui" } as const, createdAt: Date.now() };
  };
  const parsePayload = (): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("请输入 JSON 对象。 ");
    return parsed as Record<string, unknown>;
  };
  const submitPlanning = async () => {
    if (!application) return;
    setSubmitting(true);
    try {
      const request = command();
      const result = kind === "story_concepts"
        ? await application.productionActions.submitStoryConcepts({ command: request, projectId, rawOutput: payload })
        : kind === "select_concept"
          ? await application.productionActions.selectStoryConcept({ command: request, projectId, conceptId: conceptId.trim() })
          : kind === "project_intent"
            ? await application.productionActions.saveProjectIntent({ command: request, projectId, intent: parsePayload() })
            : await application.productionActions.savePlanningDocument({ command: request, projectId, kind, payload: parsePayload() });
      if (result.kind !== "ok") throw new Error(result.kind === "blocked" ? result.diagnostics.map((item) => item.message).join("；") : "请求未完成；如已创建确认，请在待处理页核对并批准。 ");
      await onCommandSucceeded();
      toast.success(kind === "select_concept" ? "选择请求已提交；请在待处理页完成持久化确认。" : "规划已保存；待审核资产请在待处理页完成审批。 ");
    } catch (cause) { toast.error(messageOf(cause)); }
    finally { setSubmitting(false); }
  };
  const executeProductionStep = async (step: "recipe" | "writer_manifest" | "reader_manifest") => {
    if (!application || !chapterId.trim()) return;
    setSubmitting(true);
    try {
      const request = command();
      const result = step === "recipe"
        ? await application.productionActions.createCreativeRecipe({ command: request, projectId, chapterId: chapterId.trim() })
        : step === "writer_manifest"
          ? await application.productionActions.freezeChapterContextManifest({ command: request, projectId, chapterId: chapterId.trim(), manifestId: manifestId.trim(), tokenBudget: 32_768, reservedOutputTokens: 4_096 })
          : await application.productionActions.freezeChapterReaderManifest({ command: request, projectId, chapterId: chapterId.trim(), draftDocumentId: draftDocumentId.trim(), manifestId: manifestId.trim(), readerKind, tokenBudget: 16_384 });
      if (result.kind !== "ok") throw new Error(result.kind === "blocked" ? result.diagnostics.map((item) => item.message).join("；") : "生产前置步骤未完成。 ");
      await onCommandSucceeded();
      toast.success("生产前置资产已冻结。 ");
    } catch (cause) { toast.error(messageOf(cause)); }
    finally { setSubmitting(false); }
  };
  const commitChapter = async () => {
    if (!application || !chapterId.trim() || !draftDocumentId.trim() || !productionCommitId.trim()) return;
    setSubmitting(true);
    try {
      const parsed = parsePayloadRecord(commitPayload, "ProductionCommit JSON");
      const chapterDelta = parsePayloadRecordValue(parsed.chapterDelta, "chapterDelta");
      const canonPatches = parsePayloadRecords(parsed.canonPatches, "canonPatches");
      const characterKnowledgePatches = parsePayloadRecords(parsed.characterKnowledgePatches, "characterKnowledgePatches");
      const readerState = parsePayloadRecordValue(parsed.readerState, "readerState");
      const readerPromiseUpdates = parsePayloadRecords(parsed.readerPromiseUpdates, "readerPromiseUpdates");
      const outlineDrift = parsePayloadRecordValue(parsed.outlineDrift, "outlineDrift");
      const result = await application.productionActions.commitChapter({ command: command(), projectId, chapterId: chapterId.trim(), chapterOrdinal: Number(chapterOrdinal), draftDocumentId: draftDocumentId.trim(), productionCommitId: productionCommitId.trim(), chapterDelta, canonPatches, characterKnowledgePatches, readerState, readerPromiseUpdates, outlineDrift });
      if (result.kind === "needs_confirmation") {
        await onCommandSucceeded();
        toast.success("正式章节接受已创建持久化确认；请在待处理页核对后批准。 ");
      } else if (result.kind === "ok") {
        await onCommandSucceeded();
        toast.success("ProductionCommit 已原子接受章节并更新连续性状态。 ");
      } else throw new Error(result.kind === "blocked" ? result.diagnostics.map((item) => item.message).join("；") : "ProductionCommit 未完成。 ");
    } catch (cause) { toast.error(messageOf(cause)); }
    finally { setSubmitting(false); }
  };
  const planningOptions = [
    ["project_intent", "1. ProjectIntent"], ["story_concepts", "2. StoryConcept ×3"], ["select_concept", "3. 选择概念（确认）"], ["story_contract", "4. StoryContract"], ["story_system", "5. StorySystem"], ["book_outline", "6. 全书 Outline"], ["stage_plan", "7. StagePlan"], ["chapter_contract", "8. ChapterContract"],
  ] as const;
  return <section className="mt-5 rounded border border-[var(--color-border-default)] p-4">
    <h2 className="text-base font-semibold">原创生产规划</h2>
    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">按顺序保存、在“待处理”页审核，并在需要时完成持久化确认。此处不保存 Prompt、正文或对象路径。</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1.5 text-sm">
        {planningOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {kind === "select_concept" && <input value={conceptId} onChange={(event) => setConceptId(event.target.value)} placeholder="已审核 StoryConcept ID" className="min-w-64 flex-1 rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />}
      <button type="button" disabled={!application || submitting || (kind === "select_concept" ? !conceptId.trim() : !payload.trim())} onClick={() => void submitPlanning()} className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40">保存当前步骤</button>
    </div>
    {kind !== "select_concept" && <textarea value={payload} onChange={(event) => setPayload(event.target.value)} spellCheck={false} className="mt-3 min-h-44 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] p-2 font-mono text-xs leading-5" aria-label="规划 JSON" />}
    <div className="mt-5 border-t border-[var(--color-border-default)] pt-4">
      <div className="text-sm font-medium">章节配方与 Manifest</div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <input value={chapterId} onChange={(event) => setChapterId(event.target.value)} placeholder="Chapter ID" className="rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />
        <input value={manifestId} onChange={(event) => setManifestId(event.target.value)} placeholder="Manifest ID" className="rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />
        <input value={draftDocumentId} onChange={(event) => setDraftDocumentId(event.target.value)} placeholder="Reader draft Document ID" className="rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={!application || submitting || !chapterId.trim()} onClick={() => void executeProductionStep("recipe")} className="rounded border border-[var(--color-border-default)] px-3 py-1.5 text-xs disabled:opacity-40">冻结 CreativeRecipe</button>
        <button type="button" disabled={!application || submitting || !chapterId.trim() || !manifestId.trim()} onClick={() => void executeProductionStep("writer_manifest")} className="rounded border border-[var(--color-border-default)] px-3 py-1.5 text-xs disabled:opacity-40">冻结 Writer Manifest</button>
        <select value={readerKind} onChange={(event) => setReaderKind(event.target.value as typeof readerKind)} className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1 text-xs"><option value="immersive">沉浸 Reader</option><option value="low_patience">低耐心 Reader</option><option value="logic_sensitive">逻辑 Reader</option></select>
        <button type="button" disabled={!application || submitting || !chapterId.trim() || !manifestId.trim() || !draftDocumentId.trim()} onClick={() => void executeProductionStep("reader_manifest")} className="rounded border border-[var(--color-border-default)] px-3 py-1.5 text-xs disabled:opacity-40">冻结 Reader Manifest</button>
      </div>
      {documents.length > 0 && <div className="mt-2 text-xs text-[var(--color-text-tertiary)]">可从下方项目文档复制草稿 Document ID；Manifest 将只读取领域已登记资产。</div>}
    </div>
    <div className="mt-5 border-t border-[var(--color-border-default)] pt-4">
      <div className="text-sm font-medium">接受正式章节（ProductionCommit）</div>
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">只可选择已存在的 V1/V2/V3 草稿；接受操作必经持久化确认，并原子更新正文及连续性状态。</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <input value={chapterOrdinal} onChange={(event) => setChapterOrdinal(event.target.value)} inputMode="numeric" placeholder="Chapter ordinal" className="rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />
        <input value={productionCommitId} onChange={(event) => setProductionCommitId(event.target.value)} placeholder="Production commit ID" className="rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />
      </div>
      <textarea value={commitPayload} onChange={(event) => setCommitPayload(event.target.value)} spellCheck={false} className="mt-2 min-h-44 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] p-2 font-mono text-xs leading-5" aria-label="ProductionCommit JSON" />
      <button type="button" disabled={!application || submitting || !chapterId.trim() || !draftDocumentId.trim() || !productionCommitId.trim() || !Number.isInteger(Number(chapterOrdinal)) || Number(chapterOrdinal) < 1} onClick={() => void commitChapter()} className="mt-2 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40">创建正式章节接受确认</button>
    </div>
  </section>;
}

function parsePayloadRecord(text: string, label: string): Record<string, unknown> {
  try { return parsePayloadRecordValue(JSON.parse(text), label); } catch (cause) { throw new Error(cause instanceof Error && cause.message.startsWith(label) ? cause.message : `${label} 必须是 JSON 对象。`); }
}

function parsePayloadRecordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
  return value as Record<string, unknown>;
}

function parsePayloadRecords(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是对象数组。`);
  return value.map((item, index) => parsePayloadRecordValue(item, `${label}[${index}]`));
}

function DocumentList({
  documents,
  selectedDocumentId,
  onSelectDocument,
}: {
  documents: readonly ProjectDocumentView[];
  selectedDocumentId: string;
  onSelectDocument: (documentId: string) => void;
}) {
  if (documents.length === 0)
    return (
      <div className="mt-8 text-sm text-[var(--color-text-tertiary)]">
        当前项目尚未产生规划或章节文档。
      </div>
    );
  return (
    <div className="mt-6 divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
      {documents.map((document) => (
        <button
          type="button"
          key={document.documentId}
          onClick={() => onSelectDocument(document.documentId)}
          className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-3 text-left ${document.documentId === selectedDocumentId ? "bg-[var(--color-surface-subtle)]" : "hover:bg-[var(--color-surface-subtle)]"}`}
        >
          <div className="min-w-52 flex-1 px-2">
            <div className="text-sm font-medium">{document.title}</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
              {document.documentType} · {document.documentId}
            </div>
          </div>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {document.status}
          </span>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            r{document.revision}
          </span>
          {document.contentObjectHash && (
            <span className="pr-2 text-[11px] text-[var(--color-text-tertiary)]">
              对象内容
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function DocumentDetail({
  document,
  documents,
  compareDocumentId,
  compareDocument,
  onCompareDocument,
  error,
}: {
  document: ProjectDocumentContentView | null;
  documents: readonly ProjectDocumentView[];
  compareDocumentId: string;
  compareDocument: ProjectDocumentContentView | null;
  onCompareDocument: (documentId: string) => void;
  error: string | null;
}) {
  if (error)
    return (
      <div className="mt-5 rounded border border-[var(--color-danger)] p-3 text-sm text-[var(--color-danger)]">
        文档内容读取失败：{error}
      </div>
    );
  if (!document)
    return (
      <div className="mt-6 text-sm text-[var(--color-text-tertiary)]">
        从上方列表选择文档，即可读取当前 revision 的正文、ContextManifest
        或评审报告。
      </div>
    );
  const candidates = documents.filter(
    (candidate) =>
      candidate.documentId !== document.documentId &&
      candidate.contentObjectHash !== null,
  );
  const isText =
    document.documentType === "local_creation_draft" ||
    document.documentType === "chapter_editor_draft" ||
    document.documentType === "chapter_text";
  const formattedContent =
    isText || !document.content
      ? document.content
      : safelyFormatJson(document.content);
  return (
    <section className="mt-6 rounded border border-[var(--color-border-default)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{document.title}</h2>
        <span className="rounded border border-[var(--color-border-default)] px-2 py-0.5 text-xs">
          {document.documentType}
        </span>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          r{document.revision} · {document.status}
        </span>
      </div>
      <div className="mt-3 max-h-[32rem] overflow-auto rounded bg-[var(--color-surface-subtle)] p-3">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
          {formattedContent ??
            "此文档没有对象内容；可在下方查看其当前结构化 payload。"}
        </pre>
      </div>
      <details className="mt-3 rounded border border-[var(--color-border-default)] p-3">
        <summary className="cursor-pointer text-sm font-medium">
          当前 revision 的结构化索引
        </summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[var(--color-text-secondary)]">
          {JSON.stringify(document.payload, null, 2)}
        </pre>
      </details>
      {candidates.length > 0 && (
        <div className="mt-4">
          <label
            className="text-sm font-medium"
            htmlFor="document-version-compare"
          >
            比较版本
          </label>
          <select
            id="document-version-compare"
            value={compareDocumentId}
            onChange={(event) => onCompareDocument(event.target.value)}
            className="ml-3 rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1 text-sm"
          >
            <option value="">选择另一份有内容的项目文档</option>
            {candidates.map((candidate) => (
              <option key={candidate.documentId} value={candidate.documentId}>
                {candidate.title} · {candidate.documentType} · r
                {candidate.revision}
              </option>
            ))}
          </select>
          {compareDocument && (
            <VersionDiff before={compareDocument} after={document} />
          )}
        </div>
      )}
    </section>
  );
}

function VersionDiff({
  before,
  after,
}: {
  before: ProjectDocumentContentView;
  after: ProjectDocumentContentView;
}) {
  if (before.content === null || after.content === null)
    return (
      <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">
        所选版本至少有一份不含正文对象，无法生成文本差异。
      </div>
    );
  const diff = calculateTextDiff(before.content, after.content);
  return (
    <div className="mt-3 rounded border border-[var(--color-border-default)] p-3">
      <div className="text-sm font-medium">
        {before.title} → {after.title}
      </div>
      {diff.unchanged ? (
        <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
          两个对象内容完全一致。
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <DiffFragment
            label="旧版本改动片段"
            prefix={diff.prefix}
            changed={diff.beforeChanged}
            suffix={diff.suffix}
            tone="before"
          />
          <DiffFragment
            label="当前版本改动片段"
            prefix={diff.prefix}
            changed={diff.afterChanged}
            suffix={diff.suffix}
            tone="after"
          />
        </div>
      )}
    </div>
  );
}

function DiffFragment({
  label,
  prefix,
  changed,
  suffix,
  tone,
}: {
  label: string;
  prefix: string;
  changed: string;
  suffix: string;
  tone: "before" | "after";
}) {
  const prefixTail = Array.from(prefix).slice(-180).join("");
  const suffixHead = Array.from(suffix).slice(0, 180).join("");
  return (
    <div>
      <div className="text-xs text-[var(--color-text-tertiary)]">{label}</div>
      <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-[var(--color-surface-subtle)] p-2 text-sm leading-6">
        {prefix.length > prefixTail.length ? "…" : ""}
        {prefixTail}
        <mark
          className={
            tone === "before"
              ? "bg-red-100 text-red-900"
              : "bg-emerald-100 text-emerald-900"
          }
        >
          {changed || "（删除）"}
        </mark>
        {suffixHead}
        {suffix.length > suffixHead.length ? "…" : ""}
      </pre>
    </div>
  );
}

function safelyFormatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function ReferencesPanel({
  application,
  references,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  references: readonly ReferenceWorkSummary[];
  onCommandSucceeded: () => Promise<void>;
}) {
  const [selectedReferenceId, setSelectedReferenceId] = useState("");
  const [workbench, setWorkbench] = useState<ReferenceWorkbenchView | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSelectedReferenceId((current) =>
      references.some((reference) => reference.referenceWorkId === current)
        ? current
        : (references[0]?.referenceWorkId ?? ""),
    );
  }, [references]);
  useEffect(() => {
    if (!application || !selectedReferenceId) {
      setWorkbench(null);
      return;
    }
    let active = true;
    void application.queries
      .getReferenceWorkbench(selectedReferenceId)
      .then((next) => {
        if (active) {
          setWorkbench(next);
          setError(null);
        }
      })
      .catch((cause) => {
        if (active) setError(messageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [application, selectedReferenceId]);

  return (
    <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-4">
        <h1 className="text-lg font-semibold">参考</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          原文不在此列表中。证据只显示可复核的 SourceSpan、Hash 和 Coverage
          处置，且不会进入 Writer 上下文。
        </p>
        <div className="mt-4 space-y-1">
          {references.map((reference) => (
            <button
              type="button"
              key={reference.referenceWorkId}
              onClick={() => setSelectedReferenceId(reference.referenceWorkId)}
              className={`w-full rounded px-2 py-2 text-left ${reference.referenceWorkId === selectedReferenceId ? "bg-[var(--color-surface-subtle)]" : "hover:bg-[var(--color-surface-subtle)]"}`}
            >
              <div className="text-sm font-medium">{reference.title}</div>
              <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
                {reference.status} · r{reference.revision}
              </div>
            </button>
          ))}
          {references.length === 0 && (
            <div className="py-8 text-sm text-[var(--color-text-tertiary)]">
              尚未导入参考文本。请由 MCP/CLI 的 `import_reference_text`
              明确提交文本。
            </div>
          )}
        </div>
      </section>
      <section className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
        {error && (
          <div className="rounded border border-[var(--color-danger)] p-3 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}
        {workbench ? (
          <ReferenceWorkbenchDetail
            application={application}
            workbench={workbench}
            onCommandSucceeded={onCommandSucceeded}
          />
        ) : (
          <EmptyState
            title="选择一部参考作品"
            detail="分析运行、证据与 Coverage 会在这里随 change feed 刷新。"
          />
        )}
      </section>
    </div>
  );
}

function ReferenceWorkbenchDetail({
  application,
  workbench,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  workbench: ReferenceWorkbenchView;
  onCommandSucceeded: () => Promise<void>;
}) {
  const [excerpt, setExcerpt] = useState<{
    evidenceInstanceId: string;
    text: string;
    truncated: boolean;
  } | null>(null);
  const [excerptError, setExcerptError] = useState<string | null>(null);
  const openExcerpt = async (evidenceInstanceId: string) => {
    if (!application) return;
    try {
      const value =
        await application.queries.getEvidenceExcerpt(evidenceInstanceId);
      if (!value) throw new Error("证据不存在。");
      setExcerpt(value);
      setExcerptError(null);
    } catch (cause) {
      setExcerptError(messageOf(cause));
    }
  };
  const approveBrief = async (analysisProjectId: string) => {
    if (!application) return;
    const requestId = `ui:approve-analysis-brief:${crypto.randomUUID()}`;
    try {
      const result = await application.commands.execute({
        schemaVersion: 1,
        commandId: requestId,
        idempotencyKey: requestId,
        correlationId: requestId,
        actor: { kind: "human", id: "tauri-ui" },
        tool: "approve_analysis_brief",
        args: { analysisProjectId },
        createdAt: Date.now(),
      });
      if (result.kind !== "ok")
        throw new Error(
          result.kind === "blocked"
            ? result.diagnostics.map((item) => item.message).join("；")
            : "AnalysisBrief 未获批准。 ",
        );
      await onCommandSucceeded();
      toast.success(
        "AnalysisBrief 已批准；现在可提交受该问题约束的结论与独立反证。",
      );
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{workbench.title}</h2>
        <span className="rounded border border-[var(--color-border-default)] px-2 py-0.5 text-xs">
          {workbench.status}
        </span>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          r{workbench.revision}
        </span>
      </div>
      <div className="mt-5">
        <h3 className="text-sm font-medium">SourceEdition</h3>
        <div className="mt-2 divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
          {workbench.sourceEditions.map((edition) => (
            <div key={edition.sourceEditionId} className="py-2 text-sm">
              <div>{edition.sourceEditionId}</div>
              <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                {edition.encoding} · {edition.byteLength.toLocaleString()} bytes
                · 约 {edition.tokenEstimate.toLocaleString()} tokens · hash{" "}
                {edition.sourceHash.slice(0, 12)}…
              </div>
            </div>
          ))}
          {workbench.sourceEditions.length === 0 && (
            <div className="py-3 text-sm text-[var(--color-text-tertiary)]">
              尚未建立 SourceEdition。
            </div>
          )}
        </div>
      </div>
      <AnalysisCorpusStarter
        application={application}
        sourceEditions={workbench.sourceEditions}
        onCommandSucceeded={onCommandSucceeded}
      />
      {excerptError && (
        <div className="mt-3 text-sm text-[var(--color-danger)]">
          {excerptError}
        </div>
      )}
      {excerpt && (
        <section className="mt-3 rounded border border-[var(--color-border-default)] p-3">
          <div className="text-sm font-medium">
            证据原文摘录 · {excerpt.evidenceInstanceId}
          </div>
          <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
            {excerpt.text}
            {excerpt.truncated ? "\n…（该 SourceSpan 摘录已按上限截断）" : ""}
          </pre>
        </section>
      )}
      <div className="mt-6 space-y-5">
        {workbench.analyses.map((analysis) => (
          <section
            key={analysis.analysisProjectId}
            className="rounded border border-[var(--color-border-default)] p-4"
          >
            <div className="flex flex-wrap gap-2">
              <h3 className="flex-1 text-sm font-medium">
                分析 {analysis.analysisProjectId}
              </h3>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {analysis.status} · r{analysis.revision}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {analysis.coverageSummary.map((coverage) => (
                <span
                  key={coverage.status}
                  className="rounded border border-[var(--color-border-default)] px-2 py-0.5 text-xs"
                >
                  {coverage.status}: {coverage.count}
                </span>
              ))}
              {analysis.coverageSummary.length === 0 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  尚无 Coverage 处置
                </span>
              )}
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="text-sm font-medium">可核验证据</div>
                <div className="mt-2 space-y-2">
                  {analysis.evidence.map((evidence) => (
                    <button
                      type="button"
                      key={evidence.evidenceInstanceId}
                      onClick={() =>
                        void openExcerpt(evidence.evidenceInstanceId)
                      }
                      className="block w-full rounded bg-[var(--color-surface-subtle)] p-2 text-left text-xs hover:ring-1 hover:ring-[var(--color-accent)]"
                    >
                      <div>
                        {evidence.role} · {evidence.spanId}
                      </div>
                      <div className="mt-1 text-[var(--color-text-tertiary)]">
                        [{evidence.startByte}, {evidence.endByte}) · source{" "}
                        {evidence.sourceHash.slice(0, 12)}… · exact{" "}
                        {evidence.exactTextHash.slice(0, 12)}…
                      </div>
                    </button>
                  ))}
                  {analysis.evidence.length === 0 && (
                    <div className="text-sm text-[var(--color-text-tertiary)]">
                      尚无已提交证据。
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium">未完整覆盖 / 弃权处置</div>
                <div className="mt-2 space-y-2">
                  {analysis.unresolvedCoverage.map((coverage) => (
                    <div
                      key={coverage.coverageEntryId}
                      className="rounded bg-[var(--color-surface-subtle)] p-2 text-xs"
                    >
                      <div>
                        {coverage.module} · {coverage.status}
                      </div>
                      <div className="mt-1 text-[var(--color-text-tertiary)]">
                        {coverage.reason}
                        {coverage.analysisUnitId
                          ? ` · ${coverage.analysisUnitId}`
                          : ""}
                      </div>
                    </div>
                  ))}
                  {analysis.unresolvedCoverage.length === 0 && (
                    <div className="text-sm text-[var(--color-text-tertiary)]">
                      所有已有 Coverage 条目均为 complete。
                    </div>
                  )}
                </div>
              </div>
            </div>
            <AnalysisStageActions
              application={application}
              analysisProjectId={analysis.analysisProjectId}
              onCommandSucceeded={onCommandSucceeded}
            />
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm font-medium">ResearchQuestion / AnalysisBrief</div>
                {analysis.researchQuestions.some((question) => question.status === "pending_review") && (
                  <button
                    type="button"
                    disabled={!application}
                    onClick={() => void approveBrief(analysis.analysisProjectId)}
                    className="rounded border border-[var(--color-border-default)] px-2 py-1 text-xs disabled:opacity-40"
                  >
                    批准全部待审核问题
                  </button>
                )}
              </div>
              <div className="mt-2 space-y-2">
                {analysis.researchQuestions.map((question) => (
                  <div key={question.researchQuestionId} className="rounded bg-[var(--color-surface-subtle)] p-2 text-xs">
                    <div><span className="font-medium">Q{question.ordinal}</span> · {question.status} · {question.question}</div>
                    <div className="mt-1 text-[var(--color-text-tertiary)]">研究理由：{question.rationale}</div>
                    <div className="mt-1 text-[var(--color-text-tertiary)]">生产用途：{question.productionUse}</div>
                  </div>
                ))}
                {analysis.researchQuestions.length === 0 && <div className="text-sm text-[var(--color-text-tertiary)]">尚未提交 AnalysisBrief。</div>}
              </div>
            </div>
            <div className="mt-4">
              <div className="text-sm font-medium">MechanismAsset（由结论编译的候选）</div>
              <div className="mt-2 space-y-2">
                {analysis.mechanisms.map((mechanism) => (
                  <details key={mechanism.mechanismAssetId} className="rounded border border-[var(--color-border-default)] p-2 text-xs">
                    <summary className="cursor-pointer"><span className="font-medium">{mechanism.mechanismAssetId}</span> · {mechanism.status} · r{mechanism.revision}</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words">{safelyFormatJson(JSON.stringify(mechanism.payload))}</pre>
                  </details>
                ))}
                {analysis.mechanisms.length === 0 && <div className="text-sm text-[var(--color-text-tertiary)]">尚未从已验证结论编译 MechanismAsset。</div>}
              </div>
            </div>
            <div className="mt-4">
              <div className="text-sm font-medium">
                分析链（Fact / Thread / Question / Conclusion / Falsification）
              </div>
              <div className="mt-2 space-y-2">
                {analysis.analysisItems.map((item) => (
                  <details
                    key={item.analysisItemId}
                    className="rounded border border-[var(--color-border-default)] p-2 text-xs"
                  >
                    <summary className="cursor-pointer">
                      <span className="font-medium">{item.kind}</span> ·{" "}
                      {item.epistemicStatus}
                      {item.researchQuestionId
                        ? ` · 问题 ${item.researchQuestionId}`
                        : ""}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words">
                      {safelyFormatJson(JSON.stringify(item.payload))}
                    </pre>
                  </details>
                ))}
                {analysis.analysisItems.length === 0 && (
                  <div className="text-sm text-[var(--color-text-tertiary)]">
                    尚无已提交分析产物。
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
        {workbench.analyses.length === 0 && (
          <div className="text-sm text-[var(--color-text-tertiary)]">
            此 ReferenceWork 尚未启动 V2 分析。
          </div>
        )}
      </div>
    </>
  );
}

function AnalysisCorpusStarter({
  application,
  sourceEditions,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  sourceEditions: ReferenceWorkbenchView["sourceEditions"];
  onCommandSucceeded: () => Promise<void>;
}) {
  const [analysisProjectId, setAnalysisProjectId] = useState("");
  const [segmentationId, setSegmentationId] = useState("");
  const [sourceEditionId, setSourceEditionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setSourceEditionId((current) => sourceEditions.some((edition) => edition.sourceEditionId === current) ? current : (sourceEditions[0]?.sourceEditionId ?? ""));
  }, [sourceEditions]);
  const submit = async () => {
    if (!application || !analysisProjectId.trim() || !segmentationId.trim() || !sourceEditionId) return;
    const requestId = `ui:analysis-corpus:${crypto.randomUUID()}`;
    setSubmitting(true);
    try {
      const result = await application.analysisActions.prepareCorpus({
        command: { schemaVersion: 1, commandId: requestId, idempotencyKey: requestId, correlationId: requestId, actor: { kind: "human", id: "tauri-ui" }, createdAt: Date.now() },
        analysisProjectId: analysisProjectId.trim(), segmentationId: segmentationId.trim(), sourceEditionId,
        boundary: "complete",
        budget: { contextWindowTokens: 32_768, safetyMarginRatio: 0.2, reservedOutputTokens: 4_096, renderedSystemPromptTokens: 1_024, renderedSchemaTokens: 1_024, envelopeTokens: 512 },
      });
      if (result.kind !== "ok") throw new Error(result.kind === "blocked" ? result.diagnostics.map((item) => item.message).join("；") : "AnalysisCorpus 未创建。 ");
      await onCommandSucceeded();
      toast.success("AnalysisCorpus 已冻结；可在设置页 Pipeline 中启动 FactExtractor。 ");
    } catch (cause) { toast.error(messageOf(cause)); }
    finally { setSubmitting(false); }
  };
  return <section className="mt-4 rounded border border-[var(--color-border-default)] p-3">
    <h3 className="text-sm font-medium">启动 V2 分析</h3>
    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">冻结完整 SourceEdition 的 AnalysisCorpus；上下文预算取当前默认安全值，后续可由受控 Pipeline 启动 FactExtractor。</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-3">
      <input value={analysisProjectId} onChange={(event) => setAnalysisProjectId(event.target.value)} placeholder="Analysis Project ID" className="rounded border border-[var(--color-border-default)] px-2 py-1 text-sm" />
      <input value={segmentationId} onChange={(event) => setSegmentationId(event.target.value)} placeholder="Segmentation ID" className="rounded border border-[var(--color-border-default)] px-2 py-1 text-sm" />
      <select value={sourceEditionId} onChange={(event) => setSourceEditionId(event.target.value)} className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1 text-sm">
        {sourceEditions.map((edition) => <option key={edition.sourceEditionId} value={edition.sourceEditionId}>{edition.sourceEditionId}</option>)}
      </select>
    </div>
    <button type="button" disabled={!application || submitting || !analysisProjectId.trim() || !segmentationId.trim() || !sourceEditionId} onClick={() => void submit()} className="mt-2 rounded border border-[var(--color-border-default)] px-2 py-1 text-xs disabled:opacity-40">{submitting ? "正在冻结…" : "冻结 AnalysisCorpus"}</button>
  </section>;
}

type AnalysisStage =
  | "structural_reading_map"
  | "thread_graph"
  | "analysis_brief"
  | "research_conclusions"
  | "independent_falsification"
  | "research_dossier"
  | "mechanism_candidate";

/** 原始 JSON 只在提交时穿过 sidecar 到 Node ObjectStore，组件不保存业务副本。 */
function AnalysisStageActions({
  application,
  analysisProjectId,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  analysisProjectId: string;
  onCommandSucceeded: () => Promise<void>;
}) {
  const [stage, setStage] = useState<AnalysisStage>("thread_graph");
  const [targetId, setTargetId] = useState("");
  const [rawOutput, setRawOutput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const needsTarget = stage === "research_conclusions" || stage === "independent_falsification";
  const needsRawOutput = stage !== "research_dossier" && stage !== "structural_reading_map";
  const submit = async () => {
    if (!application || (needsRawOutput && !rawOutput.trim()) || (needsTarget && !targetId.trim())) return;
    const requestId = `ui:analysis:${stage}:${crypto.randomUUID()}`;
    const command = { schemaVersion: 1 as const, commandId: requestId, idempotencyKey: requestId, correlationId: requestId, actor: { kind: "human" as const, id: "tauri-ui" }, createdAt: Date.now() };
    setSubmitting(true);
    try {
      const result = stage === "structural_reading_map"
        ? await application.analysisActions.createStructuralReadingMap({ command, analysisProjectId })
        : stage === "thread_graph"
        ? await application.analysisActions.submitThreadGraph({ command, analysisProjectId, rawOutput })
        : stage === "analysis_brief"
          ? await application.analysisActions.submitAnalysisBrief({ command, analysisProjectId, rawOutput })
          : stage === "research_conclusions"
            ? await application.analysisActions.submitResearchConclusions({ command, analysisProjectId, researchQuestionId: targetId.trim(), rawOutput })
            : stage === "independent_falsification"
              ? await application.analysisActions.submitIndependentFalsification({ command, analysisProjectId, conclusionId: targetId.trim(), rawOutput })
              : stage === "research_dossier"
                ? await application.analysisActions.createResearchDossier({ command, analysisProjectId })
                : await application.analysisActions.proposeMechanismCandidate({ command, analysisProjectId, rawOutput });
      if (result.kind !== "ok") throw new Error(result.kind === "blocked" ? result.diagnostics.map((item) => item.message).join("；") : "分析阶段未完成。 ");
      setRawOutput("");
      await onCommandSucceeded();
      toast.success("分析阶段已提交；可继续查看证据与复核结果。");
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <section className="mt-4 rounded border border-[var(--color-border-default)] p-3">
      <h4 className="text-sm font-medium">分析阶段操作</h4>
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
        结构化 JSON 仅在提交时由受信 Node sidecar 写入 ObjectStore；不会写入浏览器状态、SQLite 配置或 Writer 上下文。
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select value={stage} onChange={(event) => setStage(event.target.value as AnalysisStage)} className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1.5 text-sm">
          <option value="structural_reading_map">创建 StructuralReadingMap</option>
          <option value="thread_graph">提交 ThreadGraph</option>
          <option value="analysis_brief">提交 AnalysisBrief</option>
          <option value="research_conclusions">提交研究结论</option>
          <option value="independent_falsification">提交独立反证</option>
          <option value="research_dossier">冻结 ResearchDossier</option>
          <option value="mechanism_candidate">编译 Mechanism 候选</option>
        </select>
        {needsTarget && <input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder={stage === "research_conclusions" ? "ResearchQuestion ID" : "Conclusion ID"} className="rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm" />}
      </div>
      {needsRawOutput && <textarea value={rawOutput} onChange={(event) => setRawOutput(event.target.value)} rows={5} placeholder="粘贴该阶段严格 JSON 输出" className="mt-2 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5 font-mono text-xs" />}
      <button type="button" disabled={!application || submitting || (needsRawOutput && !rawOutput.trim()) || (needsTarget && !targetId.trim())} onClick={() => void submit()} className="mt-2 rounded border border-[var(--color-border-default)] px-2 py-1 text-xs disabled:opacity-40">
        {submitting ? "正在提交…" : "提交此阶段"}
      </button>
    </section>
  );
}

function PendingPanel({
  application,
  projects,
  confirmations,
  tasks,
  pendingPlanningDocuments,
  pendingMechanismAssets,
  coverageGaps,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  projects: readonly NovelProjectRecord[];
  confirmations: readonly Pick<
    ConfirmationView,
    "confirmationId" | "risk" | "expiresAt" | "targetSummary"
  >[];
  tasks: readonly ActionableTaskView[];
  pendingPlanningDocuments: readonly PendingPlanningDocumentView[];
  pendingMechanismAssets: readonly PendingMechanismAssetView[];
  coverageGaps: readonly CoverageGapView[];
  onCommandSucceeded: () => Promise<void>;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [mechanismTargets, setMechanismTargets] = useState<
    Record<string, string>
  >({});
  const approve = async (confirmationId: string) => {
    if (!application || !reasons[confirmationId]?.trim()) return;
    try {
      const result = await application.commands.approveConfirmation({
        confirmationId,
        actor: { kind: "human", id: "tauri-ui" },
        reason: reasons[confirmationId]!.trim(),
      });
      if (result.kind !== "ok") throw new Error("确认未获批准。");
      await onCommandSucceeded();
      toast.success("已记录确认");
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  const reject = async (confirmationId: string) => {
    if (!application || !reasons[confirmationId]?.trim()) return;
    try {
      const result = await application.commands.rejectConfirmation({
        confirmationId,
        actor: { kind: "human", id: "tauri-ui" },
        reason: reasons[confirmationId]!.trim(),
      });
      if (result.kind !== "ok") throw new Error("确认未被拒绝。 ");
      await onCommandSucceeded();
      toast.success("已拒绝命令并记录理由");
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  const runTaskAction = async (
    task: ActionableTaskView,
    action: "retry" | "requestCancel",
  ) => {
    if (!application) return;
    try {
      const next =
        action === "retry"
          ? await application.taskActions.retry(task.taskId)
          : await application.taskActions.requestCancel(task.taskId);
      await onCommandSucceeded();
      toast.success(
        action === "retry"
          ? `任务已重新排队（retry ${next.retryCount}）`
          : "已请求取消任务",
      );
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  const reviewPlanning = async (
    document: PendingPlanningDocumentView,
    status: "approved" | "rejected",
  ) => {
    if (!application) return;
    const requestId = `ui:planning-review:${crypto.randomUUID()}`;
    try {
      const result = await application.planningActions.reviewDocument({
        command: {
          schemaVersion: 1,
          commandId: requestId,
          idempotencyKey: requestId,
          correlationId: requestId,
          actor: { kind: "human", id: "tauri-ui" },
          createdAt: Date.now(),
        },
        projectId: document.projectId,
        documentId: document.documentId,
        expectedRevision: document.revision,
        status,
      });
      if (result.kind === "conflict") {
        await onCommandSucceeded();
        toast.error(
          `${result.diagnostics.map((item) => item.message).join("；")} 当前文档已刷新，请在作品页核对新版内容。`,
        );
        return;
      }
      if (result.kind !== "ok")
        throw new Error(
          result.kind === "blocked"
            ? result.diagnostics.map((item) => item.message).join("；")
            : "规划审核未完成。 ",
        );
      await onCommandSucceeded();
      toast.success(
        status === "approved"
          ? "规划已批准"
          : "规划已驳回；可由外部 Agent 生成新的候选 revision",
      );
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  const reviewMechanism = async (
    asset: PendingMechanismAssetView,
    status: "adopted" | "editor_only" | "rejected",
  ) => {
    if (!application) return;
    const projectId =
      mechanismTargets[asset.mechanismAssetId] ?? projects[0]?.projectId ?? "";
    if (!projectId) {
      toast.error("请先创建或选择一个原创项目，再决定机制的生产用途。");
      return;
    }
    const requestId = `ui:review-mechanism:${crypto.randomUUID()}`;
    try {
      const result = await application.mechanismActions.review({
        command: {
          schemaVersion: 1,
          commandId: requestId,
          idempotencyKey: requestId,
          correlationId: requestId,
          actor: { kind: "human", id: "tauri-ui" },
          projectId,
          expectedRevision: asset.revision,
          createdAt: Date.now(),
        },
        mechanismAssetId: asset.mechanismAssetId,
        status,
      });
      if (result.kind === "conflict") {
        await onCommandSucceeded();
        toast.error("机制候选已有新 revision；已刷新列表，请重新审阅后决定。");
        return;
      }
      if (result.kind !== "ok") throw new Error("机制审核未完成。");
      await onCommandSucceeded();
      toast.success(
        status === "adopted"
          ? "机制已采纳到所选原创项目"
          : status === "editor_only"
            ? "机制已限定为 Editor 使用"
            : "机制已拒绝",
      );
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  return (
    <>
      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
          <h1 className="text-lg font-semibold">待确认命令</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            批准会重新校验命令
            Hash、版本与目标资源；批准或拒绝理由都会进入审计。
          </p>
          <div className="mt-5 space-y-3">
            {confirmations.map((confirmation) => (
              <div
                key={confirmation.confirmationId}
                className="rounded border border-[var(--color-border-default)] p-3"
              >
                <div className="text-sm font-medium">{confirmation.risk}</div>
                <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {confirmation.targetSummary}
                </div>
                <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {confirmation.confirmationId} · 到期{" "}
                  {new Date(confirmation.expiresAt).toLocaleString()}
                </div>
                <input
                  value={reasons[confirmation.confirmationId] ?? ""}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [confirmation.confirmationId]: event.target.value,
                    }))
                  }
                  placeholder="处理理由（必填）"
                  className="mt-3 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={
                      !application ||
                      !(reasons[confirmation.confirmationId] ?? "").trim()
                    }
                    onClick={() => void approve(confirmation.confirmationId)}
                    className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
                  >
                    批准
                  </button>
                  <button
                    type="button"
                    disabled={
                      !application ||
                      !(reasons[confirmation.confirmationId] ?? "").trim()
                    }
                    onClick={() => void reject(confirmation.confirmationId)}
                    className="rounded border border-[var(--color-border-default)] px-2 py-1.5 text-sm disabled:opacity-40"
                  >
                    拒绝
                  </button>
                </div>
              </div>
            ))}
            {confirmations.length === 0 && (
              <div className="text-sm text-[var(--color-text-tertiary)]">
                没有待确认命令。
              </div>
            )}
          </div>
        </section>
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
          <h2 className="text-lg font-semibold">需处理任务</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            取消和重试经 Application Service 的 TaskRunner
            入口执行，浏览器不直接更新任务表。
          </p>
          <div className="mt-5 space-y-3">
            {tasks.map((task) => (
              <div
                key={task.taskId}
                className="rounded border border-[var(--color-border-default)] p-3"
              >
                <div className="flex gap-2">
                  <span className="flex-1 text-sm font-medium">
                    {task.taskType}
                  </span>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {task.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {task.taskId} · retry {task.retryCount} · {task.resourceKey}
                </div>
                <div className="mt-3 flex gap-2">
                  {task.status === "failed" && (
                    <button
                      type="button"
                      disabled={!application}
                      onClick={() => void runTaskAction(task, "retry")}
                      className="rounded border border-[var(--color-border-default)] px-2 py-1 text-xs disabled:opacity-40"
                    >
                      重新排队
                    </button>
                  )}
                  {[
                    "queued",
                    "running",
                    "waiting_confirmation",
                    "paused",
                  ].includes(task.status) && (
                    <button
                      type="button"
                      disabled={!application}
                      onClick={() => void runTaskAction(task, "requestCancel")}
                      className="rounded border border-[var(--color-border-default)] px-2 py-1 text-xs disabled:opacity-40"
                    >
                      请求取消
                    </button>
                  )}
                </div>
              </div>
            ))}
            {tasks.length === 0 && (
              <div className="text-sm text-[var(--color-text-tertiary)]">
                没有失败、暂停或等待的任务。
              </div>
            )}
          </div>
        </section>
      </div>
      <PendingMechanismReviews
        application={application}
        projects={projects}
        assets={pendingMechanismAssets}
        targets={mechanismTargets}
        onTargetChange={(assetId, projectId) =>
          setMechanismTargets((current) => ({
            ...current,
            [assetId]: projectId,
          }))
        }
        onReview={reviewMechanism}
      />
      <CoverageGaps gaps={coverageGaps} />
      <PendingPlanningReviews
        application={application}
        documents={pendingPlanningDocuments}
        onReview={reviewPlanning}
      />
    </>
  );
}

function PendingMechanismReviews({
  application,
  projects,
  assets,
  targets,
  onTargetChange,
  onReview,
}: {
  application: WorkspaceApplicationService | null;
  projects: readonly NovelProjectRecord[];
  assets: readonly PendingMechanismAssetView[];
  targets: Readonly<Record<string, string>>;
  onTargetChange: (assetId: string, projectId: string) => void;
  onReview: (
    asset: PendingMechanismAssetView,
    status: "adopted" | "editor_only" | "rejected",
  ) => Promise<void>;
}) {
  return (
    <section className="mx-auto mt-5 max-w-5xl rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">待采纳机制</h2>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        只显示机制候选的短投影。采纳会从当前 revision 重新读取完整领域卡并使用
        CAS；Writer 之后只能读取已采纳的去来源化投影。
      </p>
      <div className="mt-5 space-y-3">
        {assets.map((asset) => {
          const target =
            targets[asset.mechanismAssetId] ?? projects[0]?.projectId ?? "";
          return (
            <div
              key={asset.mechanismAssetId}
              className="rounded border border-[var(--color-border-default)] p-3"
            >
              <div className="flex flex-wrap gap-2">
                <div className="flex-1 text-sm font-medium">{asset.title}</div>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  r{asset.revision} · {asset.scope ?? "scope 未标注"}
                </span>
              </div>
              {asset.targetEffect && (
                <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
                  {asset.targetEffect}
                </div>
              )}
              <div className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                {asset.mechanismAssetId} · {asset.analysisProjectId} ·{" "}
                {asset.targetLayers.join(" / ") || "未标注层级"}
              </div>
              <label className="mt-3 block text-xs text-[var(--color-text-secondary)]">
                采纳到原创项目
                <select
                  value={target}
                  onChange={(event) =>
                    onTargetChange(asset.mechanismAssetId, event.target.value)
                  }
                  disabled={!application || projects.length === 0}
                  className="ml-2 rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1 text-sm"
                >
                  {projects.length === 0 && (
                    <option value="">先创建原创项目</option>
                  )}
                  {projects.map((project) => (
                    <option key={project.projectId} value={project.projectId}>
                      {project.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!application || !target}
                  onClick={() => void onReview(asset, "adopted")}
                  className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white disabled:opacity-40"
                >
                  采纳
                </button>
                <button
                  type="button"
                  disabled={!application || !target}
                  onClick={() => void onReview(asset, "editor_only")}
                  className="rounded border border-[var(--color-border-default)] px-2 py-1 text-xs disabled:opacity-40"
                >
                  仅 Editor
                </button>
                <button
                  type="button"
                  disabled={!application || !target}
                  onClick={() => void onReview(asset, "rejected")}
                  className="rounded border border-[var(--color-border-default)] px-2 py-1 text-xs disabled:opacity-40"
                >
                  拒绝
                </button>
              </div>
            </div>
          );
        })}
        {assets.length === 0 && (
          <div className="text-sm text-[var(--color-text-tertiary)]">
            没有待采纳机制。
          </div>
        )}
      </div>
    </section>
  );
}

function CoverageGaps({ gaps }: { gaps: readonly CoverageGapView[] }) {
  return (
    <section className="mx-auto mt-5 max-w-5xl rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">Coverage 缺口与弃权</h2>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        每个非 complete
        处置都保留原因；它可能是失败、预算限制或合理的未观察到模式，不会被静默丢弃。
      </p>
      <div className="mt-5 space-y-2">
        {gaps.map((gap) => (
          <div
            key={gap.coverageEntryId}
            className="rounded border border-[var(--color-border-default)] p-3 text-sm"
          >
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <span className="font-medium">{gap.referenceTitle}</span>
              <span className="text-[var(--color-text-secondary)]">
                {gap.module} · {gap.status}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {gap.reason} · {gap.analysisProjectId}
              {gap.analysisUnitId ? ` · ${gap.analysisUnitId}` : ""}
            </div>
          </div>
        ))}
        {gaps.length === 0 && (
          <div className="text-sm text-[var(--color-text-tertiary)]">
            没有未 complete 的 Coverage 条目。
          </div>
        )}
      </div>
    </section>
  );
}

function PendingPlanningReviews({
  application,
  documents,
  onReview,
}: {
  application: WorkspaceApplicationService | null;
  documents: readonly PendingPlanningDocumentView[];
  onReview: (
    document: PendingPlanningDocumentView,
    status: "approved" | "rejected",
  ) => Promise<void>;
}) {
  return (
    <section className="mx-auto mt-5 max-w-5xl rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">待审核规划</h2>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        外部 Agent
        生成的概念、契约、系统、细纲和章节契约会先停在这里。请先在“作品”页检查完整当前
        revision，再做批准或驳回；旧 revision 不会覆盖新内容。
      </p>
      <div className="mt-5 space-y-3">
        {documents.map((document) => (
          <div
            key={`${document.projectId}:${document.documentId}`}
            className="rounded border border-[var(--color-border-default)] p-3"
          >
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="flex-1 text-sm font-medium">
                {document.title}
              </span>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {document.documentType} · r{document.revision}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {document.projectTitle} · {document.documentId} · 更新于{" "}
              {new Date(document.updatedAt).toLocaleString()}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={!application}
                onClick={() => void onReview(document, "approved")}
                className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                批准当前 revision
              </button>
              <button
                type="button"
                disabled={!application}
                onClick={() => void onReview(document, "rejected")}
                className="rounded border border-[var(--color-border-default)] px-3 py-1.5 text-sm disabled:opacity-40"
              >
                驳回并请求新稿
              </button>
            </div>
          </div>
        ))}
        {documents.length === 0 && (
          <div className="text-sm text-[var(--color-text-tertiary)]">
            没有待审核规划。
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsPanel({
  application,
  providers,
  workspaceSettings,
  pipelines,
  pipelineRuns,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  providers: readonly ProviderProfileView[];
  workspaceSettings: WorkspaceSettingsView;
  pipelines: readonly PipelineRevision[];
  pipelineRuns: readonly PipelineRunView[];
  onCommandSucceeded: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [name, setName] = useState("");
  const [baseURL, setBaseURL] = useState("http://localhost:11434/v1");
  const [defaultModel, setDefaultModel] = useState("");
  const [routeDraft, setRouteDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [conflictingDraft, setConflictingDraft] = useState<{
    providerId: string;
    name: string;
    baseURL: string;
    defaultModel: string;
    routes: Array<{ role: string; model: string }>;
    currentRevision: number;
  } | null>(null);
  const selected =
    providers.find((provider) => provider.providerProfileId === selectedId) ??
    null;
  const conflictFields =
    conflictingDraft &&
    selected &&
    selected.providerProfileId === conflictingDraft.providerId
      ? compareProviderProfileDraft(conflictingDraft, selected)
      : [];
  useEffect(() => {
    if (!selectedId && providers[0])
      setSelectedId(providers[0].providerProfileId);
  }, [providers, selectedId]);
  useEffect(() => {
    if (!selected) return;
    setProviderId(selected.providerProfileId);
    setName(selected.name);
    setBaseURL(selected.baseURL);
    setDefaultModel(selected.defaultModel);
    setRouteDraft(
      selected.routes.map((route) => `${route.role}=${route.model}`).join("\n"),
    );
  }, [selected]);
  const choose = (value: string) => {
    setSelectedId(value);
    setConflictingDraft(null);
    if (value) return;
    setProviderId("");
    setName("");
    setBaseURL("http://localhost:11434/v1");
    setDefaultModel("");
    setRouteDraft("");
  };
  const save = async () => {
    if (!application) return;
    try {
      const routes = parseProviderRoutes(routeDraft);
      const localDraft = {
        providerId: providerId.trim(),
        name: name.trim(),
        baseURL: baseURL.trim(),
        defaultModel: defaultModel.trim(),
        routes,
      };
      const requestId = `ui:provider-profile:${crypto.randomUUID()}`;
      setIsSaving(true);
      const result = await application.commands.execute({
        schemaVersion: 1,
        commandId: requestId,
        idempotencyKey: requestId,
        correlationId: requestId,
        actor: { kind: "human", id: "tauri-ui" },
        ...(selected ? { expectedRevision: selected.revision } : {}),
        tool: "save_provider_profile",
        args: {
          providerProfileId: providerId.trim(),
          name: name.trim(),
          baseURL: baseURL.trim(),
          defaultModel: defaultModel.trim(),
          routes,
        },
        createdAt: Date.now(),
      });
      if (result.kind === "conflict") {
        setConflictingDraft({
          ...localDraft,
          currentRevision: result.currentRevision,
        });
        await onCommandSucceeded();
        toast.error(
          `${result.diagnostics.map((item) => item.message).join("；")} 已载入最新 revision 供比较。`,
        );
        return;
      }
      if (result.kind !== "ok")
        throw new Error(
          result.kind === "blocked"
            ? result.diagnostics.map((item) => item.message).join("；")
            : "设置未保存。 ",
        );
      setConflictingDraft(null);
      await onCommandSucceeded();
      setSelectedId(providerId.trim());
      toast.success("非秘密 Provider 配置已保存");
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
        <h1 className="text-lg font-semibold">设置</h1>
        <div className="mt-4 space-y-4 text-sm text-[var(--color-text-secondary)]">
          <p>
            此处仅保存
            Provider、模型角色路由等非秘密元数据。桌面工作台不会读取、显示或回显
            API Key；Node CLI/MCP 仅从运行时环境的受控 SecretStore
            取用密钥，密钥不会进入 SQLite、对象库或 Prompt。
          </p>
          {conflictingDraft && (
            <section className="rounded border border-[var(--color-danger)] bg-red-50 p-3 text-sm">
              <div className="font-medium text-[var(--color-danger)]">
                版本冲突：本地草稿未覆盖 r{conflictingDraft.currentRevision}
              </div>
              <p className="mt-1 text-[var(--color-text-secondary)]">
                表单已载入最新
                revision；以下保留的是刚才未提交的本地值，供你逐项比较后再编辑保存。
              </p>
              {conflictFields.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {conflictFields.map((field) => (
                    <div
                      key={field.label}
                      className="grid gap-2 rounded border border-[var(--color-border-default)] bg-white p-2 sm:grid-cols-2"
                    >
                      <div>
                        <div className="text-xs text-[var(--color-text-tertiary)]">
                          本地草稿 · {field.label}
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
                          {field.local || "（空）"}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--color-text-tertiary)]">
                          当前 revision · {field.label}
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
                          {field.current || "（空）"}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                  可显示字段没有变化；请按最新 revision 重新提交。
                </p>
              )}
            </section>
          )}
          <label className="block">
            编辑配置
            <select
              value={selectedId}
              onChange={(event) => choose(event.target.value)}
              className="mt-1 block w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1.5"
            >
              {providers.map((provider) => (
                <option
                  key={provider.providerProfileId}
                  value={provider.providerProfileId}
                >
                  {provider.name} · r{provider.revision}
                </option>
              ))}
              <option value="">新建 Provider</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Provider ID
              <input
                disabled={!!selected}
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
                className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5 disabled:opacity-50"
              />
            </label>
            <label>
              显示名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5"
              />
            </label>
          </div>
          <label className="block">
            Base URL
            <input
              value={baseURL}
              onChange={(event) => setBaseURL(event.target.value)}
              placeholder="http://localhost:11434/v1"
              className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5"
            />
          </label>
          <label className="block">
            默认模型
            <input
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5"
            />
          </label>
          <label className="block">
            角色路由（每行：角色=模型）
            <textarea
              value={routeDraft}
              onChange={(event) => setRouteDraft(event.target.value)}
              rows={5}
              placeholder={"writer=qwen3.5:9b\nreviewer=qwen3:8b"}
              className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5 font-mono text-xs"
            />
          </label>
          <button
            type="button"
            disabled={
              !application ||
              isSaving ||
              !providerId.trim() ||
              !name.trim() ||
              !baseURL.trim() ||
              !defaultModel.trim()
            }
            onClick={() => void save()}
            className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {selected
              ? `保存 r${selected.revision} 的新 revision`
              : "新建 Provider"}
          </button>
          <p>
            自动化默认 supervised；DataPolicy
            与高风险命令仍将经同一确认体系处理。
          </p>
        </div>
      </section>
      <WorkspaceSettingsEditor
        application={application}
        settings={workspaceSettings}
        onCommandSucceeded={onCommandSucceeded}
      />
      <PipelineRevisionEditor
        application={application}
        pipelines={pipelines}
        pipelineRuns={pipelineRuns}
        onCommandSucceeded={onCommandSucceeded}
      />
    </div>
  );
}

function PipelineRevisionEditor({
  application,
  pipelines,
  pipelineRuns,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  pipelines: readonly PipelineRevision[];
  pipelineRuns: readonly PipelineRunView[];
  onCommandSucceeded: () => Promise<void>;
}) {
  const [pipelineId, setPipelineId] = useState("");
  const [name, setName] = useState("");
  const [steps, setSteps] = useState(
    '[{"id":"facts","tool":"commit_analysis_facts","enabled":true}]',
  );
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState<Record<string, boolean>>({});
  const [runNotes, setRunNotes] = useState<Record<string, string>>({});
  const load = (pipeline: PipelineRevision) => {
    setPipelineId(pipeline.pipelineId);
    setName(pipeline.name);
    setSteps(JSON.stringify(pipeline.steps, null, 2));
  };
  const save = async () => {
    if (!application) return;
    try {
      const parsed: unknown = JSON.parse(steps);
      if (!Array.isArray(parsed)) throw new Error("步骤必须是 JSON 数组。 ");
      const current = pipelines.find(
        (item) => item.pipelineId === pipelineId.trim(),
      );
      setSaving(true);
      const requestId = `pipeline:${crypto.randomUUID()}`;
      const result = await application.pipelines.save({
        command: {
          schemaVersion: 1,
          commandId: requestId,
          idempotencyKey: requestId,
          correlationId: requestId,
          actor: { kind: "human", id: "tauri-ui" },
          createdAt: Date.now(),
        },
        pipelineId: pipelineId.trim(),
        name: name.trim(),
        steps: parsed as PipelineRevision["steps"],
        ...(current ? { expectedRevision: current.revision } : {}),
      });
      if (result.kind !== "ok")
        throw new Error(
          result.kind === "blocked"
            ? result.diagnostics.map((item) => item.message).join("；")
            : "Pipeline 未保存。 ",
        );
      await onCommandSucceeded();
      toast.success("PipelineRevision 已保存");
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };
  const startRun = async (pipeline: PipelineRevision) => {
    if (!application) return;
    const requestId = `pipeline-run:${crypto.randomUUID()}`;
    try {
      const result = await application.pipelineRuns.start({
        command: {
          schemaVersion: 1,
          commandId: requestId,
          idempotencyKey: requestId,
          correlationId: requestId,
          actor: { kind: "human", id: "tauri-ui" },
          createdAt: Date.now(),
        },
        runId: requestId,
        pipelineId: pipeline.pipelineId,
      });
      if (result.kind !== "ok")
        throw new Error(
          result.kind === "blocked"
            ? result.diagnostics.map((item) => item.message).join("；")
            : "PipelineRun 未创建。 ",
        );
      await onCommandSucceeded();
      toast.success("已冻结 PipelineRevision 并创建人工复核运行");
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  const completeNode = async (runId: string, stepId: string) => {
    if (!application) return;
    const key = `${runId}:${stepId}`;
    const note = runNotes[key]?.trim();
    if (!note) {
      toast.error("请先记录该领域步骤的复核说明。 ");
      return;
    }
    const requestId = `pipeline-step:${crypto.randomUUID()}`;
    try {
      const result = await application.pipelineRuns.completeStep({
        command: {
          schemaVersion: 1,
          commandId: requestId,
          idempotencyKey: requestId,
          correlationId: requestId,
          actor: { kind: "human", id: "tauri-ui" },
          createdAt: Date.now(),
        },
        runId,
        stepId,
        note,
      });
      if (result.kind !== "ok")
        throw new Error(
          result.kind === "blocked"
            ? result.diagnostics.map((item) => item.message).join("；")
            : "步骤未完成。 ",
        );
      await onCommandSucceeded();
      toast.success("已记录步骤复核");
    } catch (cause) {
      toast.error(messageOf(cause));
    }
  };
  const executeNode = async (runId: string, stepId: string) => {
    if (!application) return;
    const key = `${runId}:${stepId}`;
    setExecuting((current) => ({ ...current, [key]: true }));
    try {
      const result = await application.pipelineActions.execute({ runId, stepId });
      await onCommandSucceeded();
      toast.success(`已启动受控步骤任务 ${result.taskId}；完成后请人工复核。`);
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setExecuting((current) => ({ ...current, [key]: false }));
    }
  };
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">线性 PipelineRevision</h2>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        人类可在此编辑领域步骤；SQL、文件和原始批处理步骤会被领域服务拒绝。启动时会冻结当前
        revision；每一步必须先由对应领域工具完成，再在这里记录人类复核，不能将
        JSON 步骤直接解释为任意命令。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          Pipeline ID
          <input
            value={pipelineId}
            onChange={(event) => setPipelineId(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5"
          />
        </label>
        <label>
          名称
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5"
          />
        </label>
      </div>
      <label className="mt-3 block">
        步骤 JSON
        <textarea
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
          rows={7}
          className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5 font-mono text-xs"
        />
      </label>
      <button
        type="button"
        disabled={!application || saving || !pipelineId.trim() || !name.trim()}
        onClick={() => void save()}
        className="mt-3 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
      >
        保存版本
      </button>
      <div className="mt-4 space-y-2">
        {pipelines.map((pipeline) => (
          <div
            key={pipeline.pipelineId}
            className="rounded border border-[var(--color-border-default)] p-2 text-sm"
          >
            <button
              type="button"
              onClick={() => load(pipeline)}
              className="text-left hover:underline"
            >
              {pipeline.name} · {pipeline.pipelineId} · r{pipeline.revision} ·{" "}
              {pipeline.steps.length} 步
            </button>
            <button
              type="button"
              disabled={!application}
              onClick={() => void startRun(pipeline)}
              className="ml-3 rounded border border-[var(--color-border-default)] px-2 py-1 text-xs disabled:opacity-40"
            >
              从此版本启动复核
            </button>
          </div>
        ))}
        {pipelines.length === 0 && (
          <div className="text-sm text-[var(--color-text-tertiary)]">
            尚未创建 Pipeline。
          </div>
        )}
      </div>
      <div className="mt-5 space-y-3">
        <h3 className="text-sm font-medium">Pipeline 运行与复核</h3>
        {pipelineRuns.map((run) => (
          <div
            key={run.runId}
            className="rounded border border-[var(--color-border-default)] p-3"
          >
            <div className="text-sm font-medium">
              {run.pipelineId} · r{run.pipelineRevision} · {run.status}
            </div>
            <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {run.runId}
            </div>
            {run.nodes.map((node) => {
              const key = `${run.runId}:${node.stepId}`;
              return (
                <div
                  key={node.stepId}
                  className="mt-2 rounded bg-[var(--color-surface-subtle)] p-2 text-xs"
                >
                  <div>
                    <span className="font-medium">{node.stepId}</span> ·{" "}
                    {node.tool} · {node.status}
                  </div>
                  {node.status === "pending" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!application || executing[key]}
                        onClick={() => void executeNode(run.runId, node.stepId)}
                        className="rounded border border-[var(--color-border-default)] px-2 py-1 disabled:opacity-40"
                      >
                        {executing[key] ? "正在启动…" : "执行受支持步骤"}
                      </button>
                      <input
                        value={runNotes[key] ?? ""}
                        onChange={(event) =>
                          setRunNotes((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        placeholder="已调用的领域工具、结果与人工复核说明"
                        className="min-w-64 flex-1 rounded border border-[var(--color-border-default)] px-2 py-1"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void completeNode(run.runId, node.stepId)
                        }
                        className="rounded border border-[var(--color-border-default)] px-2 py-1"
                      >
                        记录完成
                      </button>
                    </div>
                  )}
                  {node.checkpoint && (
                    <div className="mt-1 text-[var(--color-text-tertiary)]">
                      {String(node.checkpoint.note ?? "已复核")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {pipelineRuns.length === 0 && (
          <div className="text-sm text-[var(--color-text-tertiary)]">
            尚未启动 PipelineRun。
          </div>
        )}
      </div>
    </section>
  );
}

/** 预算、DataPolicy 与自动化模式属于 SQLite 投影，绝不读取 settings.json 或 Secret。 */
function WorkspaceSettingsEditor({
  application,
  settings,
  onCommandSucceeded,
}: {
  application: WorkspaceApplicationService | null;
  settings: WorkspaceSettingsView;
  onCommandSucceeded: () => Promise<void>;
}) {
  const [automationMode, setAutomationMode] = useState<
    WorkspaceSettingsView["automationMode"]
  >(settings.automationMode);
  const [contextWindowTokens, setContextWindowTokens] = useState(
    String(settings.contextWindowTokens),
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    String(settings.maxOutputTokens),
  );
  const [safetyMarginRatio, setSafetyMarginRatio] = useState(
    String(settings.safetyMarginRatio),
  );
  const [cloudEscalation, setCloudEscalation] = useState<
    WorkspaceSettingsView["cloudEscalation"]
  >(settings.cloudEscalation);
  const [isSaving, setIsSaving] = useState(false);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  useEffect(() => {
    if (conflictRevision !== null) return;
    setAutomationMode(settings.automationMode);
    setContextWindowTokens(String(settings.contextWindowTokens));
    setMaxOutputTokens(String(settings.maxOutputTokens));
    setSafetyMarginRatio(String(settings.safetyMarginRatio));
    setCloudEscalation(settings.cloudEscalation);
  }, [settings, conflictRevision]);

  const loadCurrent = () => {
    setAutomationMode(settings.automationMode);
    setContextWindowTokens(String(settings.contextWindowTokens));
    setMaxOutputTokens(String(settings.maxOutputTokens));
    setSafetyMarginRatio(String(settings.safetyMarginRatio));
    setCloudEscalation(settings.cloudEscalation);
    setConflictRevision(null);
  };
  const save = async () => {
    if (!application) return;
    const context = Number(contextWindowTokens);
    const output = Number(maxOutputTokens);
    const margin = Number(safetyMarginRatio);
    if (
      !Number.isInteger(context) ||
      !Number.isInteger(output) ||
      !Number.isFinite(margin)
    ) {
      toast.error("上下文窗口、最大输出与安全余量必须是有效数字。");
      return;
    }
    const requestId = `ui:workspace-settings:${crypto.randomUUID()}`;
    setIsSaving(true);
    try {
      const result = await application.commands.execute({
        schemaVersion: 1,
        commandId: requestId,
        idempotencyKey: requestId,
        correlationId: requestId,
        actor: { kind: "human", id: "tauri-ui" },
        ...(settings.revision > 0
          ? { expectedRevision: settings.revision }
          : {}),
        tool: "save_workspace_settings",
        args: {
          automationMode,
          contextWindowTokens: context,
          maxOutputTokens: output,
          safetyMarginRatio: margin,
          cloudEscalation,
        },
        createdAt: Date.now(),
      });
      if (result.kind === "conflict") {
        setConflictRevision(result.currentRevision);
        await onCommandSucceeded();
        toast.error(
          `${result.diagnostics.map((item) => item.message).join("；")} 本地草稿已保留。`,
        );
        return;
      }
      if (result.kind !== "ok")
        throw new Error(
          result.kind === "blocked"
            ? result.diagnostics.map((item) => item.message).join("；")
            : "工作区设置未保存。 ",
        );
      setConflictRevision(null);
      await onCommandSucceeded();
      toast.success("工作区设置已保存");
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">创作策略</h2>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        预算、DataPolicy 与自动化模式写入 SQLite 的可版本化非秘密设置。默认采用
        supervised，默认本地优先。
      </p>
      {conflictRevision !== null && (
        <div className="mt-4 rounded border border-[var(--color-danger)] bg-red-50 p-3 text-sm">
          <div className="font-medium text-[var(--color-danger)]">
            版本冲突：本地草稿未覆盖 r{conflictRevision}
          </div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <div className="text-[var(--color-text-tertiary)]">本地草稿</div>
              <pre className="mt-1 whitespace-pre-wrap">
                {automationMode} · {contextWindowTokens}/{maxOutputTokens} ·
                margin {safetyMarginRatio} · {cloudEscalation}
              </pre>
            </div>
            <div>
              <div className="text-[var(--color-text-tertiary)]">
                当前 revision
              </div>
              <pre className="mt-1 whitespace-pre-wrap">
                {settings.automationMode} · {settings.contextWindowTokens}/
                {settings.maxOutputTokens} · margin {settings.safetyMarginRatio}{" "}
                · {settings.cloudEscalation}
              </pre>
            </div>
          </div>
          <button
            type="button"
            onClick={loadCurrent}
            className="mt-3 rounded border border-[var(--color-border-default)] px-2 py-1 text-xs"
          >
            载入当前 revision
          </button>
        </div>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          自动化模式
          <select
            value={automationMode}
            onChange={(event) =>
              setAutomationMode(
                event.target.value as WorkspaceSettingsView["automationMode"],
              )
            }
            className="mt-1 block w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1.5"
          >
            <option value="manual">manual</option>
            <option value="supervised">supervised</option>
            <option value="autonomous">autonomous</option>
          </select>
        </label>
        <label>
          云端升级策略
          <select
            value={cloudEscalation}
            onChange={(event) =>
              setCloudEscalation(
                event.target.value as WorkspaceSettingsView["cloudEscalation"],
              )
            }
            className="mt-1 block w-full rounded border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1.5"
          >
            <option value="never">never（仅本地）</option>
            <option value="complex_only">complex_only（复杂综合时）</option>
            <option value="always">always（允许升级）</option>
          </select>
        </label>
        <label>
          Context Window Tokens
          <input
            inputMode="numeric"
            value={contextWindowTokens}
            onChange={(event) => setContextWindowTokens(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5"
          />
        </label>
        <label>
          最大输出 Tokens
          <input
            inputMode="numeric"
            value={maxOutputTokens}
            onChange={(event) => setMaxOutputTokens(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5"
          />
        </label>
        <label>
          Safety Margin（0–1）
          <input
            inputMode="decimal"
            value={safetyMarginRatio}
            onChange={(event) => setSafetyMarginRatio(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-border-default)] px-2 py-1.5"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!application || isSaving}
        onClick={() => void save()}
        className="mt-4 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
      >
        保存工作区设置 r{settings.revision}
      </button>
    </section>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center text-center">
      <div className="text-base font-medium">{title}</div>
      <div className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">
        {detail}
      </div>
    </div>
  );
}
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
