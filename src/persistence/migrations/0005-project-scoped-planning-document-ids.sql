-- project_documents.document_id 是全局主键。将旧的 planning:* 文档移入项目命名空间，
-- 使同一工作区可同时保存多个原创项目的 Intent/Contract/System 等规划。
-- 历史上旧格式已无法为两个项目同时存在，因此本次 UPDATE 不会发生键碰撞。
UPDATE project_documents
SET document_id = 'planning:' || project_id || ':' || substr(document_id, 10)
WHERE document_id LIKE 'planning:%'
  AND document_id NOT LIKE 'planning:%:%:%';
