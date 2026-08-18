import { describe, expect, it } from "vitest";
import {
  EvidenceValidationError,
  parseFactExtractionOutput,
  parseMechanismCompilerOutput,
  parseThreadLinkingOutput,
  type EvidenceValidationCode,
} from "@/lib/analysis/evidence-validation";
import type { EpistemicStatus } from "@/lib/analysis/types";

const allowedSpanIds = ["span-1", "span-2", "span-3", "span-counter"];

function expectInvalid(
  run: () => unknown,
  expectedCode: EvidenceValidationCode,
): EvidenceValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EvidenceValidationError);
    const validationError = error as EvidenceValidationError;
    expect(validationError.issues.map((issue) => issue.code)).toContain(
      expectedCode,
    );
    return validationError;
  }
  throw new Error("预期验证失败，但函数成功返回");
}

function fact(
  patch: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "fact-1",
    kind: "event",
    rawLabel: null,
    statement: "门被打开",
    subject: "人物甲",
    object: "门",
    evidenceSpanIds: ["span-1"],
    epistemicStatus: "observed",
    ...patch,
  };
}

function episode(
  patch: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "episode-1",
    role: "setup",
    rawLabel: null,
    summary: "物件首次出现",
    evidenceSpanIds: ["span-1"],
    ordinal: 1,
    ...patch,
  };
}

function thread(
  patch: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "thread-1",
    kind: "object",
    title: "物件流转",
    episodes: [episode()],
    epistemicStatus: "inferred",
    lifecycle: "open",
    ...patch,
  };
}

function card(
  patch: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "card-1",
    title: "延迟命名异常",
    observation: "异常出现后没有被立即解释",
    effectHypothesis: "可能延长不确定性",
    when: ["角色尚未确认异常"],
    do: ["先展示可观察偏差"],
    avoid: ["立刻给出答案"],
    evidenceSpanIds: ["span-1", "span-2", "span-3"],
    counterexampleSpanIds: ["span-counter"],
    epistemicStatus: "inferred",
    lifecycle: "candidate",
    falsification: {
      status: "bounded",
      alternativeExplanations: ["也可能是视角信息受限"],
    },
    applicability: ["悬念建立"],
    targetLayers: ["chapter_plan", "draft"],
    adoption: "pending",
    ...patch,
  };
}

describe("parseFactExtractionOutput", () => {
  it("校验后归一 nullable 可选字段，并且只返回 spanId 引用", () => {
    const result = parseFactExtractionOutput(
      JSON.stringify({ facts: [fact({ subject: null, object: null })] }),
      allowedSpanIds,
    );

    expect(result).toEqual({
      facts: [
        {
          id: "fact-1",
          kind: "event",
          statement: "门被打开",
          evidenceSpanIds: ["span-1"],
          epistemicStatus: "observed",
        },
      ],
    });
  });

  it("拒绝 Markdown 围栏和任何额外字段，包括伪装成证据的 quote", () => {
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          `\`\`\`json\n${JSON.stringify({ facts: [] })}\n\`\`\``,
          allowedSpanIds,
        ),
      "invalid_json",
    );
    const nested = expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({ facts: [fact({ quote: "原文摘录" })] }),
          allowedSpanIds,
        ),
      "extra_field",
    );
    expect(nested.issues.some((issue) => issue.path.endsWith(".quote"))).toBe(
      true,
    );
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({ facts: [], explanation: "前言" }),
          allowedSpanIds,
        ),
      "extra_field",
    );
  });

  it("核心 enum 不做近似映射；other 必须保留非空 rawLabel", () => {
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({ facts: [fact({ kind: "plot_event" })] }),
          allowedSpanIds,
        ),
      "invalid_enum",
    );
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({ facts: [fact({ kind: "other", rawLabel: null })] }),
          allowedSpanIds,
        ),
      "missing_raw_label",
    );
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({ facts: [fact({ rawLabel: "模型自创分类" })] }),
          allowedSpanIds,
        ),
      "unexpected_raw_label",
    );

    const result = parseFactExtractionOutput(
      JSON.stringify({
        facts: [fact({ kind: "other", rawLabel: "仪式动作" })],
      }),
      allowedSpanIds,
    );
    expect(result.facts[0]).toMatchObject({
      kind: "other",
      rawLabel: "仪式动作",
    });
  });

  it.each([
    "observed",
    "inferred",
    "hypothesis",
    "ambiguous",
  ] satisfies EpistemicStatus[])("%s 结论没有证据时拒绝", (status) => {
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({
            facts: [fact({ epistemicStatus: status, evidenceSpanIds: [] })],
          }),
          allowedSpanIds,
        ),
      "evidence_required",
    );
  });

  it.each([
    "unknown",
    "not_observed",
    "not_applicable",
    "extractor_error",
  ] satisfies EpistemicStatus[])("%s 可无证据且不会被改写成其他状态", (status) => {
    const result = parseFactExtractionOutput(
      JSON.stringify({
        facts: [fact({ epistemicStatus: status, evidenceSpanIds: [] })],
      }),
      allowedSpanIds,
    );
    expect(result.facts[0].epistemicStatus).toBe(status);
    expect(result.facts[0].evidenceSpanIds).toEqual([]);
  });

  it("拒绝伪造 span、重复 span 引用和重复候选 id", () => {
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({ facts: [fact({ evidenceSpanIds: ["made-up"] })] }),
          allowedSpanIds,
        ),
      "unknown_span",
    );
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({
            facts: [fact({ evidenceSpanIds: ["span-1", "span-1"] })],
          }),
          allowedSpanIds,
        ),
      "duplicate_span_reference",
    );
    expectInvalid(
      () =>
        parseFactExtractionOutput(
          JSON.stringify({ facts: [fact(), fact({ statement: "另一事实" })] }),
          allowedSpanIds,
        ),
      "duplicate_id",
    );
  });

  it("拒绝超过单个计算单元事实预算的输出，避免模型越界占满结构化输出窗口", () => {
    const facts = Array.from({ length: 17 }, (_, index) => fact({ id: `fact-${index + 1}` }));
    expect(() => parseFactExtractionOutput(JSON.stringify({ facts }), allowedSpanIds)).toThrow(/最多 16 条/);
  });

  it("拒绝超出结构化输出预算的单条事实字段", () => {
    expect(() => parseFactExtractionOutput(
      JSON.stringify({ facts: [fact({ statement: "甲".repeat(161) })] }),
      allowedSpanIds,
    )).toThrow(/最多 160 个字符/);
  });
});

