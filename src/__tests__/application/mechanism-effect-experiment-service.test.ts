import { describe, expect, it, vi } from "vitest";
import { createMechanismEffectExperimentService, summariseMechanismEffectExperiment, type MechanismEffectExperiment } from "@/application/mechanism-effect-experiment-service";

describe("MechanismEffectExperimentService", () => {
  it("冻结恰好三组匿名配对，并将 A/B 映射仅写入 ObjectStore", async () => {
    const execute = vi.fn().mockResolvedValue({ kind: "ok", revision: 1, resourceRefs: [] });
    const put = vi.fn().mockResolvedValue({ sha256: "a".repeat(64), byteLength: 64, mediaType: "application/json" });
    const service = createMechanismEffectExperimentService({
      driver: { query: vi.fn().mockResolvedValue([]) } as never,
      commands: { execute } as never,
      objects: { put } as never,
      mechanisms: { listAdoptedSnapshots: async () => [adoptedMechanism()] },
    });

    await expect(service.save({ command: command(), projectId: "project_001", expectedRevision: null, experiment: preparedExperiment() }))
      .resolves.toMatchObject({ kind: "ok" });

    expect(put).toHaveBeenCalledWith(expect.objectContaining({ mediaType: "application/vnd.ainovr.mechanism-effect-blind-mapping+json" }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      tool: "commit_project_planning_document",
      args: expect.objectContaining({
        documentType: "mechanism_effect_experiment",
        payload: expect.not.objectContaining({ blindMapping: expect.anything() }),
        dependencies: expect.arrayContaining([{ artifactId: "mechanism:mechanism_001", revision: 2 }]),
      }),
    }));
  });

  it("拒绝少于三对、不同冻结路由和未采纳的方法卡", async () => {
    const service = () => createMechanismEffectExperimentService({
      driver: { query: vi.fn().mockResolvedValue([]) } as never,
      commands: { execute: vi.fn() } as never,
      objects: { put: vi.fn() } as never,
      mechanisms: { listAdoptedSnapshots: async () => [adoptedMechanism()] },
    });
    const short = preparedExperiment();
    short.pairs.pop();
    await expect(service().save({ command: command(), projectId: "project_001", expectedRevision: null, experiment: short })).rejects.toThrow(/三组/);

    const mismatched = preparedExperiment();
    mismatched.pairs[1]!.routeSnapshot.model = "another-model";
    await expect(service().save({ command: command(), projectId: "project_001", expectedRevision: null, experiment: mismatched })).rejects.toThrow(/冻结路由/);

    const missing = preparedExperiment();
    missing.mechanismAssetId = "mechanism_missing";
    await expect(service().save({ command: command(), projectId: "project_001", expectedRevision: null, experiment: missing })).rejects.toThrow(/采纳/);

    const repeatedManifest = preparedExperiment();
    repeatedManifest.pairs[1]!.sourceManifestId = repeatedManifest.pairs[0]!.sourceManifestId;
    await expect(service().save({ command: command(), projectId: "project_001", expectedRevision: null, experiment: repeatedManifest })).rejects.toThrow(/ContextManifest/);
  });

  it("读取投影不返回 A/B 映射，只返回盲映射对象引用和可复算结论", async () => {
    const original = preparedExperiment();
    const { blindMapping: _blindMapping, ...payload } = original;
    const service = createMechanismEffectExperimentService({
      driver: { query: vi.fn().mockResolvedValue([{ document_type: "mechanism_effect_experiment", stale: 0, payload_json: JSON.stringify({ ...payload, blindMappingObjectHash: "c".repeat(64), experimentDesignObjectHash: "d".repeat(64), summary: { verdict: "prepared", treatedWins: 0, alignedPairs: 0, majorRegressionCount: 0, sourceLeakageCount: 0 } }) }]) } as never,
      commands: { execute: vi.fn() } as never,
      objects: { put: vi.fn() } as never,
      mechanisms: { listAdoptedSnapshots: async () => [adoptedMechanism()] },
    });

    const view = await service.get({ projectId: "project_001", experimentId: "experiment_001" });
    expect(view).toMatchObject({ experimentId: "experiment_001", blindMappingObjectHash: "c".repeat(64), experimentDesignObjectHash: "d".repeat(64), summary: { verdict: "prepared" } });
    expect(JSON.stringify(view)).not.toContain("baselineCandidateId");
    expect(JSON.stringify(view)).not.toContain("treatedCandidateId");
  });

  it("只在 2/3 双盲胜出、没有 B 组重大退步且零来源泄漏时计算为通过", async () => {
    const prepared = preparedExperiment();
    const { blindMapping: _mapping, ...preparedPayload } = prepared;
    const experiment = preparedExperiment();
    experiment.state = "completed";
    experiment.assessments = experiment.pairs.map((pair, index) => assessment(pair.pairId, index === 2 ? "tie" : `candidate_${index + 1}_b`, index === 2 ? "tie" : `candidate_${index + 1}_b`));
    const service = createMechanismEffectExperimentService({
      driver: { query: vi.fn(async ({ params }: { params: string[] }) => {
        const documentId = params[1]!;
        if (documentId.startsWith("experiment:blind:")) {
          const pairId = documentId.slice("experiment:blind:".length);
          const pair = experiment.pairs.find((item) => item.pairId === pairId)!;
          return [{ document_type: "local_creation_draft", current_revision: 1, content_object_hash: `blind:${pairId}`, payload_json: JSON.stringify({ contextMetadata: { kind: "mechanism_effect_experiment_blind_review", experimentId: experiment.experimentId, pairId, candidateIds: pair.candidates.map((candidate) => candidate.candidateId) } }) }];
        }
        return [{ document_type: "mechanism_effect_experiment", current_revision: 1, payload_json: JSON.stringify({ ...preparedPayload, blindMappingObjectHash: "b".repeat(64), experimentDesignObjectHash: "b".repeat(64), summary: { verdict: "prepared", treatedWins: 0, alignedPairs: 0, majorRegressionCount: 0, sourceLeakageCount: 0 } }) }];
      }) } as never,
      commands: { execute: vi.fn().mockResolvedValue({ kind: "ok", revision: 2, resourceRefs: [] }) } as never,
      objects: { put: vi.fn().mockResolvedValue({ sha256: "b".repeat(64), byteLength: 64, mediaType: "application/json" }), read: vi.fn(async (hash: string) => {
        const pairId = hash.slice("blind:".length);
        const value = experiment.assessments!.find((item) => item.pairId === pairId)!;
        return new TextEncoder().encode(JSON.stringify({ schema_version: 1, kind: "mechanism_effect_experiment_blind_review", experimentId: experiment.experimentId, pairId, structuredTargetEffect: value.structuredTargetEffect, candidateRisks: value.candidateRisks, sourceLeakageCandidateIds: value.sourceLeakageCandidateIds }));
      }) } as never,
      mechanisms: { listAdoptedSnapshots: async () => [adoptedMechanism()] },
    });

    await expect(service.save({ command: command(), projectId: "project_001", expectedRevision: 1, experiment }))
      .resolves.toMatchObject({ kind: "ok" });
    expect(summariseMechanismEffectExperiment(experiment)).toMatchObject({ verdict: "passed", treatedWins: 2, alignedPairs: 2, sourceLeakageCount: 0 });

    experiment.assessments![0]!.sourceLeakageCandidateIds = ["candidate_1_b"];
    expect(summariseMechanismEffectExperiment(experiment)).toMatchObject({ verdict: "failed", sourceLeakageCount: 1 });
  });

  it("不将 tie/tie 视为人类与结构化目标判断的方向一致", () => {
    const experiment = preparedExperiment();
    experiment.state = "completed";
    experiment.assessments = [
      assessment("pair_1", "candidate_1_b", "candidate_1_b"),
      assessment("pair_2", "candidate_2_b", "tie"),
      assessment("pair_3", "tie", "tie"),
    ];

    expect(summariseMechanismEffectExperiment(experiment)).toMatchObject({
      verdict: "inconclusive",
      treatedWins: 2,
      alignedPairs: 1,
    });
  });

  it("completed 阶段必须沿用已冻结 prepared 实验的匿名映射与设计", async () => {
    const prepared = preparedExperiment();
    const { blindMapping: _mapping, ...preparedPayload } = prepared;
    const experiment = preparedExperiment();
    experiment.state = "completed";
    experiment.assessments = experiment.pairs.map((pair) => assessment(pair.pairId, "tie", "tie"));
    experiment.blindMapping[0] = { pairId: "pair_1", baselineCandidateId: "candidate_1_b", treatedCandidateId: "candidate_1_a" };
    const service = createMechanismEffectExperimentService({
      driver: { query: vi.fn().mockResolvedValue([{ document_type: "mechanism_effect_experiment", current_revision: 1, payload_json: JSON.stringify({ ...preparedPayload, blindMappingObjectHash: "a".repeat(64), experimentDesignObjectHash: "a".repeat(64), summary: { verdict: "prepared", treatedWins: 0, alignedPairs: 0, majorRegressionCount: 0, sourceLeakageCount: 0 } }) }]) } as never,
      commands: { execute: vi.fn() } as never,
      objects: { put: vi.fn().mockResolvedValue({ sha256: "b".repeat(64), byteLength: 64, mediaType: "application/json" }) } as never,
      mechanisms: { listAdoptedSnapshots: async () => [adoptedMechanism()] },
    });

    await expect(service.save({ command: command(), projectId: "project_001", expectedRevision: 1, experiment })).rejects.toThrow(/映射|设计/);
  });

  it("completed 阶段必须绑定每组已校验的匿名盲评报告 revision", async () => {
    const prepared = preparedExperiment();
    const { blindMapping: _mapping, ...preparedPayload } = prepared;
    const experiment = preparedExperiment();
    experiment.state = "completed";
    experiment.assessments = experiment.pairs.map((pair) => assessment(pair.pairId, "tie", "tie"));
    const service = createMechanismEffectExperimentService({
      driver: { query: vi.fn().mockResolvedValue([{ document_type: "mechanism_effect_experiment", current_revision: 1, payload_json: JSON.stringify({ ...preparedPayload, blindMappingObjectHash: "a".repeat(64), experimentDesignObjectHash: "a".repeat(64), summary: { verdict: "prepared", treatedWins: 0, alignedPairs: 0, majorRegressionCount: 0, sourceLeakageCount: 0 } }) }]) } as never,
      commands: { execute: vi.fn().mockResolvedValue({ kind: "ok", revision: 2, resourceRefs: [] }) } as never,
      objects: { put: vi.fn().mockResolvedValue({ sha256: "a".repeat(64), byteLength: 64, mediaType: "application/json" }) } as never,
      mechanisms: { listAdoptedSnapshots: async () => [adoptedMechanism()] },
    });

    await expect(service.save({ command: command(), projectId: "project_001", expectedRevision: 1, experiment })).rejects.toThrow(/盲评报告/);
  });

  it("拒绝与冻结匿名盲评报告内容不一致的手填结构化结果", async () => {
    const prepared = preparedExperiment();
    const { blindMapping: _mapping, ...preparedPayload } = prepared;
    const experiment = preparedExperiment();
    experiment.state = "completed";
    experiment.assessments = experiment.pairs.map((pair) => assessment(pair.pairId, "tie", "tie"));
    const service = createMechanismEffectExperimentService({
      driver: { query: vi.fn(async ({ params }: { params: string[] }) => {
        const documentId = params[1]!;
        if (documentId.startsWith("experiment:blind:")) {
          const pairId = documentId.slice("experiment:blind:".length);
          const pair = experiment.pairs.find((item) => item.pairId === pairId)!;
          return [{ document_type: "local_creation_draft", current_revision: 1, content_object_hash: `blind:${pairId}`, payload_json: JSON.stringify({ contextMetadata: { kind: "mechanism_effect_experiment_blind_review", experimentId: experiment.experimentId, pairId, candidateIds: pair.candidates.map((candidate) => candidate.candidateId) } }) }];
        }
        return [{ document_type: "mechanism_effect_experiment", current_revision: 1, payload_json: JSON.stringify({ ...preparedPayload, blindMappingObjectHash: "a".repeat(64), experimentDesignObjectHash: "a".repeat(64), summary: { verdict: "prepared", treatedWins: 0, alignedPairs: 0, majorRegressionCount: 0, sourceLeakageCount: 0 } }) }];
      }) } as never,
      commands: { execute: vi.fn() } as never,
      objects: { put: vi.fn().mockResolvedValue({ sha256: "a".repeat(64), byteLength: 64, mediaType: "application/json" }), read: vi.fn(async (hash: string) => {
        const pairId = hash.slice("blind:".length);
        const pair = experiment.pairs.find((item) => item.pairId === pairId)!;
        const value = experiment.assessments!.find((item) => item.pairId === pairId)!;
        return new TextEncoder().encode(JSON.stringify({ schema_version: 1, kind: "mechanism_effect_experiment_blind_review", experimentId: experiment.experimentId, pairId, structuredTargetEffect: pair.candidates[0].candidateId, candidateRisks: value.candidateRisks, sourceLeakageCandidateIds: value.sourceLeakageCandidateIds }));
      }) } as never,
      mechanisms: { listAdoptedSnapshots: async () => [adoptedMechanism()] },
    });

    await expect(service.save({ command: command(), projectId: "project_001", expectedRevision: 1, experiment })).rejects.toThrow(/结构化盲评.*不一致/);
  });
});

