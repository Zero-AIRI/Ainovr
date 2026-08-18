# Ainovr《最终重构执行计划》详细审查（2026-08-12）

## 1. 总裁决

附件计划的产品方向正确：Ainovr 作为外部 Agent 主导的小说分析与原创生产执行环境，保存项目事实、证据、版本、任务、确认和审计，并由可选 UI 展示，是当前最合理的定位。

但附件不能继续作为当前执行计划直接执行。它混合了三种内容：

1. 已被 ADR 和 `AGENTS.md` 取代的历史架构；
2. 已在当前工作区实现、但只完成工程验证的领域能力；
3. 尚未由真实长篇、真实编辑成功样本和生成质量实验验证的产品假设。

当前应采用现行基线，而不是重跑 R0–R8：

```text
engineering_release_ready = true
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false
```

最高优先级不是继续增加分析字段、工具数量或通用工作流能力，而是证明：

> 经过人工采纳的机制资产，是否在相同章节契约和相同模型条件下，稳定改善原创章节中它所声称改善的可观察行为。

没有这项因果证据，系统可能严谨地生产大量 Dossier 和机制卡，却仍然无法指导生成。

## 2. 证据范围和判定规则

本审查核对了附件 1206 行计划、`AGENTS.md`、ADR、完成度审计、对抗性复核、应用服务、MCP/CLI、Tauri 运行边界、测试和现有 R7 记录。

“已实现”只表示代码路径和回归证据存在；不表示真实模型质量已验证。“部分完成”表示领域契约存在，但真实端到端、长篇或人工质量证据仍缺失。“范围豁免”表示用户明确跳过，不得写成通过。

## 3. 逐区段裁决

### 3.1 产品定位与外部 Agent

**裁决：保留。**

外部 Agent（Codex、Claude Code、OpenCode）通过同一 stdio MCP/CLI 编排，Ainovr 保存事实和任务、进行确认和恢复、提供四个工作台，这与当前 `WorkspaceApplicationService`、Node sidecar 和 UI 入口一致。删除内置聊天和自由拖拽画布作为主入口也是正确收束。

需要修订的表述是“所有用户都能修改最底层步骤”。当前可以修改领域文档、PipelineRevision、机制选择和结构化产物；并不能安全地任意编写 SQL、文件节点、代码节点或任意 CommandEnvelope。这是有意的安全边界，应写成“所有已登记领域步骤均可编辑其输入、依赖、版本和人工处置”。

### 3.2 历史架构冲突（必须从计划删除）

附件以下内容已经过时：

| 附件方案 | 当前权威实现/结论 |
|---|---|
| Tauri Rust `rusqlite` 网关，与 Node 双适配器并行 | Rust 只管理 Node MCP sidecar；Node `better-sqlite3` 是桌面、CLI、MCP 共用的数据库宿主 |
| Secret 存 `data/settings.json` | Secret 只从运行时环境 `SecretStore` 读取，不进入 SQLite、ObjectStore、日志、审计或导出 |
| 活动 `analysis_v1_legacy` 入口 | 旧实现只在 archive 对照/恢复，当前没有活动 V1 兼容入口 |
| 旧业务 JSON 清空后仍保留 Secret 设置 | 新基线禁止重新引入 `settings.json`；备份也不得复制或恢复 Secret |

这些不是当前代码缺陷，而是附件计划的历史遗留。继续按附件执行会把已否决的双宿主 SQL、旧 Secret 配置和兼容层重新带回系统。

### 3.3 Pipeline：计划承诺过大，当前实现是有意收束

附件声称底层保留 DAG、循环、并行、条件、子工作流和从节点重跑；当前 `PipelineRevisionService` 实际是受控无环依赖图，`PipelineRunService` 只支持登记过的强类型领域步骤和人工复核：FactExtractor 批处理、Writer、Reader、Reviewer、Editor 等。没有通用条件引擎、子工作流、任意并行调度、`retry_run_from` 或 `stop_run`。

