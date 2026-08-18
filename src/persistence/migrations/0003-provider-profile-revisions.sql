-- Provider 配置只存非秘密路由元数据；不可变 revision 统一进入 artifacts。
UPDATE provider_profiles
SET artifact_id = 'settings:provider:' || provider_profile_id
WHERE artifact_id IS NULL;

INSERT OR IGNORE INTO artifacts (artifact_id, project_id, artifact_type, current_revision, status, created_at, updated_at)
SELECT artifact_id, NULL, 'provider_profile', current_revision, 'active', created_at, updated_at
FROM provider_profiles;

INSERT OR IGNORE INTO artifact_revisions (artifact_id, revision, parent_revision, payload_json, content_object_hash, actor_json, created_at)
SELECT artifact_id, current_revision, NULL, payload_json, NULL, '{"kind":"system","id":"migration:0003"}', created_at
FROM provider_profiles;