function preparedExperiment(): MechanismEffectExperiment {
  return {
    schema_version: 1 as const,
    kind: "mechanism_effect_experiment" as const,
    experimentId: "experiment_001",
    state: "prepared" as const,
    mechanismAssetId: "mechanism_001",
    mechanismRevision: 2,
    protocol: { contextBudgetTokens: 8000, maxOutputTokens: 1200, seed: "unknown" as const },
    pairs: [1, 2, 3].map((ordinal) => ({
      pairId: `pair_${ordinal}`,
      chapterId: `chapter_${ordinal}`,
      chapterContractRevision: 4,
      sourceManifestId: `source_manifest_${ordinal}`,
      targetSignals: ["读者会形成具体疑问"],
      routeSnapshot: { providerProfileId: "profile_local", baseURL: "http://127.0.0.1:11434/v1", model: "qwen", protocol: "chat_completions" as const, contextWindowTokens: 16000, maxOutputTokens: 1200, safetyMarginRatio: 0.2 },
      candidates: [
        { candidateId: `candidate_${ordinal}_a`, draftDocumentId: `experiment:experiment_001:pair_${ordinal}:candidate_a`, draftArtifactRevision: 1, actualInputTokens: "unknown" as const, actualOutputTokens: "unknown" as const },
        { candidateId: `candidate_${ordinal}_b`, draftDocumentId: `experiment:experiment_001:pair_${ordinal}:candidate_b`, draftArtifactRevision: 1, actualInputTokens: "unknown" as const, actualOutputTokens: "unknown" as const },
      ] as [MechanismEffectExperiment["pairs"][number]["candidates"][0], MechanismEffectExperiment["pairs"][number]["candidates"][1]],
    })),
    blindMapping: [1, 2, 3].map((ordinal) => ({ pairId: `pair_${ordinal}`, baselineCandidateId: `candidate_${ordinal}_a`, treatedCandidateId: `candidate_${ordinal}_b` })),
  };
}

