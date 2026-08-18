# Ainovr 人类可读写作方法验证垂直切片需求（2026-08-17）

状态：**P0–P5 已完成实现与隔离 replay 验收；P6 已具备本地、版本化的三组匿名配对冻结、候选 Writer 生成、独立匿名盲评和结论计算契约，真实 Provider 生成和人工盲评尚未开始。**

## 1. 目的

下一阶段只交付一条面向作者/编辑的真实垂直切片：

```text
参考证据
→ 写作方法卡（内部 MechanismAsset）
→ 全局人工采纳
→ 本章采用记录
→ CreativeRecipe / Writer ContextManifest
→ Writer 草稿
→ Reviewer 目标效果判断
→ 人类处置
→ 持久确认后的 ProductionCommit
```

该切片验证的不是“界面能显示多少领域字段”，而是作者能否无需理解 SQL、对象 Hash、内部 ID、原始 JSON 或 Pipeline 节点，回答以下问题：

1. 这张写作方法卡想改善什么阅读效果？
2. 它为什么适合当前章节？
3. Writer 是否按本章采用记录实际使用了它？
4. Reviewer 是否观察到预期效果及副作用？
5. 作者最终接受、质疑、退回或请求修订了什么？

本需求是 [已裁决执行基线](decision-execution-baseline-2026-08-10.md) 的下一阶段产品切片，不改变当前四个完成字段：

```text
engineering_release_ready = true
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false
```

## 2. 当前事实与问题

### 2.1 已成立的工程事实

- SQLite/Application Service 是唯一业务真相；UI 通过受限桌面 MCP 领域通道读取 QueryService 投影并提交领域命令。
- `MechanismAssetService` 已保存完整分析侧机制卡，并只向生产侧投影去来源化的 `when / operations / avoid / applicability / targetEffect`。
- `CreativeRecipeService` 已冻结精确的机制 revision，并登记 ChapterContract 与机制依赖。
- Writer、三 Reader、Reviewer、ProductionCommit、CAS、持久确认和依赖失效已有领域路径。
- 真实隔离短篇 `data/r7-dstdyj-20260809` 已有一张已采纳机制、Writer V1、三 Reader 和 Reviewer 成功结果；Editor V2 合法失败关闭。

### 2.2 当前缺口

- `CreativeRecipe` 只保存机制 ID/revision，没有作者的“本章为什么采用、如何使用、希望 Reviewer 观察什么”。
- `ChapterReview` 只报告结构、连续性、表达与原创性问题，没有逐项判断写作方法的目标效果。
- 待处理页只显示机制短投影，作品页依赖 JSON、内部 ID 和跨页操作。
- Writer 草稿、方法卡、Reviewer 问题和作者处置没有组成同一章节工作台。
- UI 的 `human` ProductionCommit 当前不会像 `human_via_agent` 一样强制持久确认，和本轮已裁决的产品行为不一致。
- 单章结果没有独立、诚实的“方法应用结果”；如果直接修改全局机制状态，会把单章样本过度推广成普遍结论。

## 3. 用户、范围与非目标

### 3.1 首要用户

首要用户是负责原创章节决策的作者/编辑。分析研究人员需要的 SourceSpan、Hash、反证和 Coverage 继续保留，但默认折叠为证据或诊断层。

### 3.2 第一阶段工作单元

第一条切片固定为：

- 一个原创作品；
- 一个章节；
- 一张已采纳写作方法卡；
- 一个 Writer 草稿；
- 一个 Reviewer 结果；
- 一次人类处置。

该限制只属于本次“方法应用验证”切片。一般章节可以使用零张写作方法卡；系统不得强迫每章套用参考分析。第一条切片通过后，才评估同章多卡。

### 3.3 涉及的工作台

- “待处理”：完整审核写作方法卡、展开证据、批准或退回。
- “作品”：创建本章采用记录、阅读完整草稿、复核 Reviewer、提交人类处置和发起 ProductionCommit 确认。
- “参考”：只作为证据定位的跳转目标；本阶段不重做完整分析操作面。
- “设置”：保持现状；本阶段不处理 Provider、创作策略或 Pipeline JSON 体验。

