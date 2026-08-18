import { describe, expect, it } from "vitest";
import { projectTransferMechanismCard } from "@/lib/analysis/transfer-card";
import type { MechanismCard } from "@/lib/analysis/types";

function card(patch: Partial<MechanismCard> = {}): MechanismCard {
  return {
    id: "card-1",
    title: "延迟命名异常",
    observation: "原作先写多个异常，再解释其共同原因。",
    effectHypothesis: "先形成问题，再以揭示重估旧信息。",
    when: ["需要建立可回查的悬念时"],
    do: ["先给可观察但可多解的异常，再延迟给出统一解释"],
    avoid: ["用人物独白提前宣布谜底"],
    evidenceSpanIds: ["s1", "s2", "s3"],
    counterexampleSpanIds: ["s4"],
    epistemicStatus: "inferred",
    lifecycle: "verified",
    falsification: {
      status: "bounded",
      alternativeExplanations: ["异常也可能只承担气氛功能"],
    },
    scope: "distributed",
    applicability: ["悬念型章节"],
    targetLayers: ["chapter_plan", "draft", "editor"],
    adoption: "adopted",
    originCandidateIds: ["u1:module:obs001", "u2:module:obs001", "u3:module:obs001"],
    evidenceInstances: [
      { id: "i1", originCandidateId: "u1:module:obs001", spanIds: ["s1"], chapterIndexes: [1], threadIds: [] },
      { id: "i2", originCandidateId: "u2:module:obs001", spanIds: ["s2"], chapterIndexes: [2], threadIds: [] },
      { id: "i3", originCandidateId: "u3:module:obs001", spanIds: ["s3"], chapterIndexes: [3], threadIds: [] },
    ],
    ...patch,
  };
}

describe("projectTransferMechanismCard", () => {
  it("只白名单投影生产端需要的操作，不泄露证据、原文观察或反证记录", () => {
    const result = projectTransferMechanismCard(card(), {
      forbiddenTerms: ["落日六号", "小姑娘"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card).toEqual({
      id: "card-1",
      title: "延迟命名异常",
      targetEffect: "先形成问题，再以揭示重估旧信息。",
      scope: "distributed",
      when: ["需要建立可回查的悬念时"],
      operations: ["先给可观察但可多解的异常，再延迟给出统一解释"],
      avoid: ["用人物独白提前宣布谜底"],
      applicability: ["悬念型章节"],
      targetLayers: ["chapter_plan", "draft", "editor"],
    });
    expect(JSON.stringify(result.card)).not.toContain("s1");
    expect(JSON.stringify(result.card)).not.toContain("原作先写");
    expect(JSON.stringify(result.card)).not.toContain("气氛功能");
  });

  it("白名单字段仍含源作专名时失败关闭，不做可能改变含义的自动替换", () => {
    const result = projectTransferMechanismCard(
      card({
        do: ["像落日六号那样先隐藏小姑娘的位置"],
      }),
      { forbiddenTerms: ["落日六号", "小姑娘"] },
    );

    expect(result).toEqual({
      ok: false,
      reason: "source_specific_content",
      matchedTerms: ["落日六号", "小姑娘"],
    });
  });

  it("只有已验证且被采用的卡片可以进入生成端", () => {
    expect(projectTransferMechanismCard(card({ lifecycle: "candidate" }), {
      forbiddenTerms: [],
    })).toEqual({ ok: false, reason: "card_not_verified" });
    expect(projectTransferMechanismCard(card({ adoption: "editor_only" }), {
      forbiddenTerms: [],
    })).toEqual({ ok: false, reason: "card_not_adopted" });
    expect(projectTransferMechanismCard(card({ originCandidateIds: undefined }), {
      forbiddenTerms: [],
    })).toEqual({ ok: false, reason: "card_provenance_missing" });
    expect(projectTransferMechanismCard(card({ evidenceInstances: undefined }), {
      forbiddenTerms: [],
    })).toEqual({ ok: false, reason: "card_evidence_instances_missing" });
  });
});
