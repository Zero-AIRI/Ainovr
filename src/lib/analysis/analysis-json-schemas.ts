/** OpenAI Responses `text.format` 可直接使用的严格 JSON Schema。 */
export interface AnalysisJSONSchemaTextFormat {
  type: "json_schema";
  name: string;
  schema: Record<string, unknown>;
  strict: true;
  description: string;
}

const EPISTEMIC_STATUS_ENUM = [
  "observed",
  "inferred",
  "hypothesis",
  "ambiguous",
  "unknown",
  "not_observed",
  "not_applicable",
  "extractor_error",
];

const FACT_KIND_ENUM = [
  "character",
  "alias",
  "event",
  "state_change",
  "time",
  "place",
  "object",
  "goal",
  "promise",
  "threat",
  "knowledge",
  "open_question",
  "world_rule",
  "other",
];

/** 每个计算单元的受控事实批次上限，保证结构化输出始终留有恢复余量。 */
export const MAX_FACTS_PER_EXTRACTION = 16;
export const MAX_FACT_EVIDENCE_SPANS = 4;
export const FACT_EXTRACTION_STRING_LIMITS = {
  id: 64,
  rawLabel: 64,
  statement: 160,
  subject: 64,
  object: 64,
  evidenceSpanId: 64,
} as const;

const THREAD_KIND_ENUM = [
  "event",
  "object",
  "expectation",
  "character",
  "relationship",
  "world_rule",
];

const EPISODE_ROLE_ENUM = [
  "setup",
  "reinforcement",
  "escalation",
  "complication",
  "partial_payoff",
  "payoff",
  "reversal",
  "refusal",
  "aftermath",
  "other",
  "unknown",
];

const nullableString = (maxLength?: number): Record<string, unknown> => ({
  type: ["string", "null"],
  ...(maxLength === undefined ? {} : { maxLength }),
});

const stringArray = (options: { maxItems?: number; itemMaxLength?: number } = {}): Record<string, unknown> => ({
  type: "array",
  ...(options.maxItems === undefined ? {} : { maxItems: options.maxItems }),
  items: { type: "string", ...(options.itemMaxLength === undefined ? {} : { maxLength: options.itemMaxLength }) },
});

/** 第一遍事实候选输出。证据只能是程序预编号的 spanId。 */
export const FACT_EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      maxItems: MAX_FACTS_PER_EXTRACTION,
      items: {
        type: "object",
        properties: {
          id: { type: "string", maxLength: FACT_EXTRACTION_STRING_LIMITS.id },
          kind: { type: "string", enum: FACT_KIND_ENUM },
          rawLabel: nullableString(FACT_EXTRACTION_STRING_LIMITS.rawLabel),
          statement: { type: "string", maxLength: FACT_EXTRACTION_STRING_LIMITS.statement },
          subject: nullableString(FACT_EXTRACTION_STRING_LIMITS.subject),
          object: nullableString(FACT_EXTRACTION_STRING_LIMITS.object),
          evidenceSpanIds: stringArray({ maxItems: MAX_FACT_EVIDENCE_SPANS, itemMaxLength: FACT_EXTRACTION_STRING_LIMITS.evidenceSpanId }),
          epistemicStatus: {
            type: "string",
            enum: EPISTEMIC_STATUS_ENUM,
          },
        },
        required: [
          "id",
          "kind",
          "rawLabel",
          "statement",
          "subject",
          "object",
          "evidenceSpanIds",
          "epistemicStatus",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
};

/** 跨计算单元 thread/episode 关系输出。 */
export const THREAD_LINKING_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    threads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: THREAD_KIND_ENUM },
          title: { type: "string" },
          episodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                role: { type: "string", enum: EPISODE_ROLE_ENUM },
                rawLabel: nullableString(),
                summary: { type: "string" },
                evidenceSpanIds: stringArray(),
                ordinal: { type: "integer" },
              },
              required: [
                "id",
                "role",
                "rawLabel",
                "summary",
                "evidenceSpanIds",
                "ordinal",
              ],
              additionalProperties: false,
            },
          },
          epistemicStatus: {
            type: "string",
            enum: EPISTEMIC_STATUS_ENUM,
          },
          lifecycle: {
            type: "string",
            enum: ["open", "resolved", "open_at_boundary", "ambiguous"],
          },
        },
        required: [
          "id",
          "kind",
          "title",
          "episodes",
          "epistemicStatus",
          "lifecycle",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["threads"],
  additionalProperties: false,
};

/** 全局层只规划局部 Thread ID 的分组；完整 episode/证据由程序无损重组。 */
export const THREAD_MERGE_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: [...THREAD_KIND_ENUM, "other"] },
          title: { type: "string" },
          sourceThreadIds: stringArray(),
          epistemicStatus: { type: "string", enum: EPISTEMIC_STATUS_ENUM },
          lifecycle: { type: "string", enum: ["open", "resolved", "open_at_boundary", "ambiguous"] },
        },
        required: ["id", "kind", "title", "sourceThreadIds", "epistemicStatus", "lifecycle"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
};

/**
 * 反证完成后的“编辑意图”输出。证据、认识状态、反证状态、生命周期与 adoption
 * 均由纯代码从 originCandidateIds 推导，模型无权自行填写。
 */
export const MECHANISM_COMPILER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          observation: { type: "string" },
          effectHypothesis: { type: "string" },
          originCandidateIds: stringArray(),
          when: stringArray(),
          do: stringArray(),
          avoid: stringArray(),
          scope: {
            type: "string",
            enum: ["distributed", "local", "exception"],
          },
          applicability: stringArray(),
          targetLayers: {
            type: "array",
            items: {
              type: "string",
              enum: ["outline", "chapter_plan", "draft", "editor"],
            },
          },
        },
        required: [
          "id",
          "title",
          "observation",
          "effectHypothesis",
          "originCandidateIds",
          "when",
          "do",
          "avoid",
          "scope",
          "applicability",
          "targetLayers",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
};

export const FACT_EXTRACTION_TEXT_FORMAT: AnalysisJSONSchemaTextFormat = {
  type: "json_schema",
  name: "ainovr_fact_extraction_v2",
  schema: FACT_EXTRACTION_JSON_SCHEMA,
  strict: true,
  description: "提取只引用预编号 spanId 的事实候选。",
};

export const THREAD_LINKING_TEXT_FORMAT: AnalysisJSONSchemaTextFormat = {
  type: "json_schema",
  name: "ainovr_thread_linking_v2",
  schema: THREAD_LINKING_JSON_SCHEMA,
  strict: true,
  description: "验证跨片段 thread 与 episode，只返回 spanId 证据。",
};

export const MECHANISM_COMPILER_TEXT_FORMAT: AnalysisJSONSchemaTextFormat = {
  type: "json_schema",
  name: "ainovr_mechanism_compiler_v2",
  schema: MECHANISM_COMPILER_JSON_SCHEMA,
  strict: true,
  description: "把完成反证的观察编译为可审查机制卡。",
};
