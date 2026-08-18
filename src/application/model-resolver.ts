import type { SqlDriver } from "@/persistence/sql-driver";

export type ModelRole = "writer" | "reader" | "reviewer" | "editor" | "fact_extractor";
export type CloudEscalation = "never" | "complex_only" | "always";
export type ModelWireProtocol = "chat_completions" | "responses" | "ollama_native";

export interface ResolvedModelRoute {
  role: ModelRole;
  providerProfileId: string;
  baseURL: string;
  model: string;
  protocol: ModelWireProtocol;
  contextWindowTokens: number;
  maxOutputTokens: number;
  safetyMarginRatio: number;
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
        payload_json: string;
        model: string | null;
      }>({
        sql: `SELECT profile.provider_profile_id, profile.base_url, profile.default_model, profile.payload_json, route.model
              FROM provider_profiles profile
              LEFT JOIN model_routes route ON route.provider_profile_id = profile.provider_profile_id AND route.role = ?
              WHERE route.role = ?
              LIMIT 1`,
        params: [role, role],
      });
      const route = rows[0];
      if (!route) throw new Error(`未配置 ${role} 角色的 Provider 路由。`);
      const policy = await readWorkspacePolicy(driver);
      const profile = parseProfile(route.payload_json);
      const isCloud = !isLoopback(route.base_url);
      if (!isCloud && profile.protocol === "responses") throw new Error(`${role} 角色的本地 Provider 不支持 Responses 协议。`);
      if (isCloud && profile.protocol === "ollama_native") throw new Error(`${role} 角色的远程 Provider 不支持 Ollama 原生协议。`);
      if (isCloud && (policy.cloudEscalation === "never" || (policy.cloudEscalation === "complex_only" && complexity === "routine"))) {
        throw new Error(`${role} 角色的云端升级策略不允许本次调用。`);
      }
      const contextWindowTokens = Math.min(profile.contextWindowTokens, policy.contextWindowTokens);
      const maxOutputTokens = Math.min(profile.maxOutputTokens, policy.maxOutputTokens);
      const safetyMarginRatio = Math.max(profile.safetyMarginRatio, policy.safetyMarginRatio);
      if (maxOutputTokens >= contextWindowTokens) throw new Error(`${role} 角色的有效模型预算无效。`);
      return {
        role,
        providerProfileId: route.provider_profile_id,
        baseURL: route.base_url,
        model: route.model ?? route.default_model,
        protocol: profile.protocol,
        contextWindowTokens,
        maxOutputTokens,
        safetyMarginRatio,
        isCloud,
        cloudEscalation: policy.cloudEscalation,
      };
    },
  };
}

function parseProfile(raw: string): { protocol: ModelWireProtocol; contextWindowTokens: number; maxOutputTokens: number; safetyMarginRatio: number } {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Provider profile payload 损坏。 "); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provider profile payload 损坏。 ");
  const record = value as Record<string, unknown>;
  if ((record.protocol !== "chat_completions" && record.protocol !== "responses" && record.protocol !== "ollama_native") || !Number.isInteger(record.contextWindowTokens) || !Number.isInteger(record.maxOutputTokens) || typeof record.safetyMarginRatio !== "number") throw new Error("Provider profile 缺少协议或模型能力预算。 ");
  return { protocol: record.protocol, contextWindowTokens: record.contextWindowTokens as number, maxOutputTokens: record.maxOutputTokens as number, safetyMarginRatio: record.safetyMarginRatio as number };
}

interface WorkspacePolicyBudget {
  contextWindowTokens: number;
  maxOutputTokens: number;
  safetyMarginRatio: number;
  cloudEscalation: CloudEscalation;
}

const DEFAULT_WORKSPACE_POLICY: WorkspacePolicyBudget = {
  contextWindowTokens: 32_768,
  maxOutputTokens: 4_096,
  safetyMarginRatio: 0.2,
  cloudEscalation: "complex_only",
};

async function readWorkspacePolicy(driver: SqlDriver): Promise<WorkspacePolicyBudget> {
  const rows = await driver.query<{ payload_json: string }>({
    sql: "SELECT payload_json FROM data_policies WHERE policy_id = 'workspace:default' AND project_id IS NULL",
    params: [],
  });
  if (!rows[0]) return DEFAULT_WORKSPACE_POLICY;
  try {
    const payload: unknown = JSON.parse(rows[0].payload_json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("工作区云端升级策略损坏。 ");
    const record = payload as Record<string, unknown>;
    const cloudEscalation = record.cloudEscalation;
    if (cloudEscalation !== "never" && cloudEscalation !== "complex_only" && cloudEscalation !== "always") throw new Error("工作区云端升级策略损坏。 ");
    const contextWindowTokens = record.contextWindowTokens;
    const maxOutputTokens = record.maxOutputTokens;
    const safetyMarginRatio = record.safetyMarginRatio;
    if (!Number.isInteger(contextWindowTokens) || Number(contextWindowTokens) < 1024 || !Number.isInteger(maxOutputTokens) || Number(maxOutputTokens) < 256 || Number(maxOutputTokens) >= Number(contextWindowTokens) || typeof safetyMarginRatio !== "number" || safetyMarginRatio < 0 || safetyMarginRatio >= 1) {
      throw new Error("工作区模型预算损坏。 ");
    }
    return { contextWindowTokens: Number(contextWindowTokens), maxOutputTokens: Number(maxOutputTokens), safetyMarginRatio, cloudEscalation };
  } catch {
    throw new Error("工作区模型策略损坏。 ");
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
