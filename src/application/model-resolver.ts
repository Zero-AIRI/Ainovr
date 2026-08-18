import type { SqlDriver } from "@/persistence/sql-driver";

export type ModelRole = "writer" | "reader" | "reviewer" | "editor" | "fact_extractor";
export type CloudEscalation = "never" | "complex_only" | "always";

export interface ResolvedModelRoute {
  role: ModelRole;
  providerProfileId: string;
  baseURL: string;
  model: string;
  isCloud: boolean;
  cloudEscalation: CloudEscalation;
}

export interface ModelResolver {
  resolve(input: { role: ModelRole; complexity?: "routine" | "complex" }): Promise<ResolvedModelRoute>;
}

/**
 * The only reader of persisted provider routes.  It deliberately returns no
 * credential material: callers obtain credentials through a separate runtime
 * SecretStore, keeping SQLite and ObjectStore free of API keys.
 */
export function createModelResolver(driver: SqlDriver): ModelResolver {
  return {
    async resolve({ role, complexity = "complex" }) {
      const rows = await driver.query<{
        provider_profile_id: string;
        base_url: string;
        default_model: string;
        model: string | null;
      }>({
        sql: `SELECT profile.provider_profile_id, profile.base_url, profile.default_model, route.model
              FROM provider_profiles profile
              LEFT JOIN model_routes route ON route.provider_profile_id = profile.provider_profile_id AND route.role = ?
              WHERE route.role = ?
              LIMIT 1`,
        params: [role, role],
      });
      const route = rows[0];
      if (!route) throw new Error(`未配置 ${role} 角色的 Provider 路由。`);
      const policy = await readCloudEscalation(driver);
      const isCloud = !isLoopback(route.base_url);
      if (isCloud && (policy === "never" || (policy === "complex_only" && complexity === "routine"))) {
        throw new Error(`${role} 角色的云端升级策略不允许本次调用。`);
      }
      return {
        role,
        providerProfileId: route.provider_profile_id,
        baseURL: route.base_url,
        model: route.model ?? route.default_model,
        isCloud,
        cloudEscalation: policy,
      };
    },
  };
}

async function readCloudEscalation(driver: SqlDriver): Promise<CloudEscalation> {
  const rows = await driver.query<{ payload_json: string }>({
    sql: "SELECT payload_json FROM data_policies WHERE policy_id = 'workspace:default' AND project_id IS NULL",
    params: [],
  });
  if (!rows[0]) return "complex_only";
  try {
    const payload: unknown = JSON.parse(rows[0].payload_json);
    const value = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).cloudEscalation
      : null;
    return value === "never" || value === "complex_only" || value === "always" ? value : "complex_only";
  } catch {
    throw new Error("工作区云端升级策略损坏。 ");
  }
}

function isLoopback(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    throw new Error("Provider baseURL 无效。 ");
  }
}
