-- 工作区 DataPolicy 是非秘密、可版本化的设置；不可变历史复用通用 artifact_revisions。
UPDATE data_policies
SET artifact_id = 'settings:data-policy:' || policy_id
WHERE artifact_id IS NULL;

INSERT OR IGNORE INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at)
SELECT artifact_id, project_id, 'data_policy', revision, 'active', created_at, updated_at
FROM data_policies;

INSERT OR IGNORE INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at)
SELECT artifact_id, revision, NULL, payload_json, NULL, '{"kind":"system","id":"migration:0004"}', created_at
FROM data_policies;
