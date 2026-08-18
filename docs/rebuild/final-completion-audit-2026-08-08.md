# 最终重构完成度审计（2026-08-08，2026-08-10 对抗性复核）

## 独立完成门

为避免把工程发布门误写成长篇产品验收，本文件同时维护四个不可互相替代的结论：

```text
engineering_release_ready = true
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false
```

`true` 的工程门只表示当前缩减范围的代码、发布物和治理边界有直接证据；它不覆盖
《龙族Ⅰ》全量验证、真实 Editor V2 成功样本、三宿主互操作或用户视觉验收。

当前实施口径以 [已裁决执行基线](decision-execution-baseline-2026-08-10.md) 为准；逐图 UI 判定见 [视觉证据账本](ui-visual-evidence-2026-08-10.md)。历史 R0–R8 计划与附件在冲突处仅作需求来源，不覆盖该基线。

本文件按“最终重构执行计划”的退出条件记录当前可验证证据。`通过`只代表已有直接证据，不能外推为整个阶段完成；`进行中`或`待确认`不能用于发布完成声明。

| 阶段 | 当前判断 | 已验证证据 | 仍缺的直接证据 |
|---|---|---|---|
| R0 基线 | 通过 | [r0-verified-baseline-2026-08-08.md](r0-verified-baseline-2026-08-08.md) 记录外部备份、恢复演练与 1,109/13 基线。 | 无新增要求。 |
| R1 SQLite/ObjectStore | 通过（回归覆盖） | Node `better-sqlite3` Application Service、对象库、迁移备份测试包含在默认回归；CLI/MCP 与桌面受信 Node sidecar 读取同一工作区；桌面 release 已从用户可写 Roaming `app_data_dir()` 启动并读取真实 fixture。 | 安装器安装后的独立用户帐户首次启动仍需发布机冒烟。 |
| R2 Application Service | 通过（回归覆盖） | CommandService、持久 confirmation、TaskRunner、CAS、`apply_batch` 及双宿主接管测试通过。 | 真实长任务接管需在 R7 样本补充。 |
| R3 MCP/CLI | 通过（运行冒烟） | 当前构建的 stdio MCP 已返回 `initialize` / `tools/list`；CLI 已执行本地创作、备份、恢复、导出，并可经同一受控服务保存 PipelineRevision、冻结 PipelineRun 与记录人类复核。 | 三个外部客户端的各自 GUI 配置应由安装者复核；通用配置文档已提供。 |
| R4 V2 分析 | 部分完成 | 参考导入、SourceSpan、Coverage、事实、线程、反证、Dossier、机制与去来源化投影均有应用/持久层测试；桌面端已可受控提交 ThreadGraph、AnalysisBrief、Conclusion、Falsification，冻结 Dossier 并提出 MechanismCandidate，且可查看受限原文摘录。 | 真实 Provider 的端到端分析样本仍属于 R7 验证范围，不能仅以结构化手工提交误报为模型能力已验证。 |
| R5 原创生产 | 部分完成 | 多项目、跨章连续性、Manifest 去来源化、上下文预算选择和角色路由已有回归覆盖；桌面 UI 通过打包 Node sidecar 调用同一受控领域入口；桌面 release 数据目录不再依赖 Program Files 写权限。 | 完整长篇人工验证仍未交付；桌面端不提供 API Key 录入，Provider Secret 仍须由受控运行时环境提供。 |
| R6 UI | 部分完成 | `App.tsx` 仅入口 `AinovrWorkbench`，通过受限桌面 MCP 领域通道读取/写入；四个一级工作台、证据摘录与分析链投影、各分析阶段结构化提交、PipelineRevision 编辑/冻结/受支持步骤执行/人工复核，以及 ProjectIntent→ProductionCommit 的原创生产操作面均已交付。作品页固定生产链展示 revision、executionRef、模型、输出 hash、stale 与阻塞原因；真实 Tauri + Roaming SQLite fixture 的四页 accessibility tree 已验证有数据结构与控件。 | Windows Graphics Capture 仍以 `0x80004002` 失败；UIA 不能证明排版、遮挡、颜色和截断。细粒度编辑仍有原始 JSON/ID 操作面，因此位图视觉与易用性只可判部分完成。 |
| R7 真实验证 | 范围豁免（非原计划通过） | [r7-dstdyj-short-story-validation-2026-08-09.md](r7-dstdyj-short-story-validation-2026-08-09.md) 记录隔离短篇的受确认导入、V2 分析、去来源化机制、Writer、三 Reader、Reviewer 和 `qwen3.5:9b` 本地真实任务。Editor V2 在初次运行与三次恢复重试后仍 fail closed；用户明确选择 V1 后，`production_commit:r7-echo:chapter:01:v1:20260809` 原子接受第 1 章并写入 Canon、人物知识、ReaderState/Promise、OutlineDrift 和生产游标。 | 全量《龙族Ⅰ》Coverage、人工事实准确率抽查和云端模型对比均按用户于 2026-08-09 的明确指示跳过；它们是范围豁免，不能误报为已验证通过。如要恢复原计划退出条件，须显式恢复/重跑这些范围。 |
| R8 发布 | 通过（clean clone + 当前工作树 release 冒烟） | Git 提交 `ace8b29` / `4a6040d` 已纳入新系统、迁移、归档、测试与 Windows clean-clone CI；历史 clean clone 证据为 63/245。当前工作树修复了打包资源层级与 Node verbatim path 两个 release P0，复核为 64/269、6 项 Rust 测试并重新生成 exe/MSI/NSIS；最新 release 主进程与打包 sidecar 均已启动。 | 当前工作树不是新的 clean-clone 或安装器安装证据；真实长文本、人工事实准确率抽查和云端模型对比均是范围豁免，不能误报为额外发布验证。 |

