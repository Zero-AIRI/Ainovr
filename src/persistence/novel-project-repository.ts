import type { PayloadSchemaRegistry } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

type JsonRecord = Record<string, unknown>;

export interface NovelProjectInput {
  projectId: string;
  title: string;
  status: string;
  payload: JsonRecord;
  actor: JsonRecord;
}

export interface UpdateNovelProjectInput extends NovelProjectInput {
  expectedRevision: number;
}

export interface NovelProjectRecord {
  projectId: string;
  title: string;
  status: string;
  revision: number;
  payload: JsonRecord;
  actor: JsonRecord;
}

export interface NovelProjectRepository {
  create(input: NovelProjectInput): Promise<void>;
  update(input: UpdateNovelProjectInput): Promise<void>;
  get(projectId: string): Promise<NovelProjectRecord | null>;
  list(): Promise<NovelProjectRecord[]>;
}

/** 原创项目的当前状态和不可变 Artifact revision 在同一 SQLite 事务中写入。 */
export function createNovelProjectRepository(driver: SqlDriver, schemas: PayloadSchemaRegistry, now: () => number = Date.now): NovelProjectRepository {
  return {
    async create(input): Promise<void> {
      assertProjectPayload(schemas, input.payload);
      const createdAt = now();
      const artifactId = artifactIdFor(input.projectId);
      await driver.transaction([
        {
          sql: "INSERT INTO novel_projects (project_id, title, status, current_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          params: [input.projectId, input.title, input.status, 1, createdAt, createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          params: [artifactId, input.projectId, "novel_project", 1, input.status, createdAt, createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          params: [artifactId, 1, null, JSON.stringify(input.payload), null, JSON.stringify(input.actor), createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
      ]);
    },

    async update(input): Promise<void> {
      assertProjectPayload(schemas, input.payload);
      const updatedAt = now();
      const nextRevision = input.expectedRevision + 1;
      const artifactId = artifactIdFor(input.projectId);
      await driver.transaction([
        {
          sql: "UPDATE novel_projects SET title = ?, status = ?, current_revision = ?, updated_at = ? WHERE project_id = ? AND current_revision = ?",
          params: [input.title, input.status, nextRevision, updatedAt, input.projectId, input.expectedRevision],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "UPDATE artifacts SET status = ?, current_revision = ?, updated_at = ? WHERE artifact_id = ? AND current_revision = ?",
          params: [input.status, nextRevision, updatedAt, artifactId, input.expectedRevision],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          params: [artifactId, nextRevision, input.expectedRevision, JSON.stringify(input.payload), null, JSON.stringify(input.actor), updatedAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
      ]);
    },

    async get(projectId): Promise<NovelProjectRecord | null> {
      const records = await readProjectRecords(driver, "WHERE p.project_id = ?", [projectId]);
      return records[0] ?? null;
    },

    async list(): Promise<NovelProjectRecord[]> {
      return readProjectRecords(driver, "", []);
    },
  };
}

async function readProjectRecords(driver: SqlDriver, whereClause: string, params: Array<string | number>): Promise<NovelProjectRecord[]> {
  const rows = await driver.query<{
    project_id: string;
    title: string;
    status: string;
    current_revision: number;
    payload_json: string;
    actor_json: string;
  }>({
    sql: `
      SELECT p.project_id, p.title, p.status, p.current_revision, r.payload_json, r.actor_json
      FROM novel_projects p
      INNER JOIN artifact_revisions r
        ON r.artifact_id = ('project:' || p.project_id) AND r.revision = p.current_revision
      ${whereClause}
      ORDER BY p.updated_at DESC, p.project_id ASC
    `,
    params,
  });
  return rows.map((row) => ({
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    revision: row.current_revision,
    payload: parseRecord(row.payload_json, "project payload"),
    actor: parseRecord(row.actor_json, "project actor"),
  }));
}

function assertProjectPayload(schemas: PayloadSchemaRegistry, payload: JsonRecord): void {
  const result = schemas.validate("novel_project", payload);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("；"));
}

function artifactIdFor(projectId: string): string {
  return `project:${projectId}`;
}

function parseRecord(value: string, label: string): JsonRecord {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${label} is not a JSON object.`);
  return parsed as JsonRecord;
}