describe("parseThreadLinkingOutput", () => {
  it("未知非空 thread kind 和 episode role 降级为 other 并保留原标签", () => {
    const result = parseThreadLinkingOutput(
      JSON.stringify({
        threads: [thread({
          kind: "mystery",
          episodes: [episode({ role: "foreshadow", rawLabel: null })],
        })],
      }),
      allowedSpanIds,
    );

    expect(result.threads[0]).toMatchObject({
      kind: "other",
      rawLabel: "mystery",
      episodes: [expect.objectContaining({ role: "other", rawLabel: "foreshadow" })],
    });
  });

  it("保留 other episode 的原始标签，并验证严格 thread 结构", () => {
    const result = parseThreadLinkingOutput(
      JSON.stringify({
        threads: [
          thread({
            episodes: [episode({ role: "other", rawLabel: "误导性回声" })],
          }),
        ],
      }),
      allowedSpanIds,
    );

    expect(result.threads[0].episodes[0]).toMatchObject({
      role: "other",
      rawLabel: "误导性回声",
    });
  });

  it("有证据状态要求每个 episode 有合法证据；未知状态可明确留空", () => {
    expectInvalid(
      () =>
        parseThreadLinkingOutput(
          JSON.stringify({
            threads: [
              thread({ episodes: [episode({ evidenceSpanIds: [] })] }),
            ],
          }),
          allowedSpanIds,
        ),
      "evidence_required",
    );

    const result = parseThreadLinkingOutput(
      JSON.stringify({
        threads: [
          thread({
            epistemicStatus: "unknown",
            episodes: [episode({ evidenceSpanIds: [] })],
          }),
        ],
      }),
      allowedSpanIds,
    );
    expect(result.threads[0].epistemicStatus).toBe("unknown");
  });

  it("拒绝跨线程重复 episode id、伪造 span 和额外 excerpt", () => {
    expectInvalid(
      () =>
        parseThreadLinkingOutput(
          JSON.stringify({
            threads: [
              thread(),
              thread({ id: "thread-2", episodes: [episode()] }),
            ],
          }),
          allowedSpanIds,
        ),
      "duplicate_id",
    );
    expectInvalid(
      () =>
        parseThreadLinkingOutput(
          JSON.stringify({ threads: [thread({ id: "episode-1" })] }),
          allowedSpanIds,
        ),
      "duplicate_id",
    );
    expectInvalid(
      () =>
        parseThreadLinkingOutput(
          JSON.stringify({
            threads: [
              thread({
                episodes: [episode({ evidenceSpanIds: ["fabricated"] })],
              }),
            ],
          }),
          allowedSpanIds,
        ),
      "unknown_span",
    );
    expectInvalid(
      () =>
        parseThreadLinkingOutput(
          JSON.stringify({
            threads: [
              thread({ episodes: [episode({ excerpt: "原文" })] }),
            ],
          }),
          allowedSpanIds,
        ),
      "extra_field",
    );
  });
});

describe("parseMechanismCompilerOutput", () => {
  it("返回可交给纯代码晋升门的 MechanismCard", () => {
    const result = parseMechanismCompilerOutput(
      JSON.stringify({ cards: [card()] }),
      allowedSpanIds,
    );
    expect(result.cards[0]).toMatchObject({
      id: "card-1",
      epistemicStatus: "inferred",
      falsification: { status: "bounded" },
    });
  });

  it("同时校验证据与反证 span，拒绝重复卡片 id 和额外字段", () => {
    expectInvalid(
      () =>
        parseMechanismCompilerOutput(
          JSON.stringify({
            cards: [card({ counterexampleSpanIds: ["made-up"] })],
          }),
          allowedSpanIds,
        ),
      "unknown_span",
    );
    expectInvalid(
      () =>
        parseMechanismCompilerOutput(
          JSON.stringify({ cards: [card(), card({ title: "另一张卡" })] }),
          allowedSpanIds,
        ),
      "duplicate_id",
    );
    expectInvalid(
      () =>
        parseMechanismCompilerOutput(
          JSON.stringify({ cards: [card({ quote: "禁止的原文" })] }),
          allowedSpanIds,
        ),
      "extra_field",
    );
  });

  it("有证据状态不可编译成零证据卡，未知状态则被原样保留", () => {
    expectInvalid(
      () =>
        parseMechanismCompilerOutput(
          JSON.stringify({ cards: [card({ evidenceSpanIds: [] })] }),
          allowedSpanIds,
        ),
      "evidence_required",
    );
    const result = parseMechanismCompilerOutput(
      JSON.stringify({
        cards: [card({ epistemicStatus: "not_observed", evidenceSpanIds: [] })],
      }),
      allowedSpanIds,
    );
    expect(result.cards[0].epistemicStatus).toBe("not_observed");
  });
});
