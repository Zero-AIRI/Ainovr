CREATE TABLE IF NOT EXISTS workspace_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
  sha256 TEXT PRIMARY KEY CHECK(length(sha256) = 64),
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  media_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commands (
  command_id TEXT PRIMARY KEY,
  command_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  project_id TEXT,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  command_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  command_id TEXT REFERENCES commands(command_id),
  actor_json TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS confirmations (
  confirmation_id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(command_id),
  command_hash TEXT NOT NULL,
  risk TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'conflict')),
  reason TEXT,
  actor_json TEXT,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS change_feed (
  change_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  resource_key TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'waiting_confirmation', 'paused', 'succeeded', 'failed', 'cancel_requested', 'cancelled')),
  input_object_hash TEXT REFERENCES objects(sha256),
  output_object_hash TEXT REFERENCES objects(sha256),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  host_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  cursor_json TEXT NOT NULL,
  output_object_hash TEXT REFERENCES objects(sha256),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  project_id TEXT,
  artifact_type TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_revisions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  revision INTEGER NOT NULL,
  parent_revision INTEGER,
  payload_json TEXT NOT NULL,
  content_object_hash TEXT REFERENCES objects(sha256),
  actor_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, revision)
);

CREATE TABLE IF NOT EXISTS artifact_dependencies (
  artifact_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  depends_on_artifact_id TEXT NOT NULL,
  depends_on_revision INTEGER NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0, 1)),
  PRIMARY KEY (artifact_id, revision, depends_on_artifact_id, depends_on_revision),
  FOREIGN KEY (artifact_id, revision) REFERENCES artifact_revisions(artifact_id, revision)
);

CREATE TABLE IF NOT EXISTS pipelines (
  pipeline_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_revisions (
  pipeline_id TEXT NOT NULL REFERENCES pipelines(pipeline_id),
  revision INTEGER NOT NULL,
  parent_revision INTEGER,
  payload_json TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pipeline_id, revision)
);