**裁决：删除通用引擎承诺，保留受控 DAG。**

建议文案：

> PipelineRevision 是可版本化、显式 `dependsOn` 的受控 DAG；每个可执行步骤必须映射到已登记领域服务，执行分类在保存和冻结时校验，Run 只读取创建时冻结的无 Secret RouteSnapshot。新增步骤必须单独定义输入、输出、取消、恢复、TDD 和安全审计。

线性 UI 足以表达当前生产链，不应因为用户希望可调整就恢复 Dify 式任意画布。

### 3.4 动态分块与“短文本阈值”

**裁决：保留公式，降低确定性表述。**

`usableContext - output - system/schema/envelope` 的预算思路正确；短文本只跳过 AI 分段，不跳过事实和必要分析，也符合原始需求。当前实现已具备层级分块和 Provider/Workspace 有效预算计算。

但当前 token 估算是启发式（CJK/拉丁字符近似），不是实际 tokenizer；调用结果只保存 `finishReason`、模型等信息，没有完整 input/output usage 持久化。因此附件“真实 API token 用量进入运行遥测”尚未完成。

必须把预算分成三种值：

1. `estimated_tokens`：调用前的安全估算；
2. `reserved_tokens`：Manifest/Run 冻结的保留预算；
3. `actual_usage`：Provider 返回或本地计数得到的实际输入/输出量。

在实际 usage 未能获得时，应保存 `unknown`，不能伪造成本。当前计划中的本地 `4096/1024`、云端 `32000/8000` 也不应写死为产品常数，应以 Provider Profile 与 Workspace DataPolicy 的有效最小值为准。

### 3.5 V2 分析链

**裁决：领域链保留，自动化程度必须如实标注。**

当前已有导入、规范化映射、Reading Map、AnalysisBrief、FactLedger、ThreadGraph、ResearchConclusion、IndependentFalsification、ResearchDossier、EvidenceWorkbench、MechanismAsset、Coverage 的持久化契约和测试。它们构成正确的数据链：

```text
SourceSpan → FactLedger → ThreadGraph → ResearchQuestion
→ Falsification → ResearchDossier → MechanismAsset → 人工采纳
```

但是，除本地 FactExtractor 外，多数综合阶段是外部 Agent 提交结构化结果，不是 Ainovr 已经自动运行的完整模型编排。R4 不能写成“真实模型分析闭环已完成”。

流程也不应被解释为每本书固定四遍、每个模块都跑一遍：事实和线程适合广覆盖；研究问题、反证和机制应按研究问题与预期生产决策按需取证。推荐默认研究问题为 1–3 个（附件“最多五个”仅作硬上限），并按预期决策价值/证据成本排序。

### 3.6 阅读地图与 Coverage

阅读地图作为低成本浅扫是必要的，但附件要求一次输出人物、别名、地点、时间、物件、事件密度、对话比例、视角、矛盾和线程候选，容易让本地小模型在一个超宽 schema 上同时猜测，导致低成功率和过度分析。

建议拆为：

- 确定性统计：字节、字符、估算 token、段落/对话比例、原章节定位；
- 候选索引：实体/物件/时间/地点的出现候选和置信度；
- 后置解释：只有被 AnalysisBrief 选中的对象才进入线程、矛盾或机制研究。

“所有计算单元 × 所有模块必须有处置结果”在长篇上会产生巨大稠密矩阵。应改为每个已启用模块的 `CoverageContract` 产生稀疏覆盖：未启用模块不生成逐单元占位，启用模块仍必须对每个目标单元有 `complete/partial/not_observed/skipped/failed` 等处置。

### 3.7 证据、弃权与反证

**裁决：保留，是计划中最强的部分。**

正向结论绑定合法 `SourceSpan`、`sourceHash`、`exactTextHash`、UTF-8 半开区间，并允许 `unknown/not_observed/no_pattern/not_applicable`，直接回应了“不要强行解释”的核心问题。

