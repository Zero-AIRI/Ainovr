import type { PayloadSchemaRegistry } from "@/persistence/schema-registry";
import type { SqlDriver } from "@/persistence/sql-driver";

type JsonRecord = Record<string, unknown>;

export interface CreateProjectDocumentInput {
  documentId: string;
  projectId: string;
  chapterId: string | null;
  documentType: string;
  status: string;
  payload: JsonRecord;
  contentObjectHash: string | null;
  actor: JsonRecord;
}

export interface AppendProjectDocumentRevisionInput {
  documentId: string;
  expectedRevision: number;
  status: string;
  payload: JsonRecord;
  contentObjectHash: string | null;
  actor: JsonRecord;
}

export interface ProjectDocumentRecord {
  documentId: string;
  projectId: string;
  chapterId: string | null;
  documentType: string;
  status: string;
  revision: number;
  payload: JsonRecord;
  contentObjectHash: string | null;
  actor: JsonRecord;
}

export interface ProjectDocumentRepository {
  create(input: CreateProjectDocumentInput): Promise<void>;
  appendRevision(input: AppendProjectDocumentRevisionInput): Promise<void>;
  get(documentId: string): Promise<ProjectDocumentRecord | null>;
  list(projectId: string): Promise<ProjectDocumentRecord[]>;
}

/** 项目文档的对象引用、状态和版本在同一个 SQLite 事务中提交。 */
export function createProjectDocumentRepository(driver: SqlDriver, schemas: PayloadSchemaRegistry, now: () => number = Date.now): ProjectDocumentRepository {
  return {
    async create(input): Promise<void> {
      assertDocumentPayload(schemas, input.payload);
      const createdAt = now();
      const artifactId = artifactIdFor(input.documentId);
      await driver.transaction([
        {
          sql: "INSERT INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          params: [artifactId, input.projectId, "project_document", 1, input.status, createdAt, createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "INSERT INTO project_documents (document_id, project_id, chapter_id, document_type, status, artifact_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          params: [input.documentId, input.projectId, input.chapterId, input.documentType, input.status, artifactId, createdAt, createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          params: [artifactId, 1, null, JSON.stringify(input.payload), input.contentObjectHash, JSON.stringify(input.actor), createdAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
      ]);
    },

    async appendRevision(input): Promise<void> {
      assertDocumentPayload(schemas, input.payload);
      const updatedAt = now();
      const nextRevision = input.expectedRevision + 1;
      const artifactId = artifactIdFor(input.documentId);
      await driver.transaction([
        {
          sql: "UPDATE artifacts SET status = ?, current_revision = ?, updated_at = ? WHERE artifact_id = ? AND current_revision = ?",
          params: [input.status, nextRevision, updatedAt, artifactId, input.expectedRevision],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "UPDATE project_documents SET status = ?, updated_at = ? WHERE document_id = ?",
          params: [input.status, updatedAt, input.documentId],
          expectAffectedRows: { min: 1, max: 1 },
        },
        {
          sql: "INSERT INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          params: [artifactId, nextRevision, input.expectedRevision, JSON.stringify(input.payload), input.contentObjectHash, JSON.stringify(input.actor), updatedAt],
          expectAffectedRows: { min: 1, max: 1 },
        },
      ]);
    },

    async get(documentId): Promise<ProjectDocumentRecord | null> {
      const rows = await readDocuments(driver, "WHERE d.document_id = ?", [documentId]);
      return rows[0] ?? null;
    },

    async list(projectId): Promise<ProjectDocumentRecord[]> {
      return readDocuments(driver, "WHERE d.project_id = ?", [projectId]);
    },
  };
}

async function readDocuments(driver: SqlDriver, whereClause: string, params: string[]): Promise<ProjectDocumentRecord[]> {
  const rows = await driver.query<{
    document_id: string;
    project_id: string;
    chapter_id: string | null;
    document_type: string;
    status: string;
    current_revision: number;
    payload_json: string;
    content_object_hash: string | null;
    actor_json: string;
  }>({
    sql: `
      SELECT d.document_id, d.project_id, d.chapter_id, d.document_type, d.status,
             a.current_revision, r.payload_json, r.content_object_hash, r.actor_json
      FROM project_documents d
      INNER JOIN artifacts a ON a.artifact_id = d.artifact_id
      INNER JOIN artifact_revisions r ON r.artifact_id = a.artifact_id AND r.revision = a.current_revision
      ${whereClause}
      ORDER BY d.updated_at DESC, d.document_id ASC
    `,
    params,
  });
  return rows.map((row) => ({
    documentId: row.document_id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    documentType: row.document_type,
    status: row.status,
    revision: row.current_revision,
    payload: parseRecord(row.payload_json, "document payload"),
    contentObjectHash: row.content_object_hash,
    actor: parseRecord(row.actor_json, "document actor"),
  }));
}

function assertDocumentPayload(schemas: PayloadSchemaRegistry, payload: JsonRecord): void {
  const result = schemas.validate("project_document", payload);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("；"));
}

function artifactIdFor(documentId: string): string {
  return `document:${documentId}`;
}

function parseRecord(value: string, label: string): JsonRecord {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${label} is not a JSON object.`);
  return parsed as JsonRecord;
}
