import type Database from "better-sqlite3";

export const FINAL_PRODUCTION_SCHEMA_VERSION = "0006";

type Column = { name: string; notnull: number; pk: number };
type SqlObject = { sql: string | null };

/**
 * Forward-only repair for the final production schema. It must run inside the
 * caller's migration transaction. Every uncertain historical fact aborts the
 * transaction instead of inventing an execution mode or lineage record.
 */
export function migrateFinalProductionSchema(database: Database.Database): void {
  if (hasFinalProductionShape(database)) {
    assertFinalProductionShape(database);
    return;
  }

  migrateRunNodes(database);
  addDossierStale(database);
  addMainBranchOrdinalIndex(database);
  rebuildReaderStates(database);
  rebuildReaderPromises(database);
  rebuildProductionCommits(database);
  assertFinalProductionShape(database);
}

export function assertFinalProductionShape(database: Database.Database): void {
  assertColumns(database, "run_nodes", ["run_id", "node_id", "execution", "task_id", "status", "output_object_hash", "checkpoint_json", "started_at", "completed_at"]);
  const runNodesSql = tableSql(database, "run_nodes");
  if (!/execution\s+text\s+not\s+null/i.test(runNodesSql) || !/check\s*\(\s*execution\s+in\s*\(\s*'executable'\s*,\s*'agent_action'\s*,\s*'human_review'\s*\)\s*\)/i.test(runNodesSql)) {
    throw new Error("Ainovr database is missing the final PipelineRun execution constraint.");
  }
  assertForeignKey(database, "run_nodes", "task_id", "tasks", "task_id");

  const dossierColumns = columns(database, "research_dossiers");
  const stale = dossierColumns.find((column) => column.name === "stale");
  if (!stale || stale.notnull !== 1) throw new Error("Ainovr database is missing the final ResearchDossier stale field.");

  const index = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'chapters_main_branch_ordinal_unique'").get() as SqlObject | undefined;
  if (!index?.sql || !/unique\s+index/i.test(index.sql) || !/on\s+chapters\s*\(\s*project_id\s*,\s*ordinal\s*\)/i.test(index.sql) || !/where\s+branch_id\s+is\s+null/i.test(index.sql)) {
    throw new Error("Ainovr database is missing the final main-branch chapter ordinal invariant.");
  }

  assertCompositePrimaryKey(database, "reader_states", ["project_id", "reader_state_id"]);
  assertForeignKey(database, "reader_states", "project_id", "novel_projects", "project_id");
  assertCompositePrimaryKey(database, "reader_promises", ["project_id", "reader_promise_id"]);
  assertForeignKey(database, "reader_promises", "project_id", "novel_projects", "project_id");

  const commitColumns = columns(database, "production_commits");
  const lineage = commitColumns.find((column) => column.name === "lineage_json");
  if (!lineage || lineage.notnull !== 1) throw new Error("Ainovr database is missing the final ProductionCommit lineage field.");
  assertForeignKey(database, "production_commits", "manifest_object_hash", "objects", "sha256");
  assertForeignKey(database, "production_commits", "run_id", "runs", "run_id");
  assertProductionCommitLineage(database);

  const integrity = database.pragma("integrity_check", { simple: true }) as string;
  if (integrity !== "ok") throw new Error("Ainovr database integrity_check failed after 0006 migration.");
}

function hasFinalProductionShape(database: Database.Database): boolean {
  return hasColumns(database, "run_nodes", ["execution", "task_id"])
    && hasColumns(database, "research_dossiers", ["stale"])
    && Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'chapters_main_branch_ordinal_unique'").get())
    && primaryKey(database, "reader_states").join("\u0000") === "project_id\u0000reader_state_id"
    && primaryKey(database, "reader_promises").join("\u0000") === "project_id\u0000reader_promise_id"
    && hasColumns(database, "production_commits", ["lineage_json"]);
}

