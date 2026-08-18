import { describe, expect, it, vi } from "vitest";
import { createMechanismEffectExperimentBlindReviewService, parseMechanismEffectExperimentBlindReview } from "@/application/mechanism-effect-experiment-blind-review-service";
import type { MechanismEffectExperiment } from "@/application/mechanism-effect-experiment-service";

describe("MechanismEffectExperimentBlindReviewService", () => {
  it("只向盲评者冻结 ChapterContract、共同信号和匿名候选正文", async () => {
    const start = vi.fn().mockResolvedValue({ kind: "accepted", taskId: "blind_task" });
    const service = createMechanismEffectExperimentBlindReviewService({
      experiments: { getExecutionPlan: async () => experiment() } as never,
      manifests: { get: async () => manifest() } as never,
      drafts: { getDraft: async (documentId: string) => ({ documentId, projectId: "project_001", revision: 1, title: "匿名候选", model: "qwen", taskId: "task", text: documentId.endsWith(":a") ? "甲正文" : "乙正文", metadata: { schema_version: 1, kind: "mechanism_effect_experiment_draft", experimentId: "experiment_001", pairId: "pair_1", candidateId: documentId.endsWith(":a") ? "candidate_1_a" : "candidate_1_b" } }) } as never,
      local: { start, run: vi.fn(), getTask: vi.fn(), cancel: vi.fn(), getDraft: vi.fn() } as never,
    });

    await service.start({ command: command(), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", sourceManifestId: "source_manifest", taskId: "blind_task", documentId: "experiment:blind:pair_1", title: "匿名盲评" });

    const input = start.mock.calls[0]![0];
    expect(input).toMatchObject({ outputMode: "structured_json", metadata: { schema_version: 1, kind: "mechanism_effect_experiment_blind_review", experimentId: "experiment_001", pairId: "pair_1", modelRole: "reviewer" } });
    expect(input.prompt).toContain("甲正文");
    expect(input.prompt).toContain("乙正文");
    expect(input.prompt).toContain("读者会形成具体疑问");
    expect(input.prompt).toContain('"experimentId":"experiment_001"');
    expect(input.prompt).toContain('"pairId":"pair_1"');
    expect(input.prompt).toContain('"candidateId":"candidate_1_a"');
    expect(input.prompt).toContain('"candidateId":"candidate_1_b"');
    expect(input.prompt).toContain("<AINOVR_BLIND_REVIEW_OUTPUT_SKELETON>");
    expect(input.prompt).not.toMatch(/creative_recipe|baseline|treated|参考作品|SourceSpan/i);
  });

  it("拒绝泄露映射、无效候选或未覆盖两份候选的结构化盲评", () => {
    const raw = JSON.stringify({ schema_version: 1, kind: "mechanism_effect_experiment_blind_review", experimentId: "experiment_001", pairId: "pair_1", structuredTargetEffect: "candidate_1_b", candidateRisks: [
      { candidateId: "candidate_1_a", chapterContract: "none", continuity: "none", originality: "none", readability: "none" },
      { candidateId: "candidate_1_b", chapterContract: "minor", continuity: "none", originality: "none", readability: "none" },
    ], sourceLeakageCandidateIds: [] });
    expect(parseMechanismEffectExperimentBlindReview(raw, { experimentId: "experiment_001", pairId: "pair_1", candidateIds: ["candidate_1_a", "candidate_1_b"] })).toMatchObject({ structuredTargetEffect: "candidate_1_b" });
    expect(() => parseMechanismEffectExperimentBlindReview(raw.replace("candidate_1_b", "treated"), { experimentId: "experiment_001", pairId: "pair_1", candidateIds: ["candidate_1_a", "candidate_1_b"] })).toThrow(/匿名候选/);
    expect(() => parseMechanismEffectExperimentBlindReview(JSON.stringify({ ...JSON.parse(raw), baselineCandidateId: "candidate_1_a" }), { experimentId: "experiment_001", pairId: "pair_1", candidateIds: ["candidate_1_a", "candidate_1_b"] })).toThrow(/字段/);
  });

  it("拒绝未由实验配对冻结的 ContextManifest", async () => {
    const service = createMechanismEffectExperimentBlindReviewService({
      experiments: { getExecutionPlan: async () => experiment() } as never,
      manifests: { get: async () => manifest() } as never,
      drafts: { getDraft: vi.fn() } as never,
      local: { start: vi.fn(), run: vi.fn(), getTask: vi.fn(), cancel: vi.fn(), getDraft: vi.fn() } as never,
    });

    await expect(service.start({ command: command(), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", sourceManifestId: "other_manifest", taskId: "blind_task", documentId: "experiment:blind:pair_1", title: "匿名盲评" })).rejects.toThrow(/ContextManifest/);
  });

  it("拒绝已被后续 revision 替换的匿名候选正文", async () => {
    const service = createMechanismEffectExperimentBlindReviewService({
      experiments: { getExecutionPlan: async () => experiment() } as never,
      manifests: { get: async () => manifest() } as never,
      drafts: { getDraft: async (documentId: string) => ({ documentId, projectId: "project_001", revision: 2, title: "匿名候选", model: "qwen", taskId: "task", text: "替换后的正文", metadata: { schema_version: 1, kind: "mechanism_effect_experiment_draft", experimentId: "experiment_001", pairId: "pair_1", candidateId: documentId.endsWith(":a") ? "candidate_1_a" : "candidate_1_b" } }) } as never,
      local: { start: vi.fn(), run: vi.fn(), getTask: vi.fn(), cancel: vi.fn(), getDraft: vi.fn() } as never,
    });

    await expect(service.start({ command: command(), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", sourceManifestId: "source_manifest", taskId: "blind_task", documentId: "experiment:blind:pair_1", title: "匿名盲评" })).rejects.toThrow(/revision/);
  });
});

function experiment(): MechanismEffectExperiment { return { schema_version: 1, kind: "mechanism_effect_experiment", experimentId: "experiment_001", state: "prepared", mechanismAssetId: "mechanism_001", mechanismRevision: 2, protocol: { contextBudgetTokens: 8000, maxOutputTokens: 1200, seed: "unknown" }, pairs: [1, 2, 3].map((ordinal) => ({ pairId: `pair_${ordinal}`, chapterId: `chapter_${ordinal}`, chapterContractRevision: 1, sourceManifestId: `source_manifest${ordinal === 1 ? "" : `_${ordinal}`}`, targetSignals: ["读者会形成具体疑问"], routeSnapshot: { providerProfileId: "profile", baseURL: "http://127.0.0.1:11434/v1", model: "qwen", protocol: "chat_completions", contextWindowTokens: 16000, maxOutputTokens: 1200, safetyMarginRatio: 0.2 }, candidates: [{ candidateId: `candidate_${ordinal}_a`, draftDocumentId: `experiment:pair_${ordinal}:a`, draftArtifactRevision: 1, actualInputTokens: "unknown", actualOutputTokens: "unknown" }, { candidateId: `candidate_${ordinal}_b`, draftDocumentId: `experiment:pair_${ordinal}:b`, draftArtifactRevision: 1, actualInputTokens: "unknown", actualOutputTokens: "unknown" }] as never })), blindMapping: [1, 2, 3].map((ordinal) => ({ pairId: `pair_${ordinal}`, baselineCandidateId: `candidate_${ordinal}_a`, treatedCandidateId: `candidate_${ordinal}_b` })) }; }
function manifest() { return { schema_version: 1, kind: "chapter_context_manifest", manifestId: "source_manifest", projectId: "project_001", chapterId: "chapter_1", taskRole: "writer", conversationHistory: [], tokenBudget: 8000, reservedOutputTokens: 1200, modelContextWindowTokens: 16000, modelMaxOutputTokens: 1200, tokenEstimate: 1, layers: [{ name: "chapter_contract", required: true, documentIds: ["contract"], value: { entryState: ["入口"], exitState: ["出口"] } }, { name: "story_contract_and_system", required: true, documentIds: [], value: {} }, { name: "canon_and_character", required: false, documentIds: [], value: {} }, { name: "recent_accepted_text", required: false, documentIds: [], value: {} }, { name: "reader_state_and_promises", required: false, documentIds: [], value: {} }, { name: "creative_recipe", required: true, documentIds: ["recipe"], value: { mechanism: "不应泄漏" } }] }; }
function command() { return { schemaVersion: 1 as const, commandId: "command", idempotencyKey: "idem", correlationId: "correlation", actor: { kind: "external_agent" as const, id: "agent" }, createdAt: 1_700_000_000_000 }; }
