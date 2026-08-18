import type { ChapterMechanismApplicationService } from "@/application/chapter-mechanism-application-service";
import type { ChapterMechanismOutcomeService } from "@/application/chapter-mechanism-outcome-service";
import type { ChapterReviewService } from "@/application/chapter-review-service";
import type { CreativeRecipeService } from "@/application/creative-recipe-service";
import type { MechanismAssetService } from "@/application/mechanism-asset-service";
import type { ChapterProductionCommitService } from "@/application/chapter-production-commit-service";
import type { SqlDriver } from "@/persistence/sql-driver";

export interface ChapterMethodWorkbench {
  projectId: string;
  chapterId: string;
  adoptedMethods: Array<{ id: string; title: string; targetEffect: string; when: string[]; operations: string[]; avoid: string[]; applicability: string[]; revision: number }>;
  application: Awaited<ReturnType<ChapterMechanismApplicationService["get"]>>;
  recipe: Awaited<ReturnType<CreativeRecipeService["get"]>>;
  review: Awaited<ReturnType<ChapterReviewService["get"]>>;
  outcome: Awaited<ReturnType<ChapterMechanismOutcomeService["get"]>>;
  proposal: Awaited<ReturnType<ChapterProductionCommitService["getProposal"]>>;
  diagnostics: Array<{ documentId: string; documentType: string; status: string; revision: number; stale: boolean }>;
  blockers: string[];
  nextAction: string;
}

export interface ChapterMethodWorkbenchService {
  get(input: { projectId: string; chapterId: string }): Promise<ChapterMethodWorkbench>;
}

/**
 * 章节方法工作台是给 UI/MCP 的小型查询投影。它只合成现有 Application
 * Service 的当前事实与文档索引，不返回正文、参考原文、Prompt 或对象路径。
 */
export function createChapterMethodWorkbenchService(options: {
  driver: SqlDriver;
  mechanisms: Pick<MechanismAssetService, "listAdoptedSnapshots">;
  applications: ChapterMechanismApplicationService;
  recipes: CreativeRecipeService;
  reviews: ChapterReviewService;
  outcomes: ChapterMechanismOutcomeService;
  production: Pick<ChapterProductionCommitService, "getProposal">;
}): ChapterMethodWorkbenchService {
  return {
    async get(input) {
      assertId(input.projectId, "projectId"); assertId(input.chapterId, "chapterId");
      const [application, recipe, outcome, proposal, adopted, documents] = await Promise.all([
        options.applications.get(input), options.recipes.get(input), options.outcomes.get(input), options.production.getProposal(input), options.mechanisms.listAdoptedSnapshots(input.projectId), diagnosticDocuments(options.driver, input.projectId, input.chapterId),
      ]);
      const reviewId = documents.find((document) => document.documentType === "chapter_review")?.reviewId;
      const review = reviewId ? await options.reviews.get({ projectId: input.projectId, reviewId }) : null;
      const blockers: string[] = [];
      if (!application) blockers.push("等待填写本章采用记录，或明确按零方法卡章节继续。");
      if (application && !recipe) blockers.push("本章采用记录已变化，等待重新冻结章节写作配方。");
      if (application && recipe && !review) blockers.push("等待当前 Writer 草稿、三份独立 Reader 与 Reviewer 反馈。");
      if (application && review && !outcome) blockers.push("等待作者记录对 Reviewer 的逐项判断和最终处置。");
      if (outcome && (outcome.disposition === "accept_current" || outcome.disposition === "accept_with_gap") && !proposal) blockers.push("等待外部 Agent 准备包含连续性更新的正式提交提案。");
      if (documents.some((document) => document.stale)) blockers.push("存在过期产物；不能接受为正式章节。");
      const nextAction = blockers[0] ?? (outcome?.disposition === "accept_with_gap" ? "可发起带风险接受的正式提交确认。" : outcome?.disposition === "accept_current" ? "可发起接受为正式章节确认。" : "等待作者选择下一步。 ");
      return {
        projectId: input.projectId, chapterId: input.chapterId,
        adoptedMethods: adopted.map((item) => ({ id: item.card.id, title: item.card.title, targetEffect: item.card.targetEffect, when: [...item.card.when], operations: [...item.card.operations], avoid: [...item.card.avoid], applicability: [...item.card.applicability], revision: item.revision })),
        application, recipe, review, outcome, proposal,
        diagnostics: documents.map(({ reviewId: _reviewId, ...document }) => document), blockers, nextAction,
      };
    },
  };
}

async function diagnosticDocuments(driver: SqlDriver, projectId: string, chapterId: string): Promise<Array<{ documentId: string; documentType: string; status: string; revision: number; stale: boolean; reviewId?: string }>> {
  const rows = await driver.query<{ document_id: string; document_type: string; status: string; current_revision: number; payload_json: string; stale: number }>({
    sql: `SELECT doc.document_id, doc.document_type, doc.status, artifact.current_revision, revision.payload_json,
                 CASE WHEN EXISTS (SELECT 1 FROM artifact_dependencies dep WHERE dep.artifact_id = artifact.artifact_id AND dep.revision = artifact.current_revision AND dep.stale = 1) THEN 1 ELSE 0 END AS stale
          FROM project_documents doc INNER JOIN artifacts artifact ON artifact.artifact_id = doc.artifact_id
          INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
          WHERE doc.project_id = ?`, params: [projectId],
  });
  return rows.flatMap((row) => {
    let payload: Record<string, unknown>; try { payload = JSON.parse(row.payload_json) as Record<string, unknown>; } catch { return []; }
    if (!payload || payload.chapterId !== chapterId) return [];
    return [{ documentId: row.document_id, documentType: row.document_type, status: row.status, revision: row.current_revision, stale: row.stale === 1, ...(typeof payload.reviewId === "string" ? { reviewId: payload.reviewId } : {}) }];
  });
}
function assertId(value: string, label: string): void { if (!value.trim()) throw new Error(`${label} 必须是非空字符串。`); }
