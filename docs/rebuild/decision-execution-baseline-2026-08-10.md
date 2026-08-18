# Ainovr 已裁决执行基线（2026-08-10）

## 目的

本文是当前重构实施与验收口径的单一基线。它不抹除用户附件“最终重构执行计划”的需求来源价值，但当附件与 `AGENTS.md`、ADR 或当前实现冲突时，以本基线和 ADR 为准。这样不会把已否决的旧架构重新带回运行时。

## 产品与架构（已裁决）

- 产品是外部 Agent 主导的小说分析与原创生产执行环境；Ainovr 保存事实、证据、版本、任务和审计，并提供可选可视化工作台。
- 一级导航固定为“作品 / 参考 / 待处理 / 设置”；不恢复内置聊天或自由拖拽画布作为主入口。
- SQLite/Application Service 是唯一业务真相。UI、CLI、stdio MCP 与桌面 sidecar 只调用受控领域命令、查询与任务服务。
- 桌面端 Rust 仅负责打包 Node MCP sidecar 生命周期与固定工作区边界；Node `better-sqlite3` 承担 SQLite。不存在 Rust `rusqlite` 双宿主 SQL 网关。
- 正文、原文、完整 Prompt、上下文和模型原始输出进入 ObjectStore；SQLite 只保存受控引用和结构化索引。
- Secret 只从运行时环境 SecretStore 获取，不使用、不读取也不重新引入 `data/settings.json`。
- 旧业务实现只在 `archive/` 中作恢复与对照；不作为活动真相或兼容路径。当前没有活动 `analysis_v1_legacy` 运行入口。

## 已完成的工程门

以下范围可称为完成，但仅限工程与批准缩减范围：SQLite/ObjectStore/Application Service、领域 MCP/CLI、Tauri sidecar、持久确认、CAS/幂等/TaskRunner、V2 分析主链、原创规划与章节生产链、四工作台、Windows 发布构建。

当前 Provider 安全边界为：远程 Provider 仅 HTTPS、回环本地模型仅 HTTP、云端请求拒绝重定向、更新既有 Provider 需要持久确认。Writer 只能读取已采纳的去来源化机制投影。
PipelineRun 是版本化的依赖有向图投影：步骤显式保存 `dependsOn`，可执行节点不能越过未完成前置；创建运行时冻结无 Secret RouteSnapshot，执行与恢复只使用该快照。

## 未完成或未获直接验证的原计划门

以下项目不能用“工程通过”替代：

1. 《龙族Ⅰ》完整可恢复分析、全量 Coverage、人工准确性抽查、吞吐/成本和云端比较；此前任务在部分单元后按用户指示取消。
2. 真实模型成功完成 Writer V1 → Reviewer → Editor V2 的样本；现有短篇最终人工接受 V1，Editor V2 fail closed。
3. Codex、Claude Code、OpenCode 三个独立安装态宿主的直接互操作证据。
4. 作品正文的“选中文本直接问诊”原条目；当前以三 Reader + Reviewer 的受控诊断链替代，属于需求收束而非原条目完成。
5. 位图级 UI 的所有真实数据态和细粒度编辑交互验收。

## 完成门

```text
engineering_release_ready = true
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false
```

这四项必须分别报告。R7 的范围豁免、需求收束或自动化测试，均不能将后两项改为 `true`。

## 权威关系

1. 用户当前明确指令；
2. `AGENTS.md` 的不变量与安全边界；
3. [ADR 0001](../adr/0001-final-rebuild-architecture.md)；
4. 本执行基线；
5. [完成度审计](final-completion-audit-2026-08-08.md) 与 [对抗性重审](adversarial-re-review-2026-08-10.md) 的带证据状态；
6. 早期附件、R0–R8 历史计划和 archive。

任何未来变更先更新本基线与相应 ADR，再改变代码或完成声明。

## 2026-08-17 下一阶段裁决：人类可读写作方法验证切片

用户已逐项确认下一阶段不恢复 R0–R8，也不先做长篇、通用 Pipeline、Editor V2 或四工作台整体重设计。唯一主目标是交付一条作者/编辑可读的单章单卡垂直切片：

```text
参考证据 → 写作方法卡 → 全局采纳 → 本章采用记录
→ Writer 草稿 → Reviewer 目标效果判断 → 人类处置
→ 持久确认后的 ProductionCommit
```

本阶段只改造“待处理”和“作品”；“参考”只提供证据定位，“设置”保持现状。UI 不直接调用新模型，验收基于 `data/r7-dstdyj-20260809` 的隔离 replay fixture，原工作区保持只读。一般章节允许零方法卡；单章结果不自动改变全局方法生命周期。

权威需求和实施顺序分别见：

- [人类可读写作方法验证垂直切片需求](human-readable-writing-method-slice-requirements-2026-08-17.md)
- [人类可读写作方法验证垂直切片实施计划](human-readable-writing-method-slice-plan-2026-08-17.md)

本裁决不改变完成字段：`engineering_release_ready = true`、`approved_reduced_scope_complete = true`、`original_plan_complete = false`、`longform_product_validated = false`。
