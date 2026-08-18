# R7：本地原创生产与结构化修复验证（2026-08-08）

状态：进行中。本文记录已执行的本地模型探索性验证，不宣称模型已通过正式资格认证，也不把候选正文当作已接受版本。

## 已验证的原创生产链

原创项目 `project_local_original_20260808` 的第一、二章此前已完成受控生产并拥有正式 `ProductionCommit`。本轮在既有已批准的大纲范围内建立第三章的 `ChapterContract`、`CreativeRecipe` 与六层 Writer `ContextManifest`，并通过回环 Ollama 验证：

| 角色 | 模型 | 真实结果 |
|---|---|---|
| Writer V1 | `qwen3.5:9b` | 成功产生完整、可审阅的候选草稿；任务、Manifest 与对象引用均持久化。 |
| 三类 Reader | `qwen3:8b` | 针对同一冻结正文分别完成沉浸型、低耐心、逻辑敏感反馈；各自使用独立 Manifest，`conversationHistory` 为空。 |
| 独立 Reviewer | `qwen3.5:9b` | 首次输出中有一次成功写入可定位的结构化报告；每项引文经本地 UTF-8 区间契约验证。 |
| Editor V2/V3 | `qwen3.5:9b` | 仅依据选定 Reviewer 问题生成定向候选；没有写入 Canon、ReaderState 或接受章节。 |

所有模型请求都使用 `http://127.0.0.1:11434/v1` 的本机 Ollama，不读取、打印或传递 API Key。Writer 的冻结 Manifest 不含参考作品名称、原文、人物、剧情或 provenance。

## 结构化输出修复规则

真实 Reviewer 运行曾因小模型输出的类别、严重度或逐字引文不合格而被本地严格校验拒绝。该行为没有提交错误报告；失败任务和其 checkpoint 均保留审计。

随后补齐并测试了最终计划要求的规则：

1. 仅 `structured_json` 任务在第一次本地校验失败时允许一次修复请求；Writer 的自然语言正文不自动重写。
2. 修复请求保留原冻结 Prompt，并附带校验诊断与失败输出；它明确要求无法逐字、唯一引用输入时删除该问题或返回空数组，禁止释义引文。
3. 第二次仍无效时任务 fail closed，不提交领域报告或通用草稿。
4. `LocalCreationService` 单测覆盖首次失败后成功、第二次失败、Writer 不重试；`ChapterReviewer` 集成测试覆盖修复 Prompt 仍携带冻结任务 Manifest。
5. 新构建 CLI 的真实本机 Reviewer 成功产出一项带唯一正文引文的 `continuity/major` 问题。校验器确认其 UTF-8 半开区间可回到候选正文。

## CLI 本地创作冒烟（2026-08-08）

在当前构建产物上通过领域 CLI 真实调用本机 Ollama，未经过 UI、未读取参考作品：

- 项目：`project_local_original_20260808`（《潮汐钟楼》）
- 任务：`task_local_cli_smoke_20260808`
- 草稿：`draft_cli_local_smoke_20260808`
- 模型：`qwen3.5:9b`
- 地址：`http://127.0.0.1:11434/v1`
- 结果：Task `succeeded`，正文先写入 ObjectStore，再由 `get-document` 读取对象引用与正文；`finishReason=stop`。

这证明关闭 UI 时，CLI 仍可独立完成一次本地原创草稿调用并持久化结果。

## 本地 Writer 候选长度对照（2026-08-08）

为避免把模型名称或单次观感当成路由结论，本轮在独立工作区
`data/local-creation-live-20260808` 使用**同一份无参考作品的原创开场任务**进行
两次 CLI 实际调用。两个结果都只是 `local_creation_draft`，均未创建
`ChapterContract`、Canon 或 `ProductionCommit`：

| 模型 | Task | 草稿 | 任务结果 | 正文字数 | 可核验结论 |
|---|---|---|---|---:|---|
| `qwen3.5:9b` | `task_local_creation_live_20260808` | `draft_local_creation_live_20260808` | `succeeded` | 1,827 | 正常保存为可审阅草稿；字数超出提示中的 1,200–1,600 范围，不能据此推断其满足章节契约。 |
| `qwen3:8b` | `task_local_creation_qwen3_8b_20260808` | `draft_local_creation_qwen3_8b_20260808` | `succeeded` | 962 | 以完整句尾结束，但低于提示的最小 1,200 字；若这是受 ChapterContract 约束的 Writer 输出，应 fail closed 并等待显式 retry。 |

两次调用均使用回环 `http://localhost:11434/v1`，不读取或传递 API Key，且提示不含参考
作品身份或内容。该样本只补充本地创作任务的长度遵循证据；它不是正式模型资格认证，也不能
替代 R7 对结构化 FactExtractor、人工事实准确性和跨单元线程的验证。按用户于 2026-08-09 的明确指示，当前不执行云端模型对比；这不是云端能力已验证的声明。

## 未完成且不可误报的部分

## 本轮再次调用本地模型（2026-08-09）

在隔离工作区 `data/local-creation-live-20260808` 通过领域 CLI 新增一份原创草稿，未读取或覆盖既有草稿：

- 项目：`project_local_creation_live_20260808`
- 任务：`task_local_creation_live_20260809`
- 草稿：`draft_local_creation_live_20260809`
- 模型：`qwen3.5:9b`
- 地址：`http://127.0.0.1:11434/v1`（本机 Ollama）
- 结果：Task `succeeded`；正文对象已写入 ObjectStore，文档 revision 为 1，模型与 task 索引已持久化。

本次提示为独立原创设定（海边小城、零点电台与未来求救声），不含参考作品身份、原文、人物、剧情或 provenance；正文未自动接受为正式章节，仍须经过 ChapterContract、Reviewer/Editor 和人工 ProductionCommit。

- 第三章 V3 仍是候选。它与已批准的 ChapterContract 出口状态存在差异，因此没有发起或批准 `ProductionCommit`。
- 已达到单章三版本上限；不得用自动 V4 绕过该限制，也不得为匹配模型输出而反向改写已批准契约。
- 仍需用户选择接受的版本方向或明确授权人工定稿后，才可原子提交 ChapterDelta、Canon、人物知识、Reader State、ReaderPromise 与 Outline Drift。
- R7 的短篇参考作品闭环、第一册长文本恢复完成、本地模型验证、人工事实抽查和可决策报告仍未完成。云端模型对比按用户指示跳过，不得将其误报为已完成。
