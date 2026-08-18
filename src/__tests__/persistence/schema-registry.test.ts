import { describe, expect, it } from "vitest";
import { createSchemaRegistry, registerCorePayloadSchemas } from "@/persistence/schema-registry";

describe("持久化 payload schema registry", () => {
  it("所有核心领域 payload 都要求已注册的 schema_version", () => {
    const registry = createSchemaRegistry();
    registerCorePayloadSchemas(registry);

    expect(registry.validate("project_document", { schema_version: 1, title: "正文" })).toEqual({ ok: true });
    expect(registry.validate("project_document", { title: "正文" })).toEqual({
      ok: false,
      diagnostics: [{ code: "missing_schema_version", message: "payload_json 必须包含 schema_version。" }],
    });
    expect(registry.validate("project_document", { schema_version: 2, title: "正文" })).toEqual({
      ok: false,
      diagnostics: [{ code: "unsupported_schema_version", message: "project_document 不支持 schema_version 2。" }],
    });
  });

  it("不允许 Repository 静默写入未注册的 payload 类型", () => {
    const registry = createSchemaRegistry();

    expect(registry.validate("unregistered", { schema_version: 1 })).toEqual({
      ok: false,
      diagnostics: [{ code: "unknown_schema", message: "未注册的 payload schema：unregistered。" }],
    });
  });
});
