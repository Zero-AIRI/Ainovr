import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModelResolver } from "@/application/model-resolver";
import { createNodeSqlDriver } from "@/persistence/node-sqlite-driver";
import type { SqlDriver } from "@/persistence/sql-driver";

describe("ModelResolver", () => {
  let workspacePath: string;
  let driver: SqlDriver;
  beforeEach(async () => { workspacePath = await mkdtemp(path.join(tmpdir(), "ainovr-model-resolver-")); driver = await createNodeSqlDriver({ workspacePath }); });
  afterEach(async () => { await driver.close(); await rm(workspacePath, { recursive: true, force: true }); });

  it("从持久角色路由解析本地模型，且不读取任何 Secret", async () => {
    await profile(driver, "provider_local", "http://localhost:11434/v1", "fallback");
    await route(driver, "writer", "provider_local", "writer-model");
    await expect(createModelResolver(driver).resolve({ role: "writer" })).resolves.toEqual({
      role: "writer", providerProfileId: "provider_local", baseURL: "http://localhost:11434/v1", model: "writer-model", isCloud: false, cloudEscalation: "complex_only",
    });
  });

  it("按 cloudEscalation 拒绝不允许的远程路由", async () => {
    await profile(driver, "provider_cloud", "https://api.example.test/v1", "cloud-model");
    await route(driver, "reviewer", "provider_cloud", "review-model");
    await driver.execute({ sql: "INSERT INTO data_policies (policy_id, project_id, payload_json, revision, created_at, updated_at, artifact_id) VALUES (?, NULL, ?, 1, 1, 1, ?)", params: ["workspace:default", JSON.stringify({ schema_version: 1, cloudEscalation: "never" }), "policy:workspace"] });
    await expect(createModelResolver(driver).resolve({ role: "reviewer" })).rejects.toThrow(/不允许/);
  });
});

async function profile(driver: SqlDriver, id: string, baseURL: string, model: string): Promise<void> {
  await driver.execute({ sql: "INSERT INTO provider_profiles (provider_profile_id, name, base_url, default_model, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)", params: [id, id, baseURL, model, "{}"] });
}
async function route(driver: SqlDriver, role: string, providerProfileId: string, model: string): Promise<void> {
  await driver.execute({ sql: "INSERT INTO model_routes (route_id, role, provider_profile_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", params: [`route:${role}`, role, providerProfileId, model] });
}