但“distributed 至少三个单元”只是证据门，不是机制有效性证明。三个 span 如果都来自同一事件、同一场景或同一角色，不能算跨情境分布。应增加“实例独立性/情境多样性”字段，并在机制效用实验中继续验证。

### 3.8 机制资产：缺失最关键的反馈闭环

机制卡的 `when/do/avoid`、反例、边界、去来源化和人工采纳设计正确。Writer 只读取已采纳的中性机制投影，也符合安全不变量。

但附件没有定义机制被实际使用后如何判定有效、过时、冲突或降级。必须新增生命周期：

```text
candidate → adopted → tested → retained
                         ↘ stale / editor_only / rejected
```

至少记录：目标行为、注入版本、是否达成、Reviewer 盲评结果、上下文成本、与其他机制冲突、跨章节重复效果。没有增益或产生负面副作用的机制不能继续默认注入。

### 3.9 原创规划：三个概念是默认模板，不应是普遍硬门

当前代码 `submitStoryConcepts()` 硬性要求恰好三个概念，`selectStoryConcept()` 也要求先审核再选择。对于探索型创作这是合理默认，但附件把它写成所有项目的固定流程，和“用户可高度自定义”冲突。

**建议：**默认生成三个明显不同的候选；允许用户已有概念时走 `use_existing_concept`，也允许人工组合后直接进入 StoryContract。若保留恰好三个作为当前版本安全门，必须明确它是产品模板约束，而不是小说创作的普遍真理。

### 3.10 ChapterContract、三机制上限与 ReaderPromise

ChapterContract 的状态推进、欲望、压力、转折、进入/退出状态和下一章接口，是生产真正需要的最小契约，应保留。

但“每章最多三张机制卡可由 PipelineRevision 修改”不符合当前实现：`story-planning-service.ts` 在领域层硬限制 `mechanismCardIds.length > 3` 即失败。三项上限应属于 ChapterContract/CreativeRecipe 策略，不应通过通用 Pipeline 配置绕过；若要可调，应增加显式领域设置和版本化策略。

ReaderPromise 还存在术语和 schema 矛盾：计划写了“违约”，代码状态只有 `establish/reinforce/delay/payoff/transform`，没有 `breached` 或 `abandoned`。当前转移规则还要求兑现后只能 `transform`。必须二选一并写入 ADR：

- 要表达违约：新增明确的 `breached` 生命周期、触发来源、人工裁决和状态转移测试；
- 不新增状态：删除“违约”术语，把未兑现作为 Reviewer issue/Outline Drift，而不是 ReaderPromise 状态。

推荐第一种，但不应在未定义语义前把“违约”写入验收。

### 3.11 Outline Reviewer 是悬空角色

附件生产链含 `ChapterContract → Outline Reviewer → Writer V1`，但当前活动 `src/application` 中没有独立 Outline Reviewer 服务、任务或 MCP 工具；现有实现直接冻结 ChapterContextManifest 并启动 Writer，Outline Drift 在 ProductionCommit 时作为待审核产物保存。

**裁决：**要么删除链图中的 Outline Reviewer，明确由人工审核 ChapterContract/StagePlan；要么新增独立领域服务、输入输出 schema、阻断条件和测试。推荐先删除该悬空节点，把“细纲是否可执行”作为 `ChapterContract` 的批准门，避免再造一个没有质量证据的 Agent 角色。

### 3.12 ContextManifest 与真实调用遥测

六层 Manifest 的白名单隔离、冻结和 Writer 源作去来源化检查已有较强实现。Writer 不查询 reference/analysis 表，符合 AGENTS 不变量。

附件要求“调用后记录实际读取、token、Provider、模型和结果”，当前只能证明计划读取已物化、输入对象已冻结、Provider/模型/finishReason 有 lineage；没有独立 actual-read manifest，也没有实际 input/output token usage。

这是重要的可观察性缺口，尤其影响成本、截断和长篇恢复判断，应列为 P1，而不是继续宣称已完成。

### 3.13 Writer → Reviewer → Editor

