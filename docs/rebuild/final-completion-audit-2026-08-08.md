# 最终重构完成度审计（2026-08-08）

本文件按“最终重构执行计划”的退出条件记录当前可验证证据。`通过`只代表已有直接证据，不能外推为整个阶段完成；`进行中`或`待确认`不能用于发布完成声明。

| 阶段 | 当前判断 | 已验证证据 | 仍缺的直接证据 |
|---|---|---|---|
| R0 基线 | 通过 | [r0-verified-baseline-2026-08-08.md](r0-verified-baseline-2026-08-08.md) 记录外部备份、恢复演练与 1,109/13 基线。 | 无新增要求。 |
| R1 SQLite/ObjectStore | 通过（回归覆盖） | Node `better-sqlite3` Application Service、对象库、迁移备份测试包含在默认回归；CLI/MCP 与桌面受信 Node sidecar 读取同一工作区。 | 不将旧 JSON 代码仍留在 `src/` 误报为已清理。 |
| R2 Application Service | 通过（回归覆盖） | CommandService、持久 confirmation、TaskRunner、CAS、`apply_batch` 及双宿主接管测试通过。 | 真实长任务接管需在 R7 样本补充。 |
| R3 MCP/CLI | 通过（运行冒烟） | 当前构建的 stdio MCP 已返回 `initialize` / `tools/list`；CLI 已执行本地创作、备份、恢复、导出，并可经同一受控服务保存 PipelineRevision、冻结 PipelineRun 与记录人类复核。 | 三个外部客户端的各自 GUI 配置应由安装者复核；通用配置文档已提供。 |
| R4 V2 分析 | 部分完成 | 参考导入、SourceSpan、Coverage、事实、线程、反证、Dossier、机制与去来源化投影均有应用/持久层测试；桌面端已可受控提交 ThreadGraph、AnalysisBrief、Conclusion、Falsification，冻结 Dossier 并提出 MechanismCandidate，且可查看受限原文摘录。 | 真实 Provider 的端到端分析样本仍属于 R7 验证范围，不能仅以结构化手工提交误报为模型能力已验证。 |
| R5 原创生产 | 部分完成 | 多项目、跨章连续性、Manifest 去来源化、上下文预算选择和角色路由已有回归覆盖；桌面 UI 通过打包 Node sidecar 调用同一受控领域入口。 | 完整长篇人工验证仍未交付；桌面端不提供 API Key 录入，Provider Secret 仍须由受控运行时环境提供。 |
| R6 UI | 通过 | `App.tsx` 仅入口 `AinovrWorkbench`，通过受限桌面 MCP 领域通道读取/写入；四个一级工作台、证据摘录与分析链投影、各分析阶段结构化提交、PipelineRevision 编辑/冻结/受支持步骤执行/人工复核，以及 ProjectIntent→ProductionCommit 的原创生产操作面均已交付。 | 完整长篇人工可用性验证仍属于 R7 的范围豁免，不应由 UI 构建结果替代。 |
| R7 真实验证 | 通过（按用户指示范围豁免） | [r7-dstdyj-short-story-validation-2026-08-09.md](r7-dstdyj-short-story-validation-2026-08-09.md) 记录隔离短篇的受确认导入、V2 分析、去来源化机制、Writer、三 Reader、Reviewer 和 `qwen3.5:9b` 本地真实任务。Editor V2 在初次运行与三次恢复重试后仍 fail closed；用户明确选择 V1 后，`production_commit:r7-echo:chapter:01:v1:20260809` 原子接受第 1 章并写入 Canon、人物知识、ReaderState/Promise、OutlineDrift 和生产游标。 | 全量《龙族Ⅰ》Coverage、人工事实准确率抽查和云端模型对比均按用户于 2026-08-09 的明确指示跳过；它们是范围豁免，不能误报为已验证通过。如要恢复原计划退出条件，须显式恢复/重跑这些范围。 |
| R8 发布 | 通过（clean clone） | Git 提交 `ace8b29` / `4a6040d` 已纳入新系统、迁移、归档、测试与 Windows clean-clone CI；从该提交独立 clone 后完成 `npm ci`、63/245 默认回归、typecheck、lint、前端/CLI/MCP 构建、sidecar 准备、Rust 测试、MCP 协商与 MSI/NSIS 构建。 | 真实长文本、人工事实准确率抽查与云端模型对比均是明确范围豁免，不能误报为额外发布验证。 |

## 本轮发布门命令结果

```text
npm test             63 files passed, 245 passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
npx tauri build --bundles nsis  clean clone 通过
npx tauri build --bundles msi   clean clone 通过
```

文本发布物与最新项目导出均执行过 Secret 模式扫描，未发现 API Key、`sk-` 令牌或 `settings.json` 内容。

## 完成声明门槛

最终重构计划在当前已批准范围内完成：当前 Git 提交和独立 clean clone 均有直接验证证据。全量长文本、人工事实准确率抽查与云端模型对比属于范围豁免；它们没有被执行，也不得写成“通过”。
