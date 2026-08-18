# R8：遗留源码消费者审计（2026-08-08）

状态：活动源码清理已通过；在 `ace8b29` / `4a6040d` 的独立 clean clone 验证后，R8 最终发布门已通过。真实长文本阶段属于已记录的范围豁免，不作为本审计的通过声明。

## 审计方法和边界

以三个当前产品入口为根，静态遍历 TypeScript 的 `@/`、相对静态 import 和动态 `import()`：

- `src/main.tsx`（桌面 UI）；
- `src/cli/index.ts`（薄 CLI）；
- `src/mcp/server.ts`（stdio MCP）。

测试目录不作为产品运行时消费者；第三方包、字符串反射和未声明的动态路径不在此图内。因此删除前仍须对候选目录作逐项编译和测试验证。

## 当前结果

| 指标 | 结果 |
|---|---:|
| 非测试 `src` TypeScript 文件 | 260 |
| 由三入口可达 | 69 |
| 当前不可达 | 191 |
| 不可达集合中属于旧 Assistant / JSON Store / 画布 / Zustand / V1 生产链信号 | 128 |

当前桌面入口只渲染 `components/workbench/AinovrWorkbench.tsx`。该工作台通过 `WorkspaceApplicationService` 的 QueryService / CommandService 投影工作，不导入旧画布、Assistant 或 Zustand 业务 Store。CLI 与 MCP 均由新 Application Service、TaskRunner、SQLite 和 ObjectStore 运行。

## 清理前依赖（有直接证据）

下列旧模块在当前产品入口图中不可达，但仍被测试或其他不可达的旧视图直接 import：

- `src/engine/assistant/assistant-tools.ts` 仍包含 `read_data_file`、`write_data_file`，其旧单元测试仍验证这些工具；
- `src/lib/file-json-store.ts` 与 `src/lib/domain/*`、`src/lib/production/*` 仍被旧 V1 测试和旧视图使用；
- `src/store/*`、`components/canvas/*`、`components/workspace/*`、`components/analysis/*`、`components/works/*` 等组成旧 React Flow / Zustand 路径；
- `src/runtime/runtime-wiring.ts`、`src/runtime/tauri-blueprint-store.ts` 等仍组成旧 JSON 运行时。

因此，直接删除这些文件会让默认测试和仍保留的旧视图在没有可恢复归档边界的情况下失败，违反当前脏工作树视为用户资产的约束。

## 已执行的可恢复归档

1. 当时曾将 190 个不可达的非测试 TypeScript 源码文件和 190 个仅依赖这些模块的旧测试完整移动到 `archive/legacy-2026-08/src/`；本次公开基线不再携带该 archive 或旧安装器，回溯资产由本地封存 bundle 保留。
2. 历史归档记录了三个产品入口、归档条件与恢复边界；公开树不再链接到归档内容。
3. 新增 `src/__tests__/rebuild/legacy-runtime-retirement.test.ts`，先验证旧 Assistant / JSON / Zustand 入口仍存在（red），再在归档后通过（green）。空目录不会被视作活动源码。
4. 清理后 `rg` 验证活动 `src` 不含 `read_data_file`、`write_data_file`、`createFileJsonStore` 或旧 Zustand 业务控制面。
5. 清理后验证结果：`npm test` 为 61 files / 226 tests 通过；typecheck、lint、前端、CLI、MCP 与 Tauri 构建通过；构建后的 MCP 仅暴露领域工具，不暴露文件或 SQL 工具；发布物和最终项目导出均未命中 API Key 值模式。

默认测试数量下降是预期的：已归档的 190 个测试只覆盖被退役的 V1 代码，不再被活动产品测试门运行。新 SQLite/Application Service、MCP、CLI、ObjectStore、TaskRunner、分析、生产与工作台测试仍在默认测试集合中。

本审计没有读取 `data/settings.json`、SQLite 或原文对象，也没有删除、覆盖或迁移业务数据。
