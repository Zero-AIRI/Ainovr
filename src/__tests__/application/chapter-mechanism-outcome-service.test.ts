import { describe, expect, it, vi } from "vitest";
import { createChapterMechanismOutcomeService } from "@/application/chapter-mechanism-outcome-service";
import type { ChapterMechanismApplicationSnapshot } from "@/application/chapter-mechanism-application-service";
import type { ChapterReview } from "@/application/chapter-review-service";

describe("ChapterMechanismOutcome", () => {
  it("逐项保留人类同意或不同意，并把带风险接受理由冻结为独立结果", async () => {
    const execute = vi.fn().mockResolvedValue({ kind: "ok", revision: 1, resourceRefs: [] });
    const outcomes = createChapterMechanismOutcomeService({ driver: { query: vi.fn().mockResolvedValue([]) } as never, commands: { execute } as never, applications: { get: async () => application() }, reviews: { get: async () => review() } });
    await expect(outcomes.save({ command: command(), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null, outcome: outcome() })).resolves.toMatchObject({ kind: "ok" });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ tool: "commit_project_planning_document", args: expect.objectContaining({ documentType: "chapter_mechanism_outcome", dependencies: expect.arrayContaining([{ artifactId: "document:production:chapter_mechanism_application:chapter_001", revision: 4 }, { artifactId: "document:production:chapter_review:review_001", revision: 2 }]) }) }));
  });

  it("拒绝遗漏信号、无理由的不同意或带风险接受，以及过期 Reviewer", async () => {
    const service = () => createChapterMechanismOutcomeService({ driver: { query: vi.fn().mockResolvedValue([]) } as never, commands: { execute: vi.fn() } as never, applications: { get: async () => application() }, reviews: { get: async () => review() } });
    await expect(service().save({ command: command(), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null, outcome: { ...outcome(), decisions: [] } })).rejects.toThrow(/逐项/);
    await expect(service().save({ command: command(), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null, outcome: { ...outcome(), decisions: [{ signal: { status: "specified", value: "读者会停顿猜测" }, agreement: "disagree" }] } })).rejects.toThrow(/理由/);
    await expect(service().save({ command: command(), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null, outcome: { ...outcome(), riskAcceptanceReason: undefined } })).rejects.toThrow(/风险接受/);
    const stale = createChapterMechanismOutcomeService({ driver: { query: vi.fn().mockResolvedValue([]) } as never, commands: { execute: vi.fn() } as never, applications: { get: async () => application() }, reviews: { get: async () => null } });
    await expect(stale.save({ command: command(), projectId: "project_001", chapterId: "chapter_001", expectedRevision: null, outcome: outcome() })).rejects.toThrow(/Reviewer/);
  });
});

function application(): ChapterMechanismApplicationSnapshot {
  return { schema_version: 1, kind: "chapter_mechanism_application", applicationId: "production:chapter_mechanism_application:chapter_001", chapterId: "chapter_001", chapterContractRevision: 3, mechanismAssetId: "mechanism_001", mechanismRevision: 2, revision: 4, fields: { reason: { status: "specified", value: "延迟揭示" }, plannedUse: { status: "specified", value: "钟楼门前" }, observableReaderEffect: { status: "specified", value: "制造疑问" }, misuseToAvoid: { status: "specified", value: "不解释谜底" }, reviewSignals: [{ status: "specified", value: "读者会停顿猜测" }] } };
}
function review(): ChapterReview {
  return { schema_version: 1, kind: "chapter_review", reviewId: "review_001", projectId: "project_001", chapterId: "chapter_001", draftDocumentId: "production:chapter_draft:chapter_001:v1", draftRevision: "v1", readerManifestIds: ["immersive", "low", "logic"], readerFeedbackDocumentIds: ["feedback_i", "feedback_l", "feedback_g"], applicationId: application().applicationId, applicationRevision: 4, writerManifestId: "writer_manifest_001", writerManifestRevision: 1, issues: [], effectAssessments: [{ signal: { status: "specified", value: "读者会停顿猜测" }, status: "partial", explanation: "谜面有效但力度偏弱。", anchors: [], suggestedAction: "request_revision" }], revision: 2 };
}
function outcome() {
  return { schema_version: 1 as const, kind: "chapter_mechanism_outcome" as const, outcomeId: "production:chapter_mechanism_outcome:chapter_001", chapterId: "chapter_001", applicationId: application().applicationId, applicationRevision: 4, reviewId: "review_001", reviewRevision: 2, decisions: [{ signal: { status: "specified" as const, value: "读者会停顿猜测" }, agreement: "agree" as const }], disposition: "accept_with_gap" as const, riskAcceptanceReason: "当前章节节奏优先，下一章补足谜面。", observedSideEffects: ["节奏略停顿"] };
}
function command() { return { schemaVersion: 1 as const, commandId: "command_outcome", idempotencyKey: "idem_outcome", correlationId: "correlation_outcome", actor: { kind: "human" as const, id: "author" }, createdAt: 1_700_000_000_000 }; }