function assessment(pairId: string, winner: string | "tie" | "inconclusive", humanDecision: string | "tie" | "inconclusive") {
  return {
    pairId,
    blindReviewDocumentId: `experiment:blind:${pairId}`,
    blindReviewArtifactRevision: 1,
    structuredTargetEffect: winner,
    humanBlindDecision: humanDecision,
    candidateRisks: [
      { candidateId: pairId.replace("pair", "candidate") + "_a", chapterContract: "none" as const, continuity: "none" as const, originality: "none" as const, readability: "none" as const },
      { candidateId: pairId.replace("pair", "candidate") + "_b", chapterContract: "none" as const, continuity: "none" as const, originality: "none" as const, readability: "none" as const },
    ],
    sourceLeakageCandidateIds: [],
  };
}

function adoptedMechanism() {
  return { revision: 2, card: { id: "mechanism_001", title: "异常先于解释", targetEffect: "建立疑问", scope: "distributed" as const, when: ["开场"], operations: ["先呈现异常"], avoid: ["立刻解释"], applicability: ["信息受限"], targetLayers: ["draft"] as ("draft")[] } };
}

function command() {
  return { schemaVersion: 1 as const, commandId: "command_experiment", idempotencyKey: "idem_experiment", correlationId: "correlation_experiment", actor: { kind: "human_via_agent" as const, id: "agent" }, createdAt: 1_700_000_000_000 };
}