CREATE TABLE IF NOT EXISTS run_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  pipeline_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (pipeline_id, pipeline_revision) REFERENCES pipeline_revisions(pipeline_id, revision)
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES run_snapshots(snapshot_id),
  project_id TEXT,
  status TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(task_id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS run_nodes (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  output_object_hash TEXT REFERENCES objects(sha256),
  checkpoint_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (run_id, node_id)
);

CREATE TABLE IF NOT EXISTS run_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  node_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_works (
  reference_work_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_editions (
  source_edition_id TEXT PRIMARY KEY,
  reference_work_id TEXT NOT NULL REFERENCES reference_works(reference_work_id),
  raw_object_hash TEXT NOT NULL REFERENCES objects(sha256),
  normalized_object_hash TEXT NOT NULL REFERENCES objects(sha256),
  source_hash TEXT NOT NULL,
  encoding TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  token_estimate INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_locations (
  source_location_id TEXT PRIMARY KEY,
  source_edition_id TEXT NOT NULL REFERENCES source_editions(source_edition_id),
  locator_json TEXT NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte INTEGER NOT NULL,
  CHECK(start_byte >= 0 AND end_byte >= start_byte)
);

CREATE TABLE IF NOT EXISTS analysis_segmentations (
  segmentation_id TEXT PRIMARY KEY,
  source_edition_id TEXT NOT NULL REFERENCES source_editions(source_edition_id),
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_units (
  analysis_unit_id TEXT PRIMARY KEY,
  segmentation_id TEXT NOT NULL REFERENCES analysis_segmentations(segmentation_id),
  ordinal INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte INTEGER NOT NULL,
  status TEXT NOT NULL,
  CHECK(start_byte >= 0 AND end_byte >= start_byte),
  UNIQUE(segmentation_id, ordinal)
);

CREATE TABLE IF NOT EXISTS source_spans (
  span_id TEXT PRIMARY KEY,
  source_edition_id TEXT NOT NULL REFERENCES source_editions(source_edition_id),
  analysis_unit_id TEXT REFERENCES analysis_units(analysis_unit_id),
  start_byte INTEGER NOT NULL,
  end_byte INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  exact_text_hash TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  CHECK(start_byte >= 0 AND end_byte >= start_byte)
);

CREATE TABLE IF NOT EXISTS analysis_projects (
  analysis_project_id TEXT PRIMARY KEY,
  source_edition_id TEXT NOT NULL REFERENCES source_editions(source_edition_id),
  segmentation_id TEXT REFERENCES analysis_segmentations(segmentation_id),
  status TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS research_questions (
  research_question_id TEXT PRIMARY KEY,
  analysis_project_id TEXT NOT NULL REFERENCES analysis_projects(analysis_project_id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(analysis_project_id, ordinal)
);

CREATE TABLE IF NOT EXISTS analysis_items (
  analysis_item_id TEXT PRIMARY KEY,
  analysis_project_id TEXT NOT NULL REFERENCES analysis_projects(analysis_project_id),
  research_question_id TEXT REFERENCES research_questions(research_question_id),
  payload_json TEXT NOT NULL,
  epistemic_status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_instances (
  evidence_instance_id TEXT PRIMARY KEY,
  analysis_item_id TEXT NOT NULL REFERENCES analysis_items(analysis_item_id),
  span_id TEXT NOT NULL REFERENCES source_spans(span_id),
  role TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coverage_entries (
  coverage_entry_id TEXT PRIMARY KEY,
  analysis_project_id TEXT NOT NULL REFERENCES analysis_projects(analysis_project_id),
  analysis_unit_id TEXT REFERENCES analysis_units(analysis_unit_id),
  module TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS research_dossiers (
  dossier_id TEXT PRIMARY KEY,
  analysis_project_id TEXT NOT NULL REFERENCES analysis_projects(analysis_project_id),
  revision INTEGER NOT NULL,
  payload_object_hash TEXT NOT NULL REFERENCES objects(sha256),
  created_at INTEGER NOT NULL,
  UNIQUE(analysis_project_id, revision)
);

CREATE TABLE IF NOT EXISTS mechanism_assets (
  mechanism_asset_id TEXT PRIMARY KEY,
  analysis_project_id TEXT NOT NULL REFERENCES analysis_projects(analysis_project_id),
  status TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mechanism_asset_revisions (
  mechanism_asset_id TEXT NOT NULL REFERENCES mechanism_assets(mechanism_asset_id),
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  neutral_example_object_hash TEXT REFERENCES objects(sha256),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (mechanism_asset_id, revision)
);

CREATE TABLE IF NOT EXISTS mechanism_adoptions (
  adoption_id TEXT PRIMARY KEY,
  mechanism_asset_id TEXT NOT NULL REFERENCES mechanism_assets(mechanism_asset_id),
  project_id TEXT,
  status TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS novel_projects (
  project_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_branches (
  branch_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
  name TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS chapters (
  chapter_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
  branch_id TEXT REFERENCES project_branches(branch_id),
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, branch_id, ordinal)
);

CREATE TABLE IF NOT EXISTS project_documents (
  document_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
  chapter_id TEXT REFERENCES chapters(chapter_id),
  document_type TEXT NOT NULL,
  status TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS canon_entries (
  canon_entry_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_knowledge (
  knowledge_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
  character_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reader_states (
  reader_state_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
  chapter_id TEXT REFERENCES chapters(chapter_id),
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reader_promises (
  reader_promise_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
  chapter_id TEXT REFERENCES chapters(chapter_id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS production_commits (
  production_commit_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES novel_projects(project_id),
  chapter_id TEXT NOT NULL REFERENCES chapters(chapter_id),
  accepted_document_id TEXT NOT NULL REFERENCES project_documents(document_id),
  manifest_object_hash TEXT NOT NULL REFERENCES objects(sha256),
  run_id TEXT REFERENCES runs(run_id),
  actor_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  provider_profile_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  default_model TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_routes (
  route_id TEXT PRIMARY KEY,
  role TEXT NOT NULL UNIQUE,
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(provider_profile_id),
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS data_policies (
  policy_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES novel_projects(project_id),
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