## 本轮发布门命令结果

```text
npm test             64 files passed, 269 passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
cargo test           6 passed
MCP tools/list       protocol 2025-06-18, 114 tools, prohibited generic tools 0
npm run tauri build  passed（当前工作树，生成 exe/MSI/NSIS）
```

文本发布物与最新项目导出均执行过 Secret 模式扫描，未发现 API Key、`sk-` 令牌或 `settings.json` 内容。

## 完成声明门槛

当前 Git 提交和独立 clean clone 证明了工程发布门和已批准缩减范围；当前工作树的 64/269 回归、6 项 Rust 测试、发布构建和 release 进程冒烟证明本轮改动可构建并能启动，但不是新的 clean-clone 或安装器证据。全量长文本、人工事实准确率抽查、云端模型对比、真实 Editor V2 成功样本、三宿主实际互操作和位图级 UI 逐状态人工验收仍属于缺失或范围豁免，不得写成“通过”。

## 2026-08-10 第九轮复核更新

本次工作树继续关闭 Provider 调用的两个 Secret 传输边界：远程 Provider 只能使用 HTTPS、本地 `ollama_native` 只能使用回环 HTTP，且云端请求强制 `redirect: "error"`。这些规则由 CommandService 和 runtime 回归测试覆盖，不能由 UI/CLI/MCP 绕过。

直接复跑结果已更新为：默认 `npm test` 64 files / 274 tests 通过；typecheck、lint、前端、CLI、MCP、6 项 Rust 测试通过；关闭运行中的旧 release 对 sidecar 文件的 Windows 锁定后，`npm run tauri build` 成功重新生成 MSI 和 NSIS。运行时也会拒绝旧 SQLite 遗留的明文远程 Provider，且不会发起网络请求。该增量验证不改变本文件顶部的四个完成门，也不补足 longform、三宿主安装态或位图级 UI 的缺失证据。

后续第十轮又关闭本地 Responses 与远程 Ollama 原生协议的不可执行组合：保存、ModelResolver 和 runtime caller 均拒绝，设置页显示同一约束。全量回归为 `64 files / 276 tests`，typecheck、lint、前端、CLI、MCP 构建与 Tauri MSI/NSIS 重新打包均通过；四个完成门不变。

## 2026-08-10 第十二轮复核更新

本轮将 Pipeline 的“线性复核清单”缺陷收束为可验证的依赖门：`dependsOn`、循环检测、前置完成检查和 `human_review` 自动执行拒绝均已实现；批量 FactExtractor 的父任务在入队时冻结无 Secret RouteSnapshot，PipelineRun 也将可执行角色的 endpoint/model/protocol/有效预算冻结到不可变快照。当前复跑结果为：

```text
npm test             64 files / 278 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
cargo test           6 passed
npm run tauri build  passed; MSI and NSIS regenerated
```

这只关闭了工程层的顺序与路由可复现性门，不改变四个完成字段：完整《龙族Ⅰ》验证、真实 Editor V2 成功样本、三宿主独立互操作以及全部真实数据态位图视觉验收仍未完成。新增依赖门后的旧 Pipeline 截图也不能作为当前 UI 语义的有效证据，见 [UI 视觉证据账本](ui-visual-evidence-2026-08-10.md)。

## 2026-08-10 第十三轮对抗性复核更新

进一步复核发现：第十二轮的依赖检查若只停留在服务层预读，则直接 `CommandService` 调用或检查后的并发交错仍可能越过依赖。因此 `complete_pipeline_run_step` 的 SQLite 事务已增加基于冻结 RunSnapshot 的 `dependsOn` 完成态条件；该条件不满足时提交 fail closed。MCP `save_pipeline_revision` 也已公开 `execution` 与 `dependsOn` schema，避免外部 Agent 看得到但无法声明管线依赖。

最新全量验证为 `npm test` 64 files / 279 tests 通过，typecheck、lint、前端、CLI、MCP、6 项 Rust 测试、Windows MSI/NSIS 构建和 `git diff --check` 均通过。该增量只提高工程顺序门的可信度；本文件顶部的四个完成字段、R7 长篇验证缺口与位图 UI 验收缺口均不改变。