### 3.4 非目标

- 不恢复内置聊天、自由画布或通用工作流编辑器。
- 不在 UI 中直接启动新的 Writer/Reviewer 模型调用，也不新增自由 Prompt 编辑器。
- 不实现 Editor V2 自动修订或自动替换正文。
- 不恢复《龙族Ⅰ》全量分析、云端模型比较、长篇吞吐或成本实验。
- 不在本阶段处理多方法卡、跨章节方法效用统计或全局机制生命周期升级。
- 不直接编辑 Writer 正文；第一阶段只阅读、定位、处置和请求受控修订。
- 不恢复 Secret 输入、`data/settings.json`、SQL/任意文件工具或 UI 业务状态副本。

## 4. 用户语言

| 内部名称 | 用户界面名称 | 默认呈现 |
|---|---|---|
| `MechanismAsset` | 写作方法卡 | 主界面名称 |
| `ChapterMechanismApplication` | 本章采用记录 | 主界面名称 |
| `ChapterMechanismOutcome` | 本章应用结果 | 主界面名称 |
| `CreativeRecipe` | 章节写作配方 | 默认摘要，诊断中显示内部名 |
| `ContextManifest` | 本次生成上下文 | 默认摘要，诊断中显示内部名 |
| `ChapterReview` | Reviewer 反馈 | 主界面名称 |
| `ProductionCommit` | 接受为正式章节 | 主按钮名称，内部名进入诊断 |

`revision`、taskId、runId、object hash、模型路由、原始状态枚举和原始 JSON 默认进入“诊断详情”，但必须可展开、复制并提供给外部 Agent 排障。

## 5. 完整用户流程

### 5.1 全局审核写作方法卡

1. 作者在“待处理”打开候选写作方法卡。
2. UI 显示目标效果、适用时机、写作步骤、避免事项、适用边界。
3. 作者按需展开 1–3 条合法 SourceSpan 证据；每条显示定位、`sourceHash`、`exactTextHash` 和证据状态。
4. 作者批准或退回当前 revision。
5. 批准仍走现有持久确认；批准后形成项目级已采纳方法。

方法卡正文是分析产物，只读。若作者认为正文需要修改，应退回并由外部 Agent 生成新候选 revision；UI 不覆盖当前分析产物。

### 5.2 创建本章采用记录

1. 作者在“作品”选择章节。
2. 仅能从该原创项目当前已采纳的方法卡中选择一张。
3. 作者填写五项章节级决策：
   - 本章为什么采用；
   - 准备用在什么场景或段落；
   - 希望读者产生什么可观察反应；
   - 本章不允许出现的误用；
   - Reviewer 必须检查的信号。
4. 每项必须为明确值，或显式选择 `unknown` / `not_applicable`；空字符串不能冒充决定。
5. 保存携带 `expectedRevision`，形成版本化的本章采用记录。

只有选择进入“方法应用验证”流程的章节才以该记录作为 Writer 前置门。一般零方法卡章节继续走原有生产链。

### 5.3 冻结生产输入

- `CreativeRecipe` 不再从 ChapterContract 的裸 `mechanismCardIds` 推断作者决定。
- 有方法应用记录时，Recipe 冻结 ChapterContract revision、方法卡 revision、当前采纳事实和本章采用记录 revision。
- Writer ContextManifest 只包含去来源化方法投影和本章采用记录；不得包含参考标题、人物、剧情、原文、SourceSpan 或 provenance。
- 更新 ChapterContract、方法卡、全局采纳事实或本章采用记录后，旧 Recipe、Manifest、Review 与应用结果必须失效并阻止 ProductionCommit。

### 5.4 Reviewer 目标效果判断

Reviewer 在保留现有精确问题契约的同时，必须逐项判断本章采用记录中的检查信号。允许状态：