function migrateRunNodes(database: Database.Database): void {
  const current = hasColumns(database, "run_nodes", ["execution", "task_id"]);
  if (current) return;
  const oldRows = database.prepare(`SELECT node.run_id, node.node_id, node.status, node.output_object_hash, node.checkpoint_json, node.started_at, node.completed_at, snapshot.payload_json
    FROM run_nodes node INNER JOIN runs run ON run.run_id = node.run_id
    INNER JOIN run_snapshots snapshot ON snapshot.snapshot_id = run.snapshot_id
    ORDER BY node.run_id, node.node_id`).all() as Array<{ run_id: string; node_id: string; status: string; output_object_hash: string | null; checkpoint_json: string | null; started_at: number | null; completed_at: number | null; payload_json: string }>;
  const mapped = oldRows.map((row) => ({ ...row, execution: executionForFrozenNode(row.payload_json, row.node_id, row.run_id) }));
  database.exec(`CREATE TABLE run_nodes_0006 (
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    node_id TEXT NOT NULL,
    execution TEXT NOT NULL CHECK(execution IN ('executable', 'agent_action', 'human_review')),
    task_id TEXT REFERENCES tasks(task_id),
    status TEXT NOT NULL,
    output_object_hash TEXT REFERENCES objects(sha256),
    checkpoint_json TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    PRIMARY KEY (run_id, node_id)
  )`);
  const insert = database.prepare("INSERT INTO run_nodes_0006 (run_id, node_id, execution, task_id, status, output_object_hash, checkpoint_json, started_at, completed_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)");
  for (const row of mapped) insert.run(row.run_id, row.node_id, row.execution, row.status, row.output_object_hash, row.checkpoint_json, row.started_at, row.completed_at);
  database.exec("DROP TABLE run_nodes; ALTER TABLE run_nodes_0006 RENAME TO run_nodes;");
}

function executionForFrozenNode(snapshotJson: string, nodeId: string, runId: string): "executable" | "agent_action" | "human_review" {
  const snapshot = parseRecord(snapshotJson, `PipelineRun ${runId} snapshot`);
  if (!Array.isArray(snapshot.steps)) throw new Error(`PipelineRun ${runId} has no frozen steps; refusing to infer execution.`);
  const step = snapshot.steps.find((value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).id === nodeId) as Record<string, unknown> | undefined;
  const execution = step?.execution;
  if (execution !== "executable" && execution !== "agent_action" && execution !== "human_review") {
    throw new Error(`PipelineRun ${runId} node ${nodeId} has no legal explicit frozen execution; refusing migration.`);
  }
  return execution;
}

function addDossierStale(database: Database.Database): void {
  if (!hasColumns(database, "research_dossiers", ["stale"])) database.exec("ALTER TABLE research_dossiers ADD COLUMN stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0, 1))");
  database.exec("UPDATE research_dossiers SET stale = 0 WHERE stale IS NULL");
}

function addMainBranchOrdinalIndex(database: Database.Database): void {
  const duplicates = database.prepare("SELECT project_id, ordinal FROM chapters WHERE branch_id IS NULL GROUP BY project_id, ordinal HAVING COUNT(*) > 1 LIMIT 1").get();
  if (duplicates) throw new Error("Duplicate main-branch chapter ordinal prevents 0006 migration.");
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS chapters_main_branch_ordinal_unique ON chapters(project_id, ordinal) WHERE branch_id IS NULL");
}

function rebuildReaderStates(database: Database.Database): void {
  if (primaryKey(database, "reader_states").join("\u0000") === "project_id\u0000reader_state_id") return;
  database.exec(`CREATE TABLE reader_states_0006 (
    project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
    reader_state_id TEXT NOT NULL,
    chapter_id TEXT REFERENCES chapters(chapter_id),
    payload_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, reader_state_id)
  );
  INSERT INTO reader_states_0006 (project_id, reader_state_id, chapter_id, payload_json, revision, created_at)
    SELECT project_id, reader_state_id, chapter_id, payload_json, revision, created_at FROM reader_states;
  DROP TABLE reader_states;
  ALTER TABLE reader_states_0006 RENAME TO reader_states;`);
}

