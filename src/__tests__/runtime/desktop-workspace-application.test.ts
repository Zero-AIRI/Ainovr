import { describe, expect, it, vi } from "vitest";
import { createDesktopWorkspaceApplication } from "@/runtime/desktop-workspace-application";

describe("桌面 WorkspaceApplication 运行时组装", () => {
  it("只通过受限 MCP 领域通道读取工作区，UI 组件不直接持有 SQL 适配器", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("desktop_mcp_request");
      const name = ((args?.request as { params?: { name?: string } } | undefined)?.params?.name);
      if (name === "get_workspace_status") return { jsonrpc: "2.0", id: "desktop:1", result: { structuredContent: { workspaceRevision: 7, changeSeq: 7, projectCount: 2 }, isError: false } };
      if (name === "execute_pipeline_run_step") return { jsonrpc: "2.0", id: "desktop:2", result: { structuredContent: { runId: "run_001", stepId: "writer", taskId: "pipeline:run_001:writer", command: { kind: "accepted", taskId: "pipeline:run_001:writer" } }, isError: false } };
      if (name === "save_project_intent") return { jsonrpc: "2.0", id: "desktop:3", result: { structuredContent: { kind: "ok", revision: 1 }, isError: false } };
      if (name === "commit_chapter") return { jsonrpc: "2.0", id: "desktop:4", result: { structuredContent: { kind: "needs_confirmation", confirmationId: "confirm_001", risk: "production_commit", expiresAt: 2 }, isError: false } };
      throw new Error(`未预期领域工具：${name}`);
    });
    const application = createDesktopWorkspaceApplication({ invoke });

    await expect(application.queries.getWorkspaceStatus()).resolves.toEqual({ workspaceRevision: 7, changeSeq: 7, projectCount: 2 });
    await expect(application.pipelineActions.execute({ runId: "run_001", stepId: "writer" })).resolves.toMatchObject({ taskId: "pipeline:run_001:writer" });
    await expect(application.productionActions.saveProjectIntent({
      command: { schemaVersion: 1, commandId: "cmd_intent", idempotencyKey: "idem_intent", correlationId: "corr_intent", actor: { kind: "human", id: "ui" }, createdAt: 1 },
      projectId: "project_001",
      intent: { genre: "奇幻", audience: "成年读者", targetScale: "长篇", experienceGoals: ["悬念"], prohibitions: ["照搬参考"] },
    })).resolves.toMatchObject({ kind: "ok" });
    await expect(application.productionActions.commitChapter({
      command: { schemaVersion: 1, commandId: "cmd_commit", idempotencyKey: "idem_commit", correlationId: "corr_commit", actor: { kind: "human", id: "ui" }, createdAt: 1 },
      projectId: "project_001", chapterId: "chapter_001", chapterOrdinal: 1, draftDocumentId: "production:chapter_draft:chapter_001:v1", productionCommitId: "commit_001",
      chapterDelta: { schema_version: 1 }, canonPatches: [], characterKnowledgePatches: [], readerState: { readerStateId: "state_001", payload: { schema_version: 1 } }, readerPromiseUpdates: [], outlineDrift: { payload: { schema_version: 1 } },
    })).resolves.toMatchObject({ kind: "needs_confirmation", confirmationId: "confirm_001" });
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(invoke).toHaveBeenNthCalledWith(2, "desktop_mcp_request", { request: expect.objectContaining({ method: "tools/call", params: { name: "execute_pipeline_run_step", arguments: { runId: "run_001", stepId: "writer" } } }) });
    expect(invoke).not.toHaveBeenCalledWith(expect.stringMatching(/^sql_|^object_read$/), expect.anything());
    expect(invoke).toHaveBeenNthCalledWith(3, "desktop_mcp_request", { request: expect.objectContaining({ method: "tools/call", params: { name: "save_project_intent", arguments: expect.objectContaining({ projectId: "project_001", intent: expect.any(Object) }) } }) });
    expect(invoke).toHaveBeenLastCalledWith("desktop_mcp_request", { request: expect.objectContaining({ method: "tools/call", params: { name: "commit_chapter", arguments: expect.objectContaining({ chapterId: "chapter_001", productionCommitId: "commit_001" }) } }) });
  });
});
