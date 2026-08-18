import { describe, expect, it } from "vitest";
import {
  FACT_EXTRACTION_JSON_SCHEMA,
  FACT_EXTRACTION_TEXT_FORMAT,
  MECHANISM_COMPILER_JSON_SCHEMA,
  MECHANISM_COMPILER_TEXT_FORMAT,
  THREAD_LINKING_JSON_SCHEMA,
  THREAD_LINKING_TEXT_FORMAT,
} from "@/lib/analysis/analysis-json-schemas";

const formats = [
  FACT_EXTRACTION_TEXT_FORMAT,
  THREAD_LINKING_TEXT_FORMAT,
  MECHANISM_COMPILER_TEXT_FORMAT,
];

function assertAllObjectsAreStrict(schema: unknown): void {
  if (Array.isArray(schema)) {
    for (const value of schema) assertAllObjectsAreStrict(value);
    return;
  }
  if (typeof schema !== "object" || schema === null) return;

  const record = schema as Record<string, unknown>;
  if (record.type === "object") {
    expect(record.additionalProperties).toBe(false);
    expect(record.properties).toBeTypeOf("object");
    expect(record.required).toEqual(
      Object.keys(record.properties as Record<string, unknown>),
    );
  }
  for (const value of Object.values(record)) assertAllObjectsAreStrict(value);
}

describe("证据分析 Responses JSON Schema", () => {
  it("三个 text.format 都启用 strict JSON Schema，并直接复用导出的 schema", () => {
    expect(formats.map((format) => format.type)).toEqual([
      "json_schema",
      "json_schema",
      "json_schema",
    ]);
    expect(formats.every((format) => format.strict)).toBe(true);
    expect(FACT_EXTRACTION_TEXT_FORMAT.schema).toBe(
      FACT_EXTRACTION_JSON_SCHEMA,
    );
    expect(THREAD_LINKING_TEXT_FORMAT.schema).toBe(THREAD_LINKING_JSON_SCHEMA);
    expect(MECHANISM_COMPILER_TEXT_FORMAT.schema).toBe(
      MECHANISM_COMPILER_JSON_SCHEMA,
    );
  });

  it("所有嵌套 object 都封闭额外字段，且 strict 模式要求声明全部属性", () => {
    for (const format of formats) assertAllObjectsAreStrict(format.schema);
  });

  it("事实 schema 只允许严格类别，并用 spanId 数组而不是 quote", () => {
    const facts = (FACT_EXTRACTION_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >).facts;
    const fact = facts.items as Record<string, unknown>;
    const properties = fact.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(facts.maxItems).toBe(16);
    expect(properties.statement.maxLength).toBe(160);
    expect(properties.evidenceSpanIds.maxItems).toBe(4);
    expect(properties.kind.enum).toEqual([
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
    ]);
    expect(properties.evidenceSpanIds.type).toBe("array");
    expect(properties).not.toHaveProperty("quote");
    expect(properties).not.toHaveProperty("excerpt");
  });

  it("thread 只暴露 spanId；compiler 只暴露 candidate provenance，证据由程序派生", () => {
    const threadSerialized = JSON.stringify(THREAD_LINKING_JSON_SCHEMA);
    const compilerSerialized = JSON.stringify(MECHANISM_COMPILER_JSON_SCHEMA);
    expect(threadSerialized).toContain("evidenceSpanIds");
    expect(compilerSerialized).toContain("originCandidateIds");
    expect(compilerSerialized).not.toContain("evidenceSpanIds");
    expect(compilerSerialized).not.toContain("counterexampleSpanIds");
    const serialized = threadSerialized + compilerSerialized;
    expect(serialized).not.toContain('"quote"');
    expect(serialized).not.toContain('"excerpt"');
  });
});
