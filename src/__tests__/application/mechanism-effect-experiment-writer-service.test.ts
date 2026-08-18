import { describe, expect, it, vi } from "vitest";
import { createMechanismEffectExperimentWriterService } from "@/application/mechanism-effect-experiment-writer-service";
import type { MechanismEffectExperiment } from "@/application/mechanism-effect-experiment-service";

describe("MechanismEffectExperimentWriterService", () => {
  it("从同一冻结 ContextManifest 只以方法层差异启动匿名 A/B 候选", async () => {
    const start = vi.fn().mockResolvedValue({ kind: "accepted", taskId: "task_a" });
    const experiment = prepared();
    const writer = createMechanismEffectExperimentWriterService({
      experiments: { getExecutionPlan: async () => experiment } as never,
      manifests: { get: async () => sourceManifest() } as never,
      mechanisms: { listAdoptedSnapshots: async () => [mechanism()] },
      local: { start, run: vi.fn(), getTask: vi.fn(), cancel: vi.fn(), getDraft: vi.fn() } as never,
    });

    await writer.start({ command: command(), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", candidateId: "candidate_1_a", sourceManifestId: "source_manifest_1", taskId: "task_a", title: "匿名候选" });
    await writer.start({ command: command("b"), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", candidateId: "candidate_1_b", sourceManifestId: "source_manifest_1", taskId: "task_b", title: "匿名候选" });

    const [first, second] = start.mock.calls.map(([input]) => input);
    expect(first).toMatchObject({ documentId: "experiment:pair_1:a", frozenRoute: expect.objectContaining({ role: "writer", model: "qwen", protocol: "chat_completions" }), metadata: { schema_version: 1, kind: "mechanism_effect_experiment_draft", experimentId: "experiment_001", pairId: "pair_1", candidateId: "candidate_1_a", modelRole: "writer" } });
    expect(second).toMatchObject({ documentId: "experiment:pair_1:b", metadata: { schema_version: 1, kind: "mechanism_effect_experiment_draft", experimentId: "experiment_001", pairId: "pair_1", candidateId: "candidate_1_b", modelRole: "writer" } });
    expect(JSON.stringify(first.metadata)).not.toMatch(/baseline|treated/i);
    const firstManifest = promptManifest(first.prompt);
    const secondManifest = promptManifest(second.prompt);
    expect(firstManifest.layers.slice(0, 5)).toEqual(secondManifest.layers.slice(0, 5));
    expect(firstManifest.layers[5].value.writerMechanisms).toEqual([]);
    expect(secondManifest.layers[5].value.writerMechanisms).toEqual([expect.objectContaining({ id: "mechanism_001" })]);
    expect(first.prompt.replace(JSON.stringify(firstManifest), "<manifest>")).toBe(second.prompt.replace(JSON.stringify(secondManifest), "<manifest>"));
  });

  it("拒绝不存在的候选、非 prepared 实验或不匹配的章节 Manifest", async () => {
    const base = prepared();
    const service = (experiment: MechanismEffectExperiment, manifest = sourceManifest()) => createMechanismEffectExperimentWriterService({
      experiments: { getExecutionPlan: async () => experiment } as never,
      manifests: { get: async () => manifest } as never,
      mechanisms: { listAdoptedSnapshots: async () => [mechanism()] },
      local: { start: vi.fn(), run: vi.fn(), getTask: vi.fn(), cancel: vi.fn(), getDraft: vi.fn() } as never,
    });
    await expect(service(base).start({ command: command(), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", candidateId: "missing", sourceManifestId: "source_manifest_1", taskId: "task", title: "匿名候选" })).rejects.toThrow(/候选/);
    base.state = "completed";
    base.assessments = [] as never;
    await expect(service(base).start({ command: command(), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", candidateId: "candidate_1_a", sourceManifestId: "source_manifest_1", taskId: "task", title: "匿名候选" })).rejects.toThrow(/prepared/);
    const preparedAgain = prepared();
    await expect(service(preparedAgain, { ...sourceManifest(), chapterId: "other" }).start({ command: command(), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", candidateId: "candidate_1_a", sourceManifestId: "source_manifest_1", taskId: "task", title: "匿名候选" })).rejects.toThrow(/ChapterContract/);
    await expect(service(prepared()).start({ command: command(), projectId: "project_001", experimentId: "experiment_001", pairId: "pair_1", candidateId: "candidate_1_a", sourceManifestId: "other_manifest", taskId: "task", title: "匿名候选" })).rejects.toThrow(/ContextManifest/);
  });
});

function prepared(): MechanismEffectExperiment {
  return {
    schema_version: 1, kind: "mechanism_effect_experiment", experimentId: "experiment_001", state: "prepared", mechanismAssetId: "mechanism_001", mechanismRevision: 2,
    protocol: { contextBudgetTokens: 8000, maxOutputTokens: 1200, seed: "unknown" },
    pairs: [1, 2, 3].map((ordinal) => ({
      pairId: `pair_${ordinal}`, chapterId: `chapter_${ordinal}`, chapterContractRevision: 4, sourceManifestId: `source_manifest_${ordinal}`, targetSignals: ["读者会形成具体疑问"],
      routeSnapshot: { providerProfileId: "profile_local", baseURL: "http://127.0.0.1:11434/v1", model: "qwen", protocol: "chat_completions", contextWindowTokens: 16000, maxOutputTokens: 1200, safetyMarginRatio: 0.2 },
      candidates: [
        { candidateId: `candidate_${ordinal}_a`, draftDocumentId: `experiment:pair_${ordinal}:a`, draftArtifactRevision: 1, actualInputTokens: "unknown", actualOutputTokens: "unknown" },
        { candidateId: `candidate_${ordinal}_b`, draftDocumentId: `experiment:pair_${ordinal}:b`, draftArtifactRevision: 1, actualInputTokens: "unknown", actualOutputTokens: "unknown" },
      ] as never,
    })),
    blindMapping: [1, 2, 3].map((ordinal) => ({ pairId: `pair_${ordinal}`, baselineCandidateId: `candidate_${ordinal}_a`, treatedCandidateId: `candidate_${ordinal}_b` })),
  };
}

function sourceManifest() {
  return { schema_version: 1, kind: "chapter_context_manifest", manifestId: "source_manifest_1", projectId: "project_001", chapterId: "chapter_1", taskRole: "writer", conversationHistory: [], tokenBudget: 8000, reservedOutputTokens: 1200, modelContextWindowTokens: 16000, modelMaxOutputTokens: 1200, tokenEstimate: 100, layers: [
    { name: "chapter_contract", required: true, documentIds: ["chapter_contract"], value: { chapterId: "chapter_1" } },
    { name: "story_contract_and_system", required: true, documentIds: ["story_contract"], value: { story: "same" } },
    { name: "canon_and_character", required: false, documentIds: [], value: { canon: "same" } },
    { name: "recent_accepted_text", required: false, documentIds: [], value: { text: "same" } },
    { name: "reader_state_and_promises", required: false, documentIds: [], value: { state: "same" } },
    { name: "creative_recipe", required: true, documentIds: ["recipe"], value: { schema_version: 1, kind: "creative_recipe", chapterId: "chapter_1", applicationId: "old", applicationRevision: 1, mechanismAssetId: "old", mechanismRevision: 1, writerMechanisms: [{ id: "old" }], editorMechanisms: [] } },
  ] };
}

function mechanism() { return { revision: 2, card: { id: "mechanism_001", title: "异常先于解释", targetEffect: "建立疑问", scope: "distributed" as const, when: ["开场"], operations: ["先呈现异常"], avoid: ["立刻解释"], applicability: ["信息受限"], targetLayers: ["draft"] as ("draft")[] } }; }
function command(suffix = "a") { return { schemaVersion: 1 as const, commandId: `command_${suffix}`, idempotencyKey: `idem_${suffix}`, correlationId: `correlation_${suffix}`, actor: { kind: "external_agent" as const, id: "agent" }, createdAt: 1_700_000_000_000 }; }
function promptManifest(prompt: string): { layers: Array<{ value: Record<string, unknown> }> } { const start = "<AINOVR_CONTEXT_MANIFEST>\n"; const end = "\n</AINOVR_CONTEXT_MANIFEST>"; return JSON.parse(prompt.slice(prompt.indexOf(start) + start.length, prompt.lastIndexOf(end))); }
