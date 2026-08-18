export type WorkbenchSection = "works" | "references" | "pending" | "settings";

export interface WorkbenchNavigationItem {
  id: WorkbenchSection;
  label: string;
  description: string;
}

export interface TextDiffView {
  unchanged: boolean;
  prefix: string;
  beforeChanged: string;
  afterChanged: string;
  suffix: string;
}

/** Provider 草稿与最新持久化 revision 的可渲染差异；不包含任何 Secret。 */
export interface ProviderProfileComparable {
  name: string;
  baseURL: string;
  defaultModel: string;
  routes: ReadonlyArray<{ role: string; model: string }>;
}

export interface ProviderProfileFieldDiff {
  label: "显示名称" | "Base URL" | "默认模型" | "角色路由";
  local: string;
  current: string;
}

/** 最终产品固定的一级信息架构；画布和聊天不再是入口。 */
export const WORKBENCH_NAVIGATION: readonly WorkbenchNavigationItem[] = [
  { id: "works", label: "作品", description: "项目、章节、版本和生产状态" },
  { id: "references", label: "参考", description: "证据、覆盖与机制候选" },
  { id: "pending", label: "待处理", description: "确认、冲突和需恢复的任务" },
  { id: "settings", label: "设置", description: "本地模型路由与数据策略" },
];

/** change feed 刷新后不保留已删除项目的本地选择。 */
export function selectExistingProject<T extends { projectId: string }>(selectedProjectId: string, projects: readonly T[]): string {
  if (selectedProjectId && projects.some((project) => project.projectId === selectedProjectId)) return selectedProjectId;
  return projects[0]?.projectId ?? "";
}

/**
 * 线性版本视图的最小、稳定 diff：按 Unicode 代码点而非 UTF-16 code unit 比较，
 * 供 UI 展示 Editor 定向修改，不能替代持久化的 revision 与 Reviewer 证据。
 */
export function calculateTextDiff(before: string, after: string): TextDiffView {
  const beforeCharacters = Array.from(before);
  const afterCharacters = Array.from(after);
  let prefixLength = 0;
  while (prefixLength < beforeCharacters.length && prefixLength < afterCharacters.length && beforeCharacters[prefixLength] === afterCharacters[prefixLength]) {
    prefixLength += 1;
  }
  if (prefixLength === beforeCharacters.length && prefixLength === afterCharacters.length) {
    return { unchanged: true, prefix: before, beforeChanged: "", afterChanged: "", suffix: "" };
  }
  let suffixLength = 0;
  while (
    suffixLength < beforeCharacters.length - prefixLength
    && suffixLength < afterCharacters.length - prefixLength
    && beforeCharacters[beforeCharacters.length - suffixLength - 1] === afterCharacters[afterCharacters.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }
  return {
    unchanged: false,
    prefix: beforeCharacters.slice(0, prefixLength).join(""),
    beforeChanged: beforeCharacters.slice(prefixLength, beforeCharacters.length - suffixLength).join(""),
    afterChanged: afterCharacters.slice(prefixLength, afterCharacters.length - suffixLength).join(""),
    suffix: suffixLength === 0 ? "" : beforeCharacters.slice(beforeCharacters.length - suffixLength).join(""),
  };
}

/** 设置页使用的可读路由草稿格式：每行 `角色=模型`，与领域命令的结构化 routes 一一对应。 */
export function parseProviderRoutes(draft: string): Array<{ role: string; model: string }> {
  const routes = draft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    if (separator < 1 || separator === line.length - 1) throw new Error("每条角色路由必须是“角色=模型”。 ");
    const role = line.slice(0, separator).trim();
    const model = line.slice(separator + 1).trim();
    if (!role || !model) throw new Error("每条角色路由必须是“角色=模型”。 ");
    return { role, model };
  });
  if (new Set(routes.map((route) => route.role)).size !== routes.length) throw new Error("角色路由不可重复。 ");
  return routes.sort((left, right) => left.role.localeCompare(right.role));
}

/**
 * 不同 revision 不能静默覆盖：冲突面板只展示已变字段，并将角色路由规范化后比较，
 * 防止单纯的输入顺序被误报为配置变化。
 */
export function compareProviderProfileDraft(local: ProviderProfileComparable, current: ProviderProfileComparable): ProviderProfileFieldDiff[] {
  const fields: Array<{ label: ProviderProfileFieldDiff["label"]; local: string; current: string }> = [
    { label: "显示名称", local: local.name.trim(), current: current.name.trim() },
    { label: "Base URL", local: local.baseURL.trim(), current: current.baseURL.trim() },
    { label: "默认模型", local: local.defaultModel.trim(), current: current.defaultModel.trim() },
    { label: "角色路由", local: formatRoutes(local.routes), current: formatRoutes(current.routes) },
  ];
  return fields.filter((field) => field.local !== field.current);
}

function formatRoutes(routes: ReadonlyArray<{ role: string; model: string }>): string {
  return [...routes]
    .map((route) => ({ role: route.role.trim(), model: route.model.trim() }))
    .sort((left, right) => left.role.localeCompare(right.role))
    .map((route) => `${route.role}=${route.model}`)
    .join("\n");
}
