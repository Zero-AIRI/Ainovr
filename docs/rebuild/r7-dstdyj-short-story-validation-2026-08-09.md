# R7：短篇参考分析与原创候选闭环验证（2026-08-09）

状态：**通过（按用户指示豁免全量长文本与云端模型比较）**。已完成一次隔离短篇的参考分析、去来源化机制采纳、原创候选生产闭环和正式章节接受。本文只记录领域 ID、任务状态和安全边界，不复制参考原文、Prompt、完整正文、人物或剧情。

## 隔离范围与导入

- 独立工作区：`data/r7-dstdyj-20260809`。
- 参考导入任务：`task:r7-dstdyj-import:20260809`，状态 `succeeded`。
- 该导入先创建持久 confirmation `confirmation:cmd:r7-dstdyj-import:20260809`，随后以 `human_via_agent` 批准并恢复；没有通过 SQL、ObjectStore 或通用文件工具读取原文。
- 全量《龙族Ⅰ》任务仍保持用户指示的跳过/取消状态，未被恢复。

## V2 分析与机制边界

| 领域项目 | 已验证结果 |
|---|---|
| `analysis:r7-dstdyj` | 三个计算单元、101 个 `SourceSpan`；FactLedger 最终有 47 条事实。首轮两个单元的无效结构化输出仍作为失败 Coverage 审计保留，重配后成功完成。 |
| 阅读/研究 | Structural Reading Map、三个 Thread、AnalysisBrief 的三个研究问题、三个 ResearchConclusion 和三个 `bounded` 独立反证均已提交。 |
| `dossier:analysis:r7-dstdyj:1` | 已冻结，索引 47 条事实、3 个 Thread、3 个结论和 3 个反证。 |
| `mechanism:concrete-desire-recontext:v1` | 已经持久 confirmation 采纳；它是 local 机制，带反例和边界。生产侧投影只含去来源化的 `when / operations / avoid`，没有参考标题、人物、剧情、原文、span 或 provenance。 |

## 原创生产候选

原创项目为 `project:r7-echo-station`，第一章为 `chapter:echo:01`。其 ProjectIntent、三个 StoryConcept、选择记录、StoryContract、StorySystem、Book/Stage/Chapter 规划和 CreativeRecipe 均已保存；Writer 读取的 `manifest:echo:01:v1` 是六层冻结 ContextManifest，验证中未含参考侧身份、内容、证据或 provenance。

| 角色 | 领域任务 / 文档 | 本地模型 | 结果 |
|---|---|---|---|
| Writer V1 | `task:echo:chapter01:writer-v1:20260809` / `production:chapter_draft:chapter:echo:01:v1` | `qwen3.5:9b` | `succeeded`；仅生成可审阅候选。 |
| 三类 Reader | `immersive`、`low-patience`、`logic-sensitive` 三个独立任务/反馈文档 | `qwen3.5:9b` | 均为 `succeeded`；引用范围经 UTF-8 契约验证。 |
| Reviewer | `task:echo:chapter01:reviewer:20260809` / `review:echo:01:v1` | `qwen3.5:9b` | `succeeded`；报告有两项 minor、可定位的表达/连续性问题。 |
| Editor V2 | `task:echo:chapter01:editor-v2:20260809` | `qwen3.5:9b` | 已执行初次运行与三次显式恢复重试（最终 `retryCount: 3`），每次都只允许一次结构化修复，且均因“replacement 必须是非空字符串”失败关闭；未生成 V2 文档。 |

所有上述本地调用只使用 `http://127.0.0.1:11434/v1`。没有读取、打印或传递 API Key。

为支持人类选择候选版本，领域投影还确认：V1 为 960 个字符；沉浸型与低耐心
Reader 均返回 0 项问题，逻辑敏感 Reader 返回 1 项问题；独立 Reviewer 最终汇总为
2 项可定位的 minor 问题。这里不复制正文、引用或参考侧内容。该统计不替代人类接受，
也不把候选正文称为正式章节。

## Editor 失败后的实现核验

真实失败暴露出原通用修复提示对不同 JSON 契约不够精确：它曾把“可返回空数组”的分析任务退化说明泛化到 Editor。已按测试驱动方式修复：

1. 在 `local-creation-service` 测试中先加入失败断言，要求修复请求不得删除必填字段、置空必填字符串或清空必填数组；并要求 `chapter_editor_patch` 明确保留一个非空 `replacement`。
2. 通用结构化修复提示现在遵从原任务的字段、类型与基数；`chapter_editor_patch` 额外注入只允许一个指定问题、一个非空替换文本、禁止整章改写的专用契约。
3. 定向测试通过，随后默认回归为 61 个测试文件、228 项测试全部通过；类型检查、Lint、前端/CLI/MCP 构建与 Tauri MSI/NSIS 发布构建均通过。

这项修复没有降低校验门槛。使用已冻结的实际 V2 任务再次重试后，本地模型仍未给出合法替换，因此系统继续拒绝提交；不能把代码修复误报为该模型任务已经成功。

## 正式接受、原子提交与视觉验收

用户于 2026-08-09 明确指示“接受v1”。因此以 `human_via_agent` 创建并批准持久确认
`confirmation:cmd:r7-echo-accept-v1:20260809`（状态 `approved`），随后由领域服务原子提交：

- `production_commit:r7-echo:chapter:01:v1:20260809`
- 已接受章节：`chapter:echo:01`，revision `1`，接受文档
  `production:chapter_text:chapter:echo:01`（来源草稿
  `production:chapter_draft:chapter:echo:01:v1`）
- Writer Manifest：`manifest:echo:01:v1`；本地模型：`qwen3.5:9b`；无 Editor review lineage。
- 同一事务已写入 ChapterDelta、2 条 Canon、林岚的 CharacterKnowledge、ReaderState、
  ReaderPromise、OutlineDrift、生产游标与审计记录；当前生产游标已指向第 2 章。

提交后仅经领域查询核验上述元数据：工作台显示 accepted 第 1 章、2 条 canonical Canon、
一条 `establish` ReaderPromise；没有待处理 confirmation。已接受正文未在本审计中输出。

视觉验收由 Agent 自行完成，**不是用户人工验收**：对唯一运行中的 `Ainovr` 桌面窗口执行了只读
图形捕获并审阅。1280×800 画面中“作品 / 参考 / 待处理 / 设置”四个一级入口可见；作品页正常
显示项目、文档索引、生产状态、Canon 和 ReaderPromise，且没有内置聊天或自由画布入口。窗口自动化
桥接曾两次无法返回画面，故没有将该桥接失败写成通过；最终结论基于实际窗口捕获。

## 结论与范围豁免

1. 该样本证明参考分析到原创候选、三 Reader、独立 Reviewer 与受确认 `ProductionCommit` 的真实本地闭环可执行，并证明无效 Editor 输出不会越过领域校验成为草稿。
2. Editor V2 的失败审计仍保留；正式接受的是用户明确授权的 V1，不以失败的 Editor 任务替代确认。
3. 云端模型对比、全量《龙族Ⅰ》Coverage 和人工事实准确率抽查均按用户于 2026-08-09 的明确指示跳过；这些是范围豁免，**不代表相应能力已经通过验证**。
