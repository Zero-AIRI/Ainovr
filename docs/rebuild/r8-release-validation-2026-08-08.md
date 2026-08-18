# R8：备份、导出、便携与 MCP 发布验证（2026-08-08）

状态：**R8 发布复现门通过（2026-08-09 clean clone）**。全量长文本、人工事实准确率抽查与云端模型对比按用户指示范围豁免，未被写成通过。新系统主体已形成受审查 Git 提交，并从独立 clone 验证。Tauri WebView 仅通过打包 Node MCP sidecar 的受限领域 RPC 访问工作区。本记录只保留可复查的运行结果；不输出 `settings.json`、API Key、参考原文或模型 Prompt。

## 真实工作区备份与恢复

在 `S:\Ainovr` 的当前 SQLite 工作区通过领域 CLI 创建并完成维护任务：

| 动作 | 领域任务 | 结果 |
|---|---|---|
| 在线备份 | `task_backup_final_audit_20260808` | `succeeded`；备份 ID `backup-final-audit-20260808` |
| 恢复请求 | `cmd_restore_final_audit_20260808` | 进入持久 `workspace_restore` confirmation |
| MCP 人工代理批准 | `confirmation:cmd_restore_final_audit_20260808` | `human_via_agent` 批准后任务重新排队 |
| 恢复执行 | `task_restore_final_audit_20260808` | `succeeded`；恢复 ID `restore-final-audit-20260808` |

恢复输出位于受控的新目录 `data/restores/restore-final-audit-20260808`。核验：

- 存在 `data/ainovr.sqlite3` 与对象库；
- 存在仅含 hash/长度/媒体类型的 `backup-manifest.json`；
- 不存在 `data/settings.json`；
- 没有覆盖活动工作区。

## 安全项目导出

项目 `project_local_original_20260808` 已通过 `task_export_final_audit_20260808` 导出，状态为 `succeeded`。对生成的 `bundle.json` 进行发布前模式检查：

- 未发现 API Key、`sk-` 令牌或 `settings.json`；
- 未发现 `SourceEdition` / 参考原文内容；
- 导出正文仍来自 QueryService 投影而非直接读取 SQLite 或对象路径。

## 便携目录演练

将上述恢复结果复制到新的便携根目录 `data/restores/portable-moved-final-audit-20260808` 后，使用构建后的 CLI 执行 `get-workspace-status` 成功，返回与恢复快照一致的 workspace revision、change sequence 与项目数。此演练未复制 Secret 文件。

## MCP companion

`dist-mcp/ainovr-mcp.mjs` 已执行 stdio `initialize` 与 `tools/list` 冒烟。它返回 `protocolVersion=2025-06-18`，工具面包含领域查询、命令、TaskRunner、备份与导出；未暴露 `read_data_file`、`write_data_file`、SQL 或任意路径文件工具。

宿主配置与手动连通性说明见 [mcp-companion-setup.md](mcp-companion-setup.md)。

## 旧运行时归档后的重新验证

旧 JSON Store、React Flow / Zustand 业务路径、内置 Assistant 及其专属测试已通过受控移动
当时归档到 `archive/legacy-2026-08/src/`；本次公开基线改由本地封存 bundle 保留回溯能力，因而不再携带这些 archive 与
`Ainovr.previous.exe`。迁移范围和 red → green 红线见
[r8-legacy-consumer-audit-2026-08-08.md](r8-legacy-consumer-audit-2026-08-08.md)。

归档后重新执行：

```text
npm test             61 files passed, 227 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
npm run tauri build  passed (MSI + NSIS)
```

构建后的 stdio MCP 再次执行 `initialize` / `tools/list`：共 105 个领域工具，未出现
`read_data_file`、`write_data_file`、`read_file`、`write_file` 或 SQL 工具。它仍保留
确认保护的 `request_reference_file_import`，这是领域导入命令而非任意路径文件工具。

对 `dist/`、`dist-cli/`、`dist-mcp/`、发布 bundle 文本和最终项目导出分别执行 API Key
值模式扫描，均未命中；扫描不读取 `data/settings.json`。

## 当前工作树重新构建（2026-08-09）

在未修改活动产品代码的情况下，对当前工作树重新执行发布前回归。结果如下：

```text
npm test             61 files passed, 226 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
npm run tauri build  passed (MSI + NSIS)
```

构建后的 `tools/list` 再次返回 105 个领域工具，未包含
`read_data_file`、`write_data_file`、`read_file`、`write_file`、`execute_sql`、
`query_sql`、`run_sql`、`sqlite_query` 或 `sql_query`。Tauri 构建仅报告既有的
`com.ainovr.app` bundle identifier 提示，未阻断 MSI 或 NSIS 产物。