版本链、父版本、精确 UTF-8 替换、三 Reader 独立 Manifest、Reviewer 问题绑定和 ProductionCommit 原子提交均已实现并有回归证据。第三版不自动覆盖人工选择版本的约束正确。

但真实短篇记录显示 Editor V2 初次运行和三次重试均 fail closed，最终接受的是人工选择的 V1。因此计划的“最多三版”工程路径存在，真实成功闭环尚未证明。

下一验收必须至少获得一个真实 Editor V2 成功样本，并证明：修改针对 Reviewer 指定区间、未扩大到整章重写、正文质量没有破坏 ChapterContract/Canon。

### 3.14 UI：结构性完成，不等于可读易用

四个工作台、QueryService 投影、change feed、证据摘录、Coverage、待处理队列和生产 lineage 已有代码；但附件称“支持选中文本问诊、生成局部 revision”，当前以三 Reader + Reviewer 的受控诊断链替代，不能写成原条目已实现。

现 UI 仍有大量原始 JSON textarea、ID 和手工粘贴分析结果/ProductionCommit/Pipeline 步骤。这满足“可修改”，但不满足“人类易读、直观感受分析如何变成作品”。推荐优先做领域专用表单、证据点击联动、版本 diff 和错误字段定位；不推荐先做通用画布。

设置页另有真实矛盾：附件要求 Secret 输入和“已配置”状态，当前 UI 不录入 Secret，运行时只读环境变量。不能恢复 `settings.json`。若要桌面内配置，应另立 ADR，使用 Windows Credential Manager/系统凭据库，仅向 UI 返回 `configured: boolean`，并补威胁模型和 TDD。

### 3.15 TaskRunner、长篇并发与恢复

TaskRunner 已实现 lease、heartbeat、checkpoint、取消、重试和跨宿主 claim；FactExtractor 父任务按计算单元 checkpoint，恢复时跳过成功单元。

但长篇批处理当前明确串行（`for ... of`），没有计划 R7 所要求的并发调度和吞吐证明；通用“网络瞬时错误自动重试两次”也没有作为统一策略实现。模型调用可通过 `AbortSignal` 取消请求，但当前多数调用是非流式 fetch，不应写成“流式消费取消”。

建议先实现串行可恢复基线并获得成本/失败分布，再决定是否引入有限并发；并发不是长篇可用性的前置假设。

### 3.16 DataPolicy、版权和出境

当前 DataPolicy 确实影响 ModelResolver：`never/complex_only/always` 会阻止不允许的云端路由，且远程 Provider 只允许 HTTPS、拒绝重定向。它不是完整的数据治理策略：没有对“参考全文是否允许出境”的逐次确认、文案、项目级覆盖或出境审计摘要。

由于用户会导入完整小说，计划必须新增默认规则：参考原文默认 local-only；任何云端发送必须持久确认，明确范围、Provider、模型、预计字节/Token、保留时间和撤销方式。没有确认时 fail closed。

### 3.17 备份、迁移、发布

当前受控备份只操作工作区内部 `data/backups` 和 `data/restores`，复制 SQLite 与被引用对象，校验 SHA-256，并恢复到新目录，不覆盖当前工作区；这部分证据充分。

附件“旧 API Secret 可继续留在 `settings.json`”必须删除。高于已知 schema 的库应拒绝启动且不修改库；schema registry 也必须将未知版本拒绝写入。当前工程门已覆盖这些边界，但应由现行基线表述，不再引用旧计划的双宿主迁移步骤。

## 4. 计划自身的优先级问题

附件用 R0–R8 表示一套历史重构顺序。R0–R6 的大部分工程任务已经完成或被现行架构改写，继续按阶段重跑会浪费时间并增加回归风险。现在应把它转换为产品验证 backlog。

最重要的缺口排序如下：