- `observed`：已观察到；
- `partial`：部分出现；
- `not_observed`：没有观察到；
- `counteracted`：被正文中的其他处理抵消；
- `unknown`：输入或证据不足，不能判断；
- `not_applicable`：该信号对当前正文不适用。

每项判断包含：

- 对应的检查信号；
- 状态；
- 面向作者的一句解释；
- 零个或多个精确 UTF-8 半开区间；
- 可选副作用或冲突说明；
- 建议动作：接受当前版本、定向修订或退回方法卡。

Reviewer 原始输出与规范化结果分别进入 ObjectStore；SQLite 只保存结构化索引与对象引用。

### 5.5 人类复核与处置

- 作者能阅读完整 Writer 草稿。
- 点击 Reviewer 问题或目标效果判断时，UI 高亮相应正文范围。
- Reviewer 报告不可修改。
- 作者逐项选择“同意”或“不同意”；不同意必须填写理由。
- 人类判断与模型判断并存，任何一方都不能覆盖另一方。
- 作者最终选择：接受当前版本、带风险接受、请求定向修订或暂缓。
- `partial`、`not_observed`、`counteracted` 或 `unknown` 默认建议修订；作者仍可带风险接受，但必须填写理由并经过持久确认。

首阶段在 Reviewer 后结束。请求定向修订只创建清楚的后续请求/状态，不自动调用 Editor V2。

### 5.6 接受为正式章节

“接受当前版本”与“带风险接受”都必须创建持久确认，不因 UI actor 为 `human` 而绕过确认。

确认摘要至少显示：

- 章节、草稿文档与 revision；
- 写作方法卡、本章采用记录和 Reviewer 判断；
- 人类不同意项与带风险接受理由；
- 将写入的 Canon、人物知识、ReaderPromise 和 Outline Drift；
- 当前 revision、失效状态和冲突提示。

批准时必须重新检查命令 Hash、所有依赖 revision、当前策略和目标；任何 stale/CAS 冲突都 fail closed。成功后仍由现有 ProductionCommit 单事务原子写入。

## 6. 领域契约

### 6.1 `ChapterMechanismApplication`

新增项目文档类型 `chapter_mechanism_application`，作为本章方法选择的唯一业务真相。建议最小结构：

```ts
interface ChapterMechanismApplication {
  schema_version: 1;
  kind: "chapter_mechanism_application";
  applicationId: string;
  chapterId: string;
  chapterContractRevision: number;
  mechanismAssetId: string;
  mechanismRevision: number;
  fields: {
    reason: DecisionText;
    plannedUse: DecisionText;
    observableReaderEffect: DecisionText;
    misuseToAvoid: DecisionText;
    reviewSignals: DecisionText[];
  };
}

type DecisionText =
  | { status: "specified"; value: string }
  | { status: "unknown" }
  | { status: "not_applicable" };
```

约束：

- 第一条切片恰好一张方法卡；结构不预建多卡抽象。
- 方法卡必须是当前项目的已采纳安全投影，`editor_only` 不能作为 Writer 方法。
- 记录依赖 ChapterContract 与精确 MechanismAsset revision。
- 创建/更新通过 CommandService，更新必须携带 `expectedRevision`。

### 6.2 Recipe 与 Manifest

- Recipe 冻结 `applicationId` 和 application revision，并登记精确依赖。
- ChapterContract 中旧的裸 `mechanismCardIds` 不再是生产真相；不添加 fallback 或双轨读取。
- 无本章采用记录的一般章节继续生成空方法 Recipe。
- Writer Manifest 只物化 `TransferMechanismCard` 与去来源化采用字段。

### 6.3 `ChapterReview`

扩展正式 Review，使其同时包含现有 `issues` 和新的 `effectAssessments`。Review 必须绑定：

- draft document/revision；
- 三个 Reader Manifest 与反馈；
- application document/revision；
- Writer Manifest；
- 精确的 review signals。

Reviewer 不读取参考证据、来源身份或人类后续处置。

### 6.4 `ChapterMechanismOutcome`

新增项目文档类型 `chapter_mechanism_outcome`，保存：

