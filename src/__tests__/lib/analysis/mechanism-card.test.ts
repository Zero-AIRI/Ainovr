import { describe, expect, it } from "vitest";
import { assessMechanismCard } from "@/lib/analysis/mechanism-card";
import type {
  MechanismCard,
  SourceDocument,
} from "@/lib/analysis/types";

const document: SourceDocument = {
  schemaVersion: 1,
  sourceId: "source",
  title: "测试",
  boundary: "complete",
  sourceHash: "a".repeat(64),
  normalizationVersion: "raw-v1",
  analysisVersion: "analysis-v1",
  originalText: "甲".repeat(300),
  spans: [
    { id: "s1", kind: "paragraph", text: "甲", startOffset: 10, endOffset: 11, position: 0.03, ordinal: 1 },
    { id: "s2", kind: "paragraph", text: "甲", startOffset: 140, endOffset: 141, position: 0.47, ordinal: 2 },
    { id: "s3", kind: "paragraph", text: "甲", startOffset: 270, endOffset: 271, position: 0.9, ordinal: 3 },
    { id: "counter", kind: "paragraph", text: "甲", startOffset: 200, endOffset: 201, position: 0.67, ordinal: 4 },
  ],
};

function makeCard(patch: Partial<MechanismCard> = {}): MechanismCard {
  return {
    id: "card-1",
    title: "先给日常触感，再揭示危险",
    observation: "危险被命名前，先连续给出可验证的日常感官细节。",
    effectHypothesis: "可能让异常从熟悉感中显形。",
    when: ["角色尚未确认危险"],
    do: ["先写日常动作，再逐次增加不协调细节"],
    avoid: ["每个异常出现后立刻解释"],
    evidenceSpanIds: ["s1", "s2", "s3"],
    counterexampleSpanIds: ["counter"],
    epistemicStatus: "inferred",
    lifecycle: "candidate",
    falsification: { status: "bounded", alternativeExplanations: ["动作密度变化"] },
    scope: "distributed",
    applicability: ["悬念建立"],
    targetLayers: ["chapter_plan", "draft", "editor"],
    adoption: "pending",
    originCandidateIds: [
      "u1:module:obs001",
      "u2:module:obs001",
      "u3:module:obs001",
    ],
    evidenceInstances: [
      { id: "i1", originCandidateId: "u1:module:obs001", spanIds: ["s1"], chapterIndexes: [1], threadIds: [] },
      { id: "i2", originCandidateId: "u2:module:obs001", spanIds: ["s2"], chapterIndexes: [2], threadIds: [] },
      { id: "i3", originCandidateId: "u3:module:obs001", spanIds: ["s3"], chapterIndexes: [3], threadIds: [] },
    ],
    ...patch,
  };
}