| 优先级 | 缺口 | 为什么优先 |
|---|---|---|
| P0 | 计划与 ADR/AGENTS 去冲突 | 防止恢复 Rust SQL、settings.json、活动 V1 和通用 DAG |
| P1 | 机制效用 A/B 实验 | 直接验证分析是否真的指导生成，是整个产品的因果核心 |
| P1 | 真实 Editor V2 成功样本 | 证明质量链能修正文，而非只能 fail closed |
| P1 | 实际 usage/成本/读取遥测 | 没有它无法判断长篇是否可负担、是否截断 |
| P2 | 长篇分阶段恢复验证 | 先小规模代表性样本，再扩大到全册，避免直接押注 722 单元 |
| P2 | 稀疏 CoverageContract | 防止长篇覆盖矩阵爆炸，同时保留失败可见性 |
| P2 | UI 领域表单/证据联动 | 解决“可改但不可读”的真实体验问题 |
| P3 | 三宿主安装态互操作 | 证明外部 Agent 控制面可交付，而不是只在测试夹具中可用 |
| P3 | 有限并发 | 只有串行恢复基线和成本分布稳定后才值得做 |

## 5. 新的执行顺序（替代 R0–R8）

### P0：修订权威计划

- 将本文件与 `decision-execution-baseline-2026-08-10.md`、ADR、`AGENTS.md` 对齐；
- 删除 Rust `rusqlite` 双宿主、`settings.json`、活动 V1、通用 DAG/条件/子工作流承诺；
- 明确 `engineering_release_ready` 与 `longform_product_validated` 分离；
- 冻结研究问题、CoverageContract、机制生命周期和 ReaderPromise 语义。

### P1：最小因果闭环

使用同一 `ChapterContract` 和同一模型生成配对样本：

- A：不注入机制；
- B：注入一张已采纳机制；
- C：可选负对照，注入不相关机制。

Reviewer 不知道组别，只评价机制声明对应的可观察行为。记录达成率、负面副作用、冲突、泄漏、上下文成本和人工盲评。只有重复样本产生稳定增益的机制才进入 `retained`。

### P2：生产链与长篇遥测

- 先取得真实 Editor V2 成功样本；
- 持久化 estimated/reserved/actual usage，无法取得时标 unknown；
- 以 20–30 个代表性计算单元做长篇恢复，再扩展到 100 个，最后才考虑全册；
- 记录失败、重试、恢复、重复正式产物、吞吐和成本；
- Coverage 只对已启用模块生成稀疏处置。

### P3：人类工作台

- 把规划、ChapterContract、机制采纳、Evidence 和 ProductionCommit 从原始 JSON 粘贴改为结构化编辑；
- 证据卡点击后显示精确原文和前后文；
- 版本 diff、Reviewer issue、Editor 目标区间联动；
- 设置页先显示 Provider 路由和 DataPolicy；Secret 桌面录入另立凭据库 ADR，不复活 `settings.json`。

### P4：外部宿主与发布验证

- 在 Codex、Claude Code、OpenCode 的独立安装态中执行同一最小 MCP 流程；
- 验证 Ainovr 窗口关闭时 companion 仍可工作；
- 补真实 Tauri 数据态和 UIA/位图可用性证据；
- 发布物、导出物、恢复目录继续做 Secret 扫描和高版本 schema 拒绝验证。

### P5：再决定自动化扩展

只有 P1–P4 通过后，才评估有限并发、更多自动步骤或额外 Reader。不要恢复通用代码/HTTP/文件节点或自由画布。

## 6. 最终验收问题

下一轮不应继续问“分析字段是否足够多”，而应逐一回答：

1. 机制注入是否比无机制基线提升目标行为？
2. Editor V2 是否能在真实 Provider 上稳定完成定向修订？
3. 一次长篇任务能否在失败后从 checkpoint 无重复恢复？
4. 实际 token/成本是否可观测且符合 DataPolicy？
5. 人类能否从原文证据一路追到机制、章节契约、Writer Manifest 和最终正文？
6. 三个外部 Agent 宿主能否在独立安装态执行同一领域流程？

在这些问题没有直接证据前，不应宣布“原计划完成”或“已经能稳定生产长篇作品”。