function rebuildReaderPromises(database: Database.Database): void {
  if (primaryKey(database, "reader_promises").join("\u0000") === "project_id\u0000reader_promise_id") return;
  database.exec(`CREATE TABLE reader_promises_0006 (
    project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
    reader_promise_id TEXT NOT NULL,
    chapter_id TEXT REFERENCES chapters(chapter_id),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, reader_promise_id)
  );
  INSERT INTO reader_promises_0006 (project_id, reader_promise_id, chapter_id, payload_json, status, revision, created_at, updated_at)
    SELECT project_id, reader_promise_id, chapter_id, payload_json, status, revision, created_at, updated_at FROM reader_promises;
  DROP TABLE reader_promises;
  ALTER TABLE reader_promises_0006 RENAME TO reader_promises;`);
}

function rebuildProductionCommits(database: Database.Database): void {
  const hasLineage = hasColumns(database, "production_commits", ["lineage_json"]);
  const lineages = hasLineage ? productionCommitLineages(database, true) : productionCommitLineages(database, false);
  if (hasLineage) return;
  database.exec(`CREATE TABLE production_commits_0006 (
    production_commit_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
    chapter_id TEXT NOT NULL REFERENCES chapters(chapter_id),
    accepted_document_id TEXT NOT NULL REFERENCES project_documents(document_id),
    manifest_object_hash TEXT NOT NULL REFERENCES objects(sha256),
    run_id TEXT REFERENCES runs(run_id),
    lineage_json TEXT NOT NULL,
    actor_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  const insert = database.prepare("INSERT INTO production_commits_0006 (production_commit_id, project_id, chapter_id, accepted_document_id, manifest_object_hash, run_id, lineage_json, actor_json, created_at) SELECT production_commit_id, project_id, chapter_id, accepted_document_id, manifest_object_hash, run_id, ?, actor_json, created_at FROM production_commits WHERE production_commit_id = ?");
  for (const lineage of lineages) insert.run(lineage.lineageJson, lineage.productionCommitId);
  database.exec("DROP TABLE production_commits; ALTER TABLE production_commits_0006 RENAME TO production_commits;");
}

function assertProductionCommitLineage(database: Database.Database): void { productionCommitLineages(database, true); }

function productionCommitLineages(database: Database.Database, hasLineageColumn: boolean): Array<{ productionCommitId: string; lineageJson: string }> {
  const lineageSelect = hasLineageColumn ? ", production_commit.lineage_json" : "";
  const rows = database.prepare(`SELECT production_commit.production_commit_id, production_commit.project_id, production_commit.chapter_id, production_commit.accepted_document_id, production_commit.manifest_object_hash, production_commit.run_id, revision.payload_json${lineageSelect}
    FROM production_commits production_commit
    INNER JOIN project_documents document ON document.document_id = production_commit.accepted_document_id AND document.project_id = production_commit.project_id AND document.chapter_id = production_commit.chapter_id AND document.document_type = 'chapter_text' AND document.status = 'accepted'
    INNER JOIN artifacts artifact ON artifact.artifact_id = document.artifact_id AND artifact.project_id = production_commit.project_id
    INNER JOIN artifact_revisions revision ON revision.artifact_id = artifact.artifact_id AND revision.revision = artifact.current_revision
    INNER JOIN objects manifest ON manifest.sha256 = production_commit.manifest_object_hash
    LEFT JOIN runs run ON run.run_id = production_commit.run_id
    WHERE production_commit.run_id IS NULL OR run.run_id IS NOT NULL`).all() as Array<{ production_commit_id: string; project_id: string; chapter_id: string; accepted_document_id: string; manifest_object_hash: string; run_id: string | null; payload_json: string; lineage_json?: string }>;
  const expectedCount = database.prepare("SELECT COUNT(*) AS count FROM production_commits").get() as { count: number };
  if (rows.length !== expectedCount.count) throw new Error("ProductionCommit references cannot be verified; refusing 0006 migration.");
  return rows.map((row) => ({ productionCommitId: row.production_commit_id, lineageJson: JSON.stringify(verifiedLineage(row, hasLineageColumn ? row.lineage_json : undefined)) }));
}

function verifiedLineage(row: { production_commit_id: string; chapter_id: string; accepted_document_id: string; manifest_object_hash: string; run_id: string | null; payload_json: string }, persistedLineage?: string): Record<string, unknown> {
  const payload = parseRecord(row.payload_json, `ProductionCommit ${row.production_commit_id} accepted document`);
  const selected = record(payload.selectedDraft, `ProductionCommit ${row.production_commit_id} selectedDraft`);
  const reviewLineage = selected.reviewLineage;
  const lineage = persistedLineage === undefined ? record(payload.lineage, `ProductionCommit ${row.production_commit_id} lineage`) : parseRecord(persistedLineage, `ProductionCommit ${row.production_commit_id} lineage_json`);
  if (payload.kind !== "chapter_text" || payload.chapterId !== row.chapter_id || payload.productionCommitId !== row.production_commit_id
    || typeof payload.manifestId !== "string" || !payload.manifestId.trim()
    || lineage.schema_version !== 1 || lineage.selectedDraftDocumentId !== selected.documentId || lineage.selectedDraftRevision !== selected.revision
    || lineage.selectedDraftExecutionRef !== selected.executionRef || lineage.model !== selected.model || lineage.manifestId !== payload.manifestId
    || lineage.runId !== row.run_id || !Array.isArray(lineage.reviewIds) || lineage.reviewIds.some((value) => typeof value !== "string" || !value.trim())
    || !Array.isArray(reviewLineage) || reviewLineage.some((value) => typeof value !== "string" || !value.trim())
    || lineage.reviewIds.length !== reviewLineage.length || lineage.reviewIds.some((value, index) => value !== reviewLineage[index])) {
    throw new Error(`ProductionCommit ${row.production_commit_id} lacks verifiable complete lineage; refusing 0006 migration.`);
  }
  return lineage;
}

function columns(database: Database.Database, table: string): Column[] { return database.prepare(`PRAGMA table_info(${table})`).all() as Column[]; }
function hasColumns(database: Database.Database, table: string, names: readonly string[]): boolean { const found = columns(database, table); return found.length > 0 && names.every((name) => found.some((column) => column.name === name)); }
function assertColumns(database: Database.Database, table: string, names: readonly string[]): void { if (!hasColumns(database, table, names)) throw new Error(`Ainovr database is missing final ${table} columns.`); }
function primaryKey(database: Database.Database, table: string): string[] { return columns(database, table).filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name); }
function assertCompositePrimaryKey(database: Database.Database, table: string, expected: readonly string[]): void { if (primaryKey(database, table).join("\u0000") !== expected.join("\u0000")) throw new Error(`Ainovr database has an invalid ${table} primary key.`); }
function tableSql(database: Database.Database, table: string): string { const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as SqlObject | undefined; if (!row?.sql) throw new Error(`Ainovr database is missing table ${table}.`); return row.sql; }
function assertForeignKey(database: Database.Database, table: string, from: string, targetTable: string, targetColumn: string): void { const keys = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string; table: string; to: string }>; if (!keys.some((key) => key.from === from && key.table === targetTable && key.to === targetColumn)) throw new Error(`Ainovr database is missing final ${table}.${from} foreign key.`); }
function parseRecord(value: string, label: string): Record<string, unknown> { try { return record(JSON.parse(value), label); } catch (cause) { if (cause instanceof Error) throw cause; throw new Error(`${label} is invalid JSON.`); } }
function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