- application 与 Review 的精确 revision；
- Reviewer 每项原始判断引用；
- 人类逐项同意/不同意及理由；
- 最终处置；
- 是否带风险接受及理由；
- 已观察副作用。

该产物只记录本章应用结果，不修改全局方法卡生命周期。ProductionCommit 必须引用当前且未 stale 的 outcome。

### 6.5 查询投影

新增聚合的章节方法工作台查询，而不是由 React 拼接多个业务真相。投影至少包含：

- 当前章节与阶段；
- 已采纳方法卡摘要；
- 当前 application、Recipe、Manifest、草稿、Review 和 outcome；
- stale/阻塞原因与下一动作；
- 诊断引用。

完整草稿和证据摘录按需读取；不把整本参考小说或完整 Prompt 塞入聚合投影。

## 7. UI 需求

### 7.1 作品页布局

- 左侧：作品与章节导航。
- 中间主区：完整 Writer 草稿与 Reviewer 文本锚点。
- 右侧检查器：`写作方法 / Reviewer / 诊断详情` 三个标签。
- 顶部：当前阶段、阻塞原因、下一动作。
- 现有 11 节点生产链默认折叠到诊断详情。
- 不新增一级导航；继续固定“作品 / 参考 / 待处理 / 设置”。

### 7.2 状态与语言

- 主界面使用中文人类状态，例如“等待填写本章采用记录”“Reviewer 未观察到目标效果”“等待确认正式提交”。
- 原始枚举只进入诊断详情。
- 加载、空态、stale、CAS 冲突、失败与已接受状态必须分别呈现，不共享含糊文案。
- ID 由选择控件和当前上下文携带；作者不得手工复制 Chapter ID、Manifest ID、Document ID 或 ProductionCommit ID。

### 7.3 正文锚点

- 使用已有 UTF-8 半开区间契约，不能把 JavaScript UTF-16 下标直接当作字节偏移。
- 点击问题滚动到正文并高亮原样 quote；quote/hash 不匹配时显示诊断并拒绝伪定位。
- 第一阶段不提供正文内联编辑。

## 8. 验收数据

- 原始 `data/r7-dstdyj-20260809` 保持只读，不修改已接受的第 1 章。
- 创建独立 UI 验收工作区，复用其真实、冻结的分析/Writer/Reader/Reviewer 对象，但将交互场景停在 Reviewer 完成、ProductionCommit 尚未执行。
- 验收副本必须明确标注为 fixture replay；不得把复用对象描述为新模型调用成功。
- fixture 构建只能面向隔离测试目录，不能成为产品 SQL/任意路径工具，也不能指向用户工作区。
- 不复制或输出 Secret、完整 Prompt、参考全文或无关对象。

## 9. 成功标准

以下条件全部满足才可称为本切片完成：

1. 作者不输入 JSON 或内部 ID，即可完成方法审核、本章绑定、Review 复核与 ProductionCommit 确认。
2. 方法证据可按需展开，Writer/Reviewer 的生产上下文仍通过去来源化测试。
3. application 更新会使旧 Recipe、Manifest、Review、outcome 失效；stale 产物不能提交。
4. Reviewer 每个检查信号都有合法状态；正文定位覆盖中文、代理对字符和混合换行。
5. 人类可以质疑 Reviewer，两个判断同时保留。
6. Reviewer 未证实时允许带风险接受，但必须理由与持久确认，且不标记全局方法有效。
7. UI actor `human` 与 `human_via_agent` 的 ProductionCommit 都必须持久确认。
8. 零方法卡章节的既有生产路径继续通过回归。
9. 默认测试、typecheck、lint、前端/CLI/MCP 构建通过；Tauri 发布构建通过。
10. 使用 Win32 后台截图逐状态验收待处理、证据展开、章节采用记录、正文锚点、Reviewer 分歧、确认和 stale/CAS 冲突；不能只用 DOM、空态或 UIA 代替位图证据。

完成本切片也只证明“单章、单卡的人类可读闭环成立”，不能把 `original_plan_complete` 或 `longform_product_validated` 改为 `true`。
