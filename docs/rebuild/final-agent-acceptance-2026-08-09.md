# 最终 Agent 自主验收（2026-08-09）

## 结论

**未通过最终重构/发布验收：当前工作区已具备可回归的受控分析与原创基础设施，但尚未
达到“持续生产多部、跨章连续长篇小说”的完整产品闭环。** 本文件只记录 Agent 可直接
复核的局部证据；它不是用户人工验收，也不把范围豁免、脏工作区构建或局部回归写成
最终通过。

本验收接受的产品边界是当前已接受的最终架构：外部 Agent 通过 CLI 或 stdio MCP 编排，
Ainovr 负责 SQLite/ObjectStore、版本、证据、确认、任务恢复、审计和四工作台投影。

## 本次独立复核证据

| 验收项 | 本次结果 |
|---|---|
| 默认回归 | `npm test`：64 个测试文件、269 项测试全部通过；真实 API 测试仍被默认排除。 |
| 静态与构建门 | `npm run typecheck`、`npm run lint`、`npm run build`、`npm run build:cli`、`npm run build:mcp` 全部通过。 |
| 桌面发布物 | 修复打包资源层级与 Node Windows verbatim path 后，`npm run tauri build` 成功生成 `ainovr.exe`、MSI 与 NSIS；6 项 Rust 测试通过。最新 release 主进程与内置 sidecar 均已启动，仅保留既有的 `com.ainovr.app` 命名建议。 |
| MCP 边界 | 当前构建 companion 成功协商 `protocolVersion=2025-06-18`；`tools/list` 返回 114 个领域工具，包含 `get_workspace_status`、`start_chapter_editor`、`commit_chapter`、`get_accepted_chapter`，六个禁止的通用文件/SQL 工具为 0。 |

> **2026-08-10 当前工作树更新。** 上表中的测试计数是本验收写入时的快照。当前工作树已在后续安全修复后复跑为 `64 files / 274 tests`，typecheck、lint、前端/CLI/MCP 构建、6 项 Rust 测试与 MSI/NSIS 打包均通过。该增量不改变本文件“原计划最终产品验收未通过”的结论。当前实施约束见 [已裁决执行基线](decision-execution-baseline-2026-08-10.md)，逐图证据见 [UI 视觉证据账本](ui-visual-evidence-2026-08-10.md)。
| 发布物 Secret 检查 | 对 `dist/`、`dist-cli/`、`dist-mcp/`、Tauri bundle、`data/exports/`、`data/restores/` 的值模式检查为 0 命中；检查明确排除且未读取 `data/settings.json`。 |
| 隔离 R7 工作区 | 当前构建 CLI 可读取 `data/r7-dstdyj-20260809`：workspace revision 与 change sequence 均为 93，项目数为 1。`project:r7-echo-station` 有 1 章已接受正文、正式提交、2 条 Canon、1 条 ReaderPromise，生产游标的下一章 ordinal 为 2。 |
| 桌面视觉 | 真实 Tauri + Roaming SQLite fixture 的 accessibility tree 已核对作品生产链、参考证据/`no_pattern`、待确认/任务/Coverage/规划审核，以及 Provider/Pipeline 设置；它证明结构、状态和控件存在。Windows Graphics Capture 仍以 `0x80004002` 失败，没有合格位图，因此排版、遮挡、颜色、截断与细粒度操作体验仍非完整视觉验收。 |

R7 的真实本地模型闭环、确认与原子 `ProductionCommit` 的详细领域证据见
[短篇闭环验证](r7-dstdyj-short-story-validation-2026-08-09.md)，发布与恢复验证见
[R8 发布验证](r8-release-validation-2026-08-08.md)。

## 原计划术语与当前受控实现的映射

原计划中的少数工具名不是当前 MCP 的兼容性承诺。以下按可观察行为复核，而不按旧名称
误判为缺失：

| 原计划表达 | 当前实现与验收判断 |
|---|---|
| `diagnose_text_span` | 由三个隔离 Reader Manifest 和独立 Reviewer 完成诊断；每个问题必须引用当前草稿的 UTF-8 精确区间。它比自由文本“问诊”更收束，且没有让未经验证的诊断直接修改正文的路径。 |
| `revise_text_span` | 由 `create_chapter_editor_draft` / `start_chapter_editor` 实现。只能选择已验证 Reviewer 问题，Editor 只能替换其精确区间，不能整章重写或自动接受。 |
| Writer → Reviewer → Editor（最多三版） | Writer V1、三 Reader、独立 Reviewer、定向 Editor V2 和可选 V3 都有单独的冻结 Manifest、父版本和任务审计；第三版没有自动覆盖人工选择版本的入口。 |
| PipelineRevision / RunSnapshot | Pipeline 可版本化保存、冻结为 RunSnapshot、以新 runId 重跑，并只能由人类复核完成。执行器仅有显式强类型映射：FactExtractor 批处理、Writer、Reader、Reviewer 与定向 Editor；不开放任意画布、SQL、文件、代码节点或将 JSON 反序列化为 CommandEnvelope。 |

Pipeline 是受控线性编辑器，不是通用工作流执行器。只有上述逐项审查的映射允许执行；
未来若增加步骤，必须为该步骤另立强类型输入、TDD 与安全验收，不能用通用
`CommandEnvelope`、SQL 或任意 JSON 复用本入口。

## 范围豁免与非结论

- 全量《龙族Ⅰ》Coverage/恢复、人工事实准确率抽查和云端模型对比，是用户明确跳过的范围；
  本验收不把它们称为通过，也不把任一本地模型称为“资格认证通过”。
- R7 中 Writer V1 的正式接受来自先前明确的章节提交授权；本文件的桌面验收完全由
  Agent 完成，不能改写为用户已做视觉或功能验收。
- 本次验收不读取、打印、复制或扫描 `data/settings.json`。
- `src-tauri` 仅向 WebView 暴露 `desktop_mcp_request`，并打包 Node MCP sidecar；它不再
  暴露 SQL/Object RPC。该边界有 source redline、Rust 输入校验和发布资源烟测。
- 新系统主体已在 `ace8b29` / `4a6040d` 中形成受审查 Git 提交；独立 clean clone 已完成
  默认回归、构建、Rust 测试、MCP 协商及 MSI/NSIS 打包，R8 发布复现门通过。