describe("assessMechanismCard", () => {
  it("只有证据分布、反证和用途都成立时才允许晋升", () => {
    const result = assessMechanismCard(makeCard(), document);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("拒绝不存在的 span，不能相信模型伪造的摘录", () => {
    const result = assessMechanismCard(
      makeCard({ evidenceSpanIds: ["s1", "s2", "made-up"] }),
      document,
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("invalid_evidence_span");
  });

  it("同一事件即使横跨六个 span，也不能冒充六次独立规律", () => {
    const repeatedEventDocument: SourceDocument = {
      ...document,
      spans: [
        { id: "a", kind: "paragraph", text: "甲", startOffset: 10, endOffset: 11, position: 0.03, ordinal: 1 },
        { id: "b", kind: "paragraph", text: "甲", startOffset: 20, endOffset: 21, position: 0.06, ordinal: 2 },
        { id: "c", kind: "paragraph", text: "甲", startOffset: 30, endOffset: 31, position: 0.1, ordinal: 3 },
        { id: "d", kind: "paragraph", text: "甲", startOffset: 140, endOffset: 141, position: 0.47, ordinal: 4 },
        { id: "e", kind: "paragraph", text: "甲", startOffset: 210, endOffset: 211, position: 0.7, ordinal: 5 },
        { id: "f", kind: "paragraph", text: "甲", startOffset: 270, endOffset: 271, position: 0.9, ordinal: 6 },
        { id: "counter", kind: "paragraph", text: "甲", startOffset: 280, endOffset: 281, position: 0.93, ordinal: 7 },
      ],
    };
    const result = assessMechanismCard(
      makeCard({
        evidenceSpanIds: ["a", "b", "c", "d", "e", "f"],
        originCandidateIds: ["u1:module:obs001"],
        evidenceInstances: [{
          id: "single-event",
          originCandidateId: "u1:module:obs001",
          spanIds: ["a", "b", "c", "d", "e", "f"],
          chapterIndexes: [1, 2, 3],
          threadIds: ["thread-1"],
        }],
      }),
      repeatedEventDocument,
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("insufficient_evidence_instances");
  });

  it("三个独立候选即使都位于中段，也可构成 distributed 机制", () => {
    const middleDocument: SourceDocument = {
      ...document,
      spans: [
        { id: "a", kind: "paragraph", text: "甲", startOffset: 120, endOffset: 121, position: 0.4, ordinal: 1, chapterIndex: 2 },
        { id: "b", kind: "paragraph", text: "甲", startOffset: 150, endOffset: 151, position: 0.5, ordinal: 2, chapterIndex: 2 },
        { id: "c", kind: "paragraph", text: "甲", startOffset: 180, endOffset: 181, position: 0.6, ordinal: 3, chapterIndex: 2 },
        { id: "counter", kind: "paragraph", text: "甲", startOffset: 210, endOffset: 211, position: 0.7, ordinal: 4, chapterIndex: 2 },
      ],
    };

    expect(assessMechanismCard(
      makeCard({
        evidenceSpanIds: ["a", "b", "c"],
        evidenceInstances: [
          { id: "i1", originCandidateId: "u1:module:obs001", spanIds: ["a"], chapterIndexes: [2], threadIds: [] },
          { id: "i2", originCandidateId: "u2:module:obs001", spanIds: ["b"], chapterIndexes: [2], threadIds: [] },
          { id: "i3", originCandidateId: "u3:module:obs001", spanIds: ["c"], chapterIndexes: [2], threadIds: [] },
        ],
      }),
      middleDocument,
    )).toEqual({ eligible: true, reasons: [] });
  });

  it("同一分析单元的三条 observation 不是三个独立实例，不能冒充 distributed", () => {
    const result = assessMechanismCard(
      makeCard({
        originCandidateIds: [
          "u1:prose_rhythm:obs001",
          "u1:prose_rhythm:obs002",
          "u1:prose_rhythm:obs003",
        ],
        evidenceInstances: [
          { id: "i1", originCandidateId: "u1:prose_rhythm:obs001", spanIds: ["s1"], chapterIndexes: [1], threadIds: [] },
          { id: "i2", originCandidateId: "u1:prose_rhythm:obs002", spanIds: ["s2"], chapterIndexes: [1], threadIds: [] },
          { id: "i3", originCandidateId: "u1:prose_rhythm:obs003", spanIds: ["s3"], chapterIndexes: [1], threadIds: [] },
        ],
      }),
      document,
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("insufficient_evidence_instances");
  });

  it("局部或例外机制有明确边界时，不要求伪装成全书分布规律", () => {
    const localDocument: SourceDocument = {
      ...document,
      spans: [
        { id: "a", kind: "paragraph", text: "甲", startOffset: 10, endOffset: 11, position: 0.03, ordinal: 1 },
        { id: "b", kind: "paragraph", text: "甲", startOffset: 20, endOffset: 21, position: 0.06, ordinal: 2 },
        { id: "c", kind: "paragraph", text: "甲", startOffset: 30, endOffset: 31, position: 0.1, ordinal: 3 },
        { id: "counter", kind: "paragraph", text: "甲", startOffset: 40, endOffset: 41, position: 0.13, ordinal: 4 },
      ],
    };
    expect(assessMechanismCard(
      makeCard({
        evidenceSpanIds: ["a", "b", "c"],
        scope: "local",
        originCandidateIds: ["u1:module:obs001"],
        evidenceInstances: undefined,
      }),
      localDocument,
    ).eligible).toBe(true);
    expect(assessMechanismCard(
      makeCard({
        evidenceSpanIds: ["a", "b", "c"],
        scope: "exception",
        originCandidateIds: ["u1:module:obs001"],
        evidenceInstances: undefined,
      }),
      localDocument,
    ).eligible).toBe(true);
  });

  it("局部机制只需一个真实实例，完整反证未找到反例时不强迫制造反例", () => {
    const result = assessMechanismCard(
      makeCard({
        evidenceSpanIds: ["s1"],
        counterexampleSpanIds: [],
        falsification: {
          status: "bounded",
          alternativeExplanations: ["完整检索未发现独立反例，但只适用于当前场景"],
        },
        scope: "local",
        originCandidateIds: ["u1:module:obs001"],
        evidenceInstances: undefined,
      }),
      document,
    );

    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  it("bounded 既无反例也无替代解释时仍然失败关闭", () => {
    const result = assessMechanismCard(
      makeCard({
        counterexampleSpanIds: [],
        falsification: { status: "bounded", alternativeExplanations: [] },
      }),
      document,
    );

    expect(result.reasons).toContain("missing_counterexample");
  });

  it("bounded 可由独立适用边界完成反证，边界不必伪装成反例", () => {
    const result = assessMechanismCard(
      makeCard({
        counterexampleSpanIds: [],
        falsification: {
          status: "bounded",
          alternativeExplanations: [],
          applicabilityLimits: ["只在有限视角下成立"],
        },
      }),
      document,
    );

    expect(result.reasons).not.toContain("missing_counterexample");
  });

  it("缺失 scope 的旧卡不能被自动猜成全局规律", () => {
    expect(assessMechanismCard(makeCard({ scope: undefined }), document).reasons)
      .toContain("missing_scope");
  });

  it("缺失候选来源的旧卡不能因已有 verified 字样绕过晋升门", () => {
    expect(assessMechanismCard(makeCard({ originCandidateIds: undefined }), document).reasons)
      .toContain("missing_origin_candidate");
  });

  it("未知、未观察到和提取失败不会被当成可用结论", () => {
    for (const status of ["unknown", "not_observed", "extractor_error"] as const) {
      const result = assessMechanismCard(
        makeCard({ epistemicStatus: status }),
        document,
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain("epistemic_status_not_promotable");
    }
  });

  it("缺少反证或未来控制层的卡片必须淘汰", () => {
    expect(
      assessMechanismCard(
        makeCard({ falsification: { status: "not_run", alternativeExplanations: [] } }),
        document,
      ).reasons,
    ).toContain("falsification_not_passed");
    expect(
      assessMechanismCard(makeCard({ targetLayers: [] }), document).reasons,
    ).toContain("missing_target_layer");
  });

  it("同一 span 不能同时充当支持证据和反例", () => {
    const result = assessMechanismCard(
      makeCard({ counterexampleSpanIds: ["s1"] }),
      document,
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("counterexample_overlaps_evidence");
  });
});