## 最终门复核增量（2026-08-09）

在不读取 `data/settings.json` 的前提下，再次运行并通过：

```text
npm test             61 files passed, 227 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
npm run tauri build  passed (MSI + NSIS)
```

额外运行时核验：

- 对 `dist/`、`dist-cli/`、`dist-mcp/`、Tauri 发布 bundle、`data/exports/` 和
  `data/restores/` 执行发布物 Secret 模式扫描，未发现 API Key、Bearer token 或
  `settings.json` 内容。
- 当前构建的 stdio MCP 完成 `initialize` 和 `tools/list`，返回 105 个领域工具；
  禁止的通用文件和 SQL 工具均未出现。
- 已有便携恢复目录可被当前构建 CLI 打开：workspace revision 为 187、change sequence
  为 187、项目数为 1，且目录中没有 `data/settings.json`。
- 在受控临时 SQLite fixture 中写入未知 schema migration `9999` 后，当前 CLI 启动以
  “unsupported schema version / refusing to modify”失败，验证旧程序不会修改高版本库。

## Editor 修复后的发布门复核（2026-08-09）

本轮在不读取 `data/settings.json` 的前提下，对包含结构化 Editor 修复契约的当前工作树重新执行：

```text
npm test             61 files passed, 228 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
npm run tauri build  passed (更新 ainovr.exe、MSI 与 NSIS)
```

构建后的 stdio MCP `tools/list` 返回 105 个领域工具，包含 `start_chapter_editor` 与
`commit_chapter`；未出现 `read_data_file`、`write_data_file`、任意路径文件工具或 SQL 工具。
对 `dist/`、`dist-cli/`、`dist-mcp/`、Tauri bundle、`data/exports/` 和 `data/restores/`
执行模式扫描，未发现 API Key、Bearer token 或明文 `api_key` 值；扫描没有读取
`data/settings.json`。

## 退出条件复核（2026-08-09）

- R7 隔离短篇已通过 `production_commit:r7-echo:chapter:01:v1:20260809` 正式接受 V1；该提交先经持久
  `chapter_production_commit` confirmation 批准，再原子写入正文、ChapterDelta、Canon、人物知识、
  ReaderState/Promise、OutlineDrift、Manifest、模型与审计。
- 桌面 UI 已由 Agent 执行只读窗口图形捕获并完成视觉验收；这不是用户人工验收。四个一级工作台入口及作品页核心投影均可见，无旧聊天/自由画布入口。
- 根 README 与 AGENTS 已按文档工作流重建，并已生成 Repomix 快照；这不构成 Git clean-clone 证据。
- 全量长文本、人工事实准确率抽查和云端模型对比按用户于 2026-08-09 的明确指示跳过。它们是明确范围豁免，不得称为已完成或已通过。
- 本轮文档更新后已重新运行完整交付门：

```text
npm test             61 files passed, 228 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
npm run tauri build  passed (MSI + NSIS)
```

  当前 MCP `tools/list` 返回 105 个领域工具，包含 `get_workspace_status`、
  `start_chapter_editor` 和 `commit_chapter`，且没有禁止的文件或 SQL 工具。对
  `dist/`、`dist-cli/`、`dist-mcp/`、Tauri bundle、`data/exports/` 与
  `data/restores/` 的值模式扫描为 0 命中；扫描没有读取 `data/settings.json`。
  `npx repomix` 已成功刷新根 `repomix-output.xml`，其内置安全检查未报告可疑文件。

上述历史结果仅证明当时的脏工作区可运行。其后已在 Git 提交 `ace8b29` / `4a6040d` 的独立
clean clone 中完成 `npm ci`、63/245 默认回归、typecheck、lint、前端/CLI/MCP 构建、sidecar
准备、Rust 测试、MCP initialize/tools-list，以及独立的 MSI 和 NSIS 打包；该证据满足 R8 的
可复现发布退出条件。

## 退役依赖复核（2026-08-09）

活动源码已经不再导入旧 React Flow / Zustand 路径，但此前 `package.json` 仍错误声明
`@xyflow/react` 与 `zustand` 为运行时依赖。为防止旧画布或业务 Store 被重新带回，先在
`legacy-runtime-retirement.test.ts` 加入红线断言；该断言在依赖仍存在时失败。随后移除两项依赖
并更新 lockfile，断言通过。

本次依赖清理后的完整门结果：

```text
npm test             63 files passed, 245 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
npm run tauri build  passed (MSI + NSIS)
```

活动依赖现在只保留 Tauri、`better-sqlite3`、React/React DOM 和通知组件；旧画布与 Zustand
实现仍仅在可恢复 archive 中作为历史对照，不是新产品运行时的一部分。
