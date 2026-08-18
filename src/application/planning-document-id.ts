/**
 * `project_documents.document_id` 是全库主键，规划文档绝不能再使用跨项目重复的
 * `planning:story_contract` 形式。所有项目级规划 ID 都以 projectId 命名空间化。
 */
export function planningDocumentId(projectId: string, kind: string, suffix?: string): string {
  if (!projectId.trim() || !kind.trim()) throw new Error("规划文档 ID 需要 projectId 和 kind。 ");
  return `planning:${projectId}:${kind}${suffix ? `:${suffix}` : ""}`;
}
