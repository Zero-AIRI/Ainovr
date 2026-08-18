export interface SchemaDiagnostic {
  code: "unknown_schema" | "missing_schema_version" | "unsupported_schema_version" | "invalid_payload";
  message: string;
}

export type SchemaValidation =
  | { ok: true }
  | { ok: false; diagnostics: SchemaDiagnostic[] };

export interface PayloadSchemaRegistry {
  register(schemaName: string, supportedVersions: readonly number[]): void;
  validate(schemaName: string, payload: unknown): SchemaValidation;
}

/**
 * SQLite payload 的最小统一入口。领域 Repository 在写入前必须调用 validate；
 * 更细字段契约随各领域 schema revision 增加，不允许绕过 schema_version。
 */
export function createSchemaRegistry(): PayloadSchemaRegistry {
  const schemas = new Map<string, ReadonlySet<number>>();

  return {
    register(schemaName, supportedVersions) {
      if (!schemaName.trim()) throw new Error("Schema name is required.");
      if (supportedVersions.length === 0) throw new Error(`Schema ${schemaName} requires at least one supported version.`);
      schemas.set(schemaName, new Set(supportedVersions));
    },

    validate(schemaName, payload) {
      const versions = schemas.get(schemaName);
      if (!versions) {
        return { ok: false, diagnostics: [{ code: "unknown_schema", message: `未注册的 payload schema：${schemaName}。` }] };
      }
      if (!isRecord(payload) || typeof payload.schema_version !== "number" || !Number.isInteger(payload.schema_version)) {
        return { ok: false, diagnostics: [{ code: "missing_schema_version", message: "payload_json 必须包含 schema_version。" }] };
      }
      if (!versions.has(payload.schema_version)) {
        return { ok: false, diagnostics: [{ code: "unsupported_schema_version", message: `${schemaName} 不支持 schema_version ${payload.schema_version}。` }] };
      }
      return { ok: true };
    },
  };
}

/** R0 冻结的 V1/V2 领域 payload 在新 SQLite Repository 中的注册入口。 */
export function registerCorePayloadSchemas(registry: PayloadSchemaRegistry): void {
  for (const schemaName of [
    "workspace_meta", "pipeline_revision", "run_snapshot", "reference_work", "source_edition", "analysis_segmentation",
    "analysis_item", "mechanism_asset", "novel_project", "project_document", "canon_entry", "character_knowledge",
    "reader_state", "reader_promise", "production_commit", "provider_profile", "data_policy",
  ]) {
    registry.register(schemaName, [1]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
