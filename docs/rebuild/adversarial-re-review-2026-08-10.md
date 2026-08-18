# Ainovr 对抗性重审与修复记录（2026-08-10）

本记录以最终重构执行计划和 `AGENTS.md` 为约束，采用第一性原理检查“能否把一个错误状态写成项目事实、能否被另一个项目覆盖、能否在生产上下文泄漏参考来源、能否把未支持步骤保存到运行时才失败”。它不是原始 R7 长篇产品验收报告。

## 本轮已修复的高风险断点

| 断点 | 修复 | 反证测试/证据 |
|---|---|---|
| ReaderState/ReaderPromise 以全局 ID 冲突 | 初始 schema 使用 `(project_id, reader_*_id)` 复合主键；生产更新带项目条件和 expectedRevision | `chapter-production-commit-service` 后续提交测试；新 schema 由全新工作区创建 |
| Promise 可以任意跳状态 | 新建只能 `establish`；更新通过状态转移条件和 CAS，兑现后只能 `transform` | 后续应补充 payoff→establish、跨项目同 ID 的显式失败用例 |
| Zeus Responses 被当 Chat Completions | ProviderProfile 保存 `protocol`；Responses 请求走 `/v1/responses`、`input`、`max_output_tokens` | `routed-model-caller.test.ts` fake fetch |
| 模型预算被工作区默认值覆盖 | ProviderProfile 保存上下文、输出上限、安全余量；ModelResolver 冻结并返回同一预算 | `model-resolver.test.ts` 与 Provider 保存测试 |
| Writer 仅按键名过滤来源 | Manifest/Writer 增加值级来源特征拒绝；机制仍通过白名单 transfer projection | `chapter-context-manifest-service` 与 transfer-card 回归 |
| 旧 Secret 配置脚本读取 settings.json | 删除旧配置/FC spike；真实 API 配置仅读环境变量；package scripts 不再暴露旧入口 | 静态 `rg` 红线扫描 |
| CLI 冒充 human | 普通 CLI 命令标识为 `external_agent`；涉及人工接受/审核的命令使用 `human_via_agent` 并进入持久确认 | CLI/ProductionCommit 测试已改为先取得确认再批准 |
| Pipeline 步骤保存后才发现无法执行 | 保存时为每步归类 `executable / agent_action / human_review`；冻结快照携带分类 | PipelineRevision/Run 回归 |

## 仍然故意未宣称完成的内容

- 《龙族Ⅰ》全量可恢复模型验证、云端比较与人工质量抽查仍未完成。
- 真实模型 Editor V2 成功样本仍未形成直接证据。
- 活动 `analysis_v1_legacy` 运行入口没有恢复；按当前决策只保留归档，不加兼容层。
- 三个外部客户端的独立安装态互操作仍需宿主级证据。
- 桌面端 OS 凭据存储尚未接入；当前 SecretStore 仍是 MCP/CLI 环境变量边界。UI 不显示或保存密钥。
- 作品正文选区问诊的原始需求仍按三 Reader + Reviewer 收束，未恢复自由助手。

## 对抗性结论

当前可以证明的是“核心工程边界正在变得可证伪且默认拒绝危险写入”，不能证明“原始执行计划的长篇生产目标已经完成”。任何发布说明必须分别报告：

```text
engineering_release_ready
approved_reduced_scope_complete
original_plan_complete
longform_product_validated
```

在长篇实测和 UI 截图验收完成前，后两项保持 `false`。

## 第二轮复核发现与处置

本轮继续从“恶意/错误状态能否写成事实”出发，发现并修复了两个可复现断点：

| 断点 | 影响 | 处置与证据 |
|---|---|---|
| UI 人工身份由用户可控的 `_transport` 参数决定 | 任意 stdio MCP 调用可附带 `_transport: desktop_ui`，使原本应为 `external_agent` 的规划命令被审计成 `human`，破坏 actor 证据 | 删除 UI 参数标记；桌面 sidecar 由 Rust 以 `--desktop-ui` 启动，MCP handler 只从受信组装参数读取 transport。新增 transport 审计回归：外部伪造仍为 `external_agent`，sidecar transport 才为 `human`。 |
| FactExtractor 运行时适配器丢弃 Provider `protocol` | Zeus Responses 路由在事实抽取时会退回 Chat Completions 请求，真实 API 可能返回 404/错误协议 | CLI 与 MCP 的 FactExtractor wrapper 现在显式传递 `protocol`；默认回归保持通过。 |
| AnalysisCorpus overview 按 SourceEdition 统计全部 span | 同一原文的 volume/fragment 或多版本 segmentation 会把未纳入当前 corpus 的 span 计入 `spanCount`，Coverage/UI 产生假完整 | `getOverview` 改为按当前 `segmentation_id` 的 `analysis_units` 连接统计；范围 corpus 回归要求准确计数。 |

仍然存在但本轮不冒充已完成的结构性缺口：

1. `source_spans.span_id` 在完整 segmentation 间仍为全局主键，重复对同一 SourceEdition 建立完整 segmentation 会冲突；若要支持并行 V1/V2 corpus，必须先决定是否把 span ID 全部纳入 segmentation 命名空间，再一次性破坏性调整 schema，不能偷偷加兼容层。
2. AnalysisCorpus 的接口仍保留显式预算字段以描述本次 Prompt 开销；在 CLI/MCP 正式组装中已注入 ModelResolver，并在冻结前按 FactExtractor route 与 Workspace policy 封顶。没有 resolver 的单元测试夹具不代表生产路径可以绕过 cap。
3. UI 本轮已验证空状态视觉，但尚未对有项目、失败任务、待确认、证据、机制卡、ContextManifest、Reader/Reviewer/Editor lineage 等数据态逐一截图；浏览器预览也不能替代 Tauri + SQLite 真相库验收。

## UI 视觉复核（浏览器开发预览）

本轮重新捕获并逐图检查了四个一级工作台及设置中的 Pipeline 区段。截图只证明前端布局，页面顶部的“浏览器开发预览”提示是预期的非 Tauri 状态，不是运行错误。

| 状态 | 视觉判断 | 证据 |
|---|---|---|
| 作品空状态 | 通过：四个导航、三栏作品布局和外部 Agent 定位清楚；已修正无项目时误显示“正在读取当前章节”的文案。 | 本地证据已封存，不公开链接。 |
| 参考空状态 | 通过：不直接展示原文，明确 SourceSpan/Hash/Coverage 边界；下一步依赖 MCP/CLI 的提示可见。 | 本地证据已封存，不公开链接。 |
| 待处理空状态 | 通过：确认、任务、机制、Coverage、规划审核分区清晰；页面较长但层级稳定。 | 本地证据已封存，不公开链接。 |
| 设置顶部 | 有条件通过：Provider 协议/预算字段和 Secret 不回显说明清楚；Provider budget 与 Workspace budget 的有效值关系仍需再加一条 UI 说明。 | 本地证据已封存，不公开链接。 |
| 设置 Pipeline 区段 | 有条件通过：线性编辑器、冻结运行和复核说明符合当前无自由画布决策；JSON 文本框对非技术用户可读性弱，但不构成越权入口。 | 本地证据已封存，不公开链接。 |

尚未通过视觉验收的范围：有数据作品、参考证据/Coverage、机制卡采纳、ContextManifest、Reader/Reviewer/Editor lineage、待确认、失败/取消任务、Provider 已配置态，以及完整 Tauri + SQLite 桌面截图。它们必须作为下一次 UI 验收的逐状态清单，不能用空状态截图替代。

## 第三轮对抗性复核：新增硬断点（2026-08-10）

本轮不再重复“构建是否通过”，而是构造两个并行 AnalysisCorpus、两个并发首章提交、伪造桌面 transport、超出模型上限的显式预算，以及旧 0001 数据库等反例。以下问题会让系统产生错误事实、错误审计或在真实长篇运行中失去可恢复性，因此不能以当前 63 个测试文件通过作为关闭条件。

| 严重度 | 断点与复现路径 | 影响 | 关闭条件 |
|---|---|---|---|
| P0 | **AnalysisProject 不是 segmentation 隔离域**：`research-conclusion-service.ts`、`independent-falsification-service.ts`、`mechanism-asset-service.ts` 和 `structural-reading-map-service.ts` 通过 `project.source_edition_id = span.source_edition_id` 取 span，而不是连接 `project.segmentation_id → analysis_units.segmentation_id`。对同一 SourceEdition 建立 volume/fragment 或第二版 segmentation 后，结论、反证、分布式机制计数和 ReadingMap 会读入别的 corpus 的 span。 | 证据可合法通过校验却不属于当前分析版本；跨版本污染会直接改变机制卡和生产参考。 | 所有“按项目取 span”查询必须经当前 segmentation 的 analysis_units；增加两个同源不同 segmentation 的反向夹具，验证结论/反证/ReadingMap/机制候选均拒绝外部 span。 |
| P0 | **章节首章并发提交没有数据库级唯一约束**：`chapters UNIQUE(project_id, branch_id, ordinal)` 中 `branch_id` 为 NULL 时 SQLite 允许重复；`assertProductionChapterBoundary()` 又在事务外预检。两个宿主可同时把 ordinal=1 写成两个章节。 | 生产游标、章节列表和后续因果链出现双首章；CAS 不能覆盖“两个都从不存在开始”的竞态。 | 初始 schema 增加 `UNIQUE(project_id, ordinal) WHERE branch_id IS NULL`（或明确 branch key），并以并发事务测试证明只有一个提交成功；不加 fallback。 |
| P1 | **Provider/Workspace 输出预算是装饰性的**：`LocalCreationService` 与 `LocalFactExtractionService` 只有在调用方未传 `maxTokens` 时才采用 route 上限；显式值可超过 Provider `maxOutputTokens`。Workspace 的 context/output/safety 设置只被 UI 保存和显示，模型解析只读取 `cloudEscalation`。FactExtractor 截断修复还会把预算放大到 `input*4`。 | 请求可能超过真实模型能力、分析切片与生产上下文不一致，设置页给出“共同约束”但运行时不执行。 | ModelResolver 合成 Provider 与 Workspace 的有效预算；所有任务在冻结输入时 fail closed 或保存已计算的 cap；修复重试不得超过 cap；AnalysisCorpus 不再接受调用方伪造能力预算。 |
| P1 | **`human`/`human_via_agent` 不是不可伪造的身份边界**：stdio 客户端可直接启动 `ainovr-mcp.mjs --desktop-ui`，而 MCP `approve_confirmation` 在任何 transport 都硬编码为 `human_via_agent`。此外，桌面适配器剥离 actor 后，`create_novel_project`、Provider/Workspace 设置等分支仍硬编码 `external_agent`，造成 UI 人工操作审计失真。 | 恶意/误配置 Agent 可把高风险动作伪装成人工或自行批准；审计无法回答“谁真的点了确认”。 | 明确单用户合作威胁模型；若需要可信审计，采用不可由 stdio 参数决定的宿主凭据/IPC nonce，并让 desktop transport 对全部 UI 命令统一产生 `human`；确认批准记录绑定宿主身份。若接受合作模型，必须在发布声明中把它写成“审计声明”而非“权限证明”。 |
| P1 | **旧数据库可能静默以旧 0001 结构启动**：`0001-initial-schema.sql` 被直接改写，但已记录 `0001` 的旧库不会重新执行，且没有 schema-shape 拒绝。用户未按手册抛弃旧 `ainovr.sqlite3` 时，复合主键等新不变量不会存在。 | 运行到跨项目 ReaderState/Promise 写入才失败，或更危险地在旧约束下接受错误状态；“不保留兼容”没有变成启动时硬拒绝。 | 启动时检查关键 schema fingerprint/required indexes；旧形状直接拒绝并提示新工作区/外部备份，不读取或改写旧业务数据。 |
| P1 | **Pipeline 分类仍可能延迟到运行时**：`PipelineRevisionService.normalizeStep()` 对显式非法 `execution` 只检查 truthiness；planner 的 `planCommitPipelineRevision`/`planStartPipelineRun` 不复核枚举，损坏快照最终在 `pipeline-run-service.parseStep()` 才失败。 | UI/MCP 可以保存“看似冻结”的不可运行步骤，长任务启动后才阻断，违反“保存时分类”的契约。 | 在保存、冻结和读取三个边界统一校验 `executable/agent_action/human_review`，并加入非法 execution 的保存/启动/读取反例测试。 |
| P2 | **模型来源去泄漏仍主要是字符串/字段启发式**：`assertWriterSafe()` 无法识别未带书名号的专名、改写后的事件链或高相似短语；同时会把原创用户合法使用的 `《…》` 书名误判为来源侧值。 | 可能放过实质模仿，也可能让合法原创项目无法冻结 Manifest。 | 采用机制级中性化契约 + 人工采纳证据 + 独立原创性检查样本；把静态正则降级为告警或精确的禁用词集合，并分别测试误报/漏报。 |

### 对原计划完成声明的重新裁决

在第四轮修复前，四个完成门曾暂时保持：

```text
engineering_release_ready = false
approved_reduced_scope_complete = false
original_plan_complete = false
longform_product_validated = false
```

该段状态已由下方“第四轮修复、回归与视觉重审”取代；P0/P1 的代码反例已关闭，但真实数据态、Secret 接入、长篇恢复和三宿主互操作仍缺直接证据。

### 推荐修复顺序

1–4. 已在第四轮完成并由回归测试覆盖；desktop transport 仍按合作式单用户威胁模型解释。
5. 继续进行真实 Tauri + SQLite 数据态截图和《龙族Ⅰ》恢复验证；空壳布局不能替代产品验收。

### 其他未升级为 P0 的缺口

- `production_commits.run_id` 当前由生产计划固定写入 `NULL`，尚未把接受章节绑定到具体 Writer/Reviewer/Editor 运行；这会削弱失败重放和模型成本审计。
- 发布版 Tauri 已改为将工作区定位到用户可写的 `app_data_dir()`；CLI/MCP 仍可通过显式 `--workspace` 使用便携目录。安装后权限仍需在真实 Windows 用户帐户下做一次冒烟。
- 环境变量 SecretStore 的 profile ID 规范化可能发生碰撞（例如 `a-b` 与 `a_b`），且桌面端没有 Secret 输入/已配置状态；Provider 能列出不代表桌面可调用。
- 机制投影的静态禁词无法替代真实长篇原创性和源作相似度抽查；当前没有《龙族Ⅰ》全量恢复、云端比较或三宿主安装态证据。

## 第四轮修复、回归与视觉重审（2026-08-10）

本轮按“批准全部修复建议”实际修改代码，而不是只更新结论：

| 修复项 | 当前证据 | 结论 |
|---|---|---|
| AnalysisProject → Segmentation 证据隔离 | ResearchConclusion、IndependentFalsification、MechanismAsset、StructuralReadingMap 均改为经 `analysis_projects.segmentation_id → analysis_units.segmentation_id` 取 span；同一 SourceEdition 的第二 segmentation 夹具通过 | P0 已关闭 |
| 主分支首章并发唯一性 | 初始 schema 增加 `chapters_main_branch_ordinal_unique` 部分索引；重复 `branch_id IS NULL` ordinal 回归通过 | P0 已关闭；仍需真实双连接并发压测 |
| Provider/Workspace 有效预算 | ModelResolver 以 `min(context/maxOutput)`、`max(safetyMargin)` 合成有效能力；LocalCreation/FactExtractor 超 cap fail closed；FactExtractor 截断修复不超过 cap；AnalysisCorpus 在生产组装的 route 下再次封顶，并强制至少预留 FactExtractor 的真实最大输出空间 | P1 已关闭（无 resolver 的纯测试夹具仍允许显式预算，这是测试组装边界） |
| Pipeline execution | 保存、冻结计划、读取快照均拒绝非法 execution；损坏快照回归新增并通过 | P1 已关闭 |
| 桌面/stdio actor 审计 | MCP 所有外部/人工命令统一经过 `actorForTransport`；stdio 伪造参数仍是 `external_agent/mcp`，Rust sidecar 同时注入 `--desktop-ui` 与 `AINOVR_DESKTOP_SIDECAR=1` 才产生 `human/desktop-ui`；基础设置、项目、确认、分析和生产路径回归通过 | 审计一致性已修复；该环境标记能阻断普通参数误配，但仍是合作式 transport 标记，不是同机恶意进程的密码学认证 |

本轮验证结果：

- `npm test`：64 个文件、256 项通过。
- `npm run typecheck`、`npm run lint`、`npm run build`、`npm run build:cli`、`npm run build:mcp`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：3 项通过。
- `npm run tauri build`：MSI/NSIS 均生成；唯一提示是既有的 `.app` bundle identifier 警告。
- 构建后 MCP `tools/list`：114 个领域工具；精确禁止 SQL/任意文件工具数为 0。
- `dist`、`dist-cli`、`dist-mcp`、Tauri release bundle、exports/restores 的 Secret 值模式扫描：0 命中。

### 逐图 UI 视觉判定

本轮对已有五张截图逐张检查，而不是把“有截图”当作通过：

| 图片 | 判定 | 仍不能证明的内容 |
|---|---|---|
| 作品空状态（本地证据） | 通过空状态布局：四个一级入口、项目创建入口、生产状态卡和“外部 Agent + 桌面工作台”定位清楚；浏览器预览警告位置明确 | 没有真实项目、章节、Canon/Promise 投影 |
| 参考空状态（本地证据） | 通过空状态布局：不把原文直接铺进 UI，SourceSpan/Hash/Coverage 边界可读 | 没有 SourceEdition、Coverage、ResearchDossier |
| 待处理空状态（本地证据） | 通过层级与空状态文案；确认、任务、机制、Coverage、规划审核分区可定位 | 没有待确认、失败/取消任务、机制候选实际卡片 |
| 设置顶部（本地证据） | 有条件通过：协议、窗口、输出、安全余量字段和 Secret 不回显说明清晰；输入控件未发现遮挡 | 没有 Provider 已配置/冲突/保存失败态；截图早于本轮 AnalysisCorpus 预算文案更新 |
| 设置 Pipeline（本地证据） | 有条件通过：线性流水线符合“不要自由画布”的决策，冻结运行和人工复核说明可见；JSON 编辑器对非技术用户偏硬 | 没有真实 PipelineRevision/Run 节点、失败和恢复态 |

因此 UI 视觉门仍不是“全部通过”：真实 Tauri + SQLite fixture 的有数据作品、证据/Coverage、机制采纳、ContextManifest、Reader/Reviewer/Editor lineage、待确认、失败/取消任务、Provider 已配置态仍未逐状态捕获。空状态图片只能证明布局和文案，不能证明产品闭环。

## 第五轮对抗性复核：执行计划与运行时契约仍有断裂（2026-08-10）

本轮不修改产品代码，只对当前工作树和用户提供的《最终重构执行计划》做反例审查。默认回归仍为
64 个测试文件、256 项通过，typecheck、CLI/MCP 构建通过；这些结果只能证明静态回归，不会自动关闭下列运行时断点。

| 严重度 | 反例/证据 | 影响 | 关闭条件 |
|---|---|---|---|
| **P0（原始计划）** | `application-mcp-jsonrpc.ts:609–641` 的 `execute_pipeline_run_step` 把 FactExtractor、Writer、Reader、Reviewer、Editor 全部送到 `http://configured-route.invalid/v1` / `configured-route`；没有通过 `ModelResolver` 解析真实 Provider。现有测试还明确断言这个占位值。 | Pipeline 看起来“可执行”，真实调用必然无法到达配置的 Zeus/Ollama；自动化模式和 PipelineRun 不能驱动真实生产。 | Pipeline 执行器按 step role 调用 `ModelResolver`，把解析后的 endpoint/model/protocol/budget 写入任务输入；以真实本地 Provider fixture 完成一条 Writer→Reviewer→Editor 运行。若暂不实现，必须把该类步骤标为不可执行，而不是伪装成 executable。 |
| **P1** | `planCompletePipelineRunStep()` 只要有 human note 就把 `run_nodes.status` 改为 `completed`；`run_nodes` 没有绑定 taskId，`runs.task_id` 在启动时为 NULL，任务成功、输出对象和领域 Commit 均未被校验。 | 人工可把失败/不存在的实际任务记成 Pipeline 完成，运行审计与正式产物脱钩；后续重跑无法可靠定位输入和输出。 | 节点必须绑定领域 task/run；只有任务成功且对应领域 Commit 已存在时才能完成，保存 output hash、model、manifest 和 commit ref；失败/取消只能进入阻塞或可重试状态。 |
| **P1** | Writer ContextManifest 使用调用方传入的 `tokenBudget`（UI 默认 32,768），而 `LocalCreationService` 只检查 `maxTokens <= route.maxOutputTokens`，没有检查渲染后的 prompt 是否小于 `route.contextWindowTokens`。`qwen3:8b` 当前 route 的窗口为 4,096。 | Manifest 可能冻结成功但实际模型请求超窗，造成请求失败、隐式截断或结果不可重复；“预算封顶”只封了输出，没有封输入。 | 冻结 Manifest 时注入 `ModelResolver` 有效窗口，按实际渲染 token 预留输出/安全余量；超窗 fail closed，并将有效预算写入冻结快照。新增 4,096 窗口下 32,768 请求的失败测试。 |
| **P1** | TaskRunner `requestCancel()` 将持有 lease 的任务设为 `cancel_requested` 却保留 `lease_owner`；`claim()` 不接管 `cancel_requested`，`cancel()` 只允许原 owner 或空 owner。宿主在请求取消后崩溃时，该任务永久停留在 `cancel_requested`。 | 长任务恢复/取消不闭合，待处理队列会出现无法完成、无法重试的僵尸任务。 | lease 过期后允许新宿主接管取消收敛，或由持久取消协调器原子清空 owner；增加“owner 崩溃→另一宿主完成 cancelled→retry”反例测试。 |
| **P1** | 批任务恢复遇到已失败子任务时只计入 `failed` 并跳过，不会在父任务 `retry_task` 后重新执行该子任务（`local-fact-extraction-batch-service.ts` 的状态分支）。失败 Coverage 也没有“当前处置”指针。 | 更换模型后重试父任务仍会以失败计数完成；长篇中大量无效输出无法由批任务闭环修复。 | 明确 retry policy：父任务重试必须重试可重试子任务，或公开并持久化子任务重试入口；Coverage 使用 attempt/history + current disposition，最终投影只显示最新有效处置。 |
| **P1** | `artifact_dependencies` 只在 schema 中创建，活动 Application Service 没有写入或更新 `stale`；`ResearchDossier`、Recipe、Manifest 等 revision 也没有统一依赖边。 | 修改 ChapterContract、StorySystem、机制采纳或研究结论后，旧 Recipe/Manifest/Dossier 可能继续被当作当前资产；“依赖 stale 标记”退出条件未实现。 | 每次 Commit 原子登记依赖 `(artifact, revision) → (dependency, revision)`；上游 revision 变化时原子标记下游 stale；读取/提交对 stale 做 fail closed 或显式重建。 |
| **P1** | 完整 SourceEdition 的 span ID 仍使用原始 `span.id`（`analysis-corpus-service.ts:103`）；只有 `byteRange` Corpus 才加 segmentation 前缀。对同一原文建立第二个完整 segmentation（V1/V2、重新分段或用户修改）会在 `source_spans.span_id PRIMARY KEY` 冲突。 | 计划承诺的 V1/V2 对照、重新分析和“所有步骤可修改”在同一工作区不可持续；失败发生在提交时而不是保存时。 | 所有 span ID 纳入 segmentation 命名空间，或数据库改为 `(segmentation_id, span_id)` 约束并一次性破坏性迁移；增加两个完整 segmentation 的隔离 fixture。 |
| **P1** | `ChapterProductionCommitService` 对 V1 草稿的 `reviewLineage` 可以为空；`reviewLineage()` 遇到 V1 直接返回，正式接受只检查人类 actor、ChapterContract 和草稿存在。 | 可绕过三 Reader + Reviewer 直接把 Writer V1 设为正式章节，违背 R5 的 Writer→Reviewer→Editor 契约；R7 的 V1 接受样本曾执行 Reviewer，但代码没有强制这一事实。 | 明确“允许人工豁免”还是“Reviewer 必须存在”。推荐：V1 也必须绑定已完成 Reviewer；若允许豁免，必须生成显式 `review_bypassed` confirmation 和审计原因。 |
| **P1** | `automationMode` 只在 DataPolicy 中解析、保存和 UI 展示，活动服务没有任何按 `manual / supervised / autonomous` 分支或门禁。 | 用户选择 autonomous 不会自动编排，选择 manual 也不会统一阻止 Agent；设置项对行为是装饰性的，不能作为安全或产品承诺。 | 要么实现模式策略（哪些命令自动执行、哪些必须确认、失败是否暂停），要么删除该设置并把“supervised-only”写成真实契约；新增三模式行为矩阵测试。 |
| **P1（治理）** | 用户提供的计划正文仍写着“Tauri rusqlite 网关”和“API Key 放 `data/settings.json`”，同时又写“Node better-sqlite3/SecretStore”；当前 `AGENTS.md`/ADR 已明确相反：Rust 只管理 sidecar，Secret 仅来自运行时环境。计划正文与权威仓库规范相互矛盾。 | 后续 Agent 若按计划正文实现，会重新引入 SQL Rust 网关或把密钥写入文件，直接突破当前安全不变量。 | 将用户计划生成一个带版本号的“已裁决版”，删除过时双宿主/旧 Secret 段落，并在入口文档只保留一个权威链接；V1 legacy 的“继续可运行”也需改为“仅归档对照”，除非恢复入口。 |

### 本轮结论

这些断点不改变已经有直接证据的短篇 V2 分析、去来源化机制采纳、三 Reader/Reviewer 和人工接受 V1 样本；它们说明的是“可运行样本”尚不能外推为“可自主、可恢复、可重跑的长篇生产系统”。

在上述 P0/P1 未处理前，建议把 `engineering_release_ready` 的含义限定为“当前批准缩减范围的受控发布门”，不要把它解释为原始 R3/R5/R7 自动化退出条件。四个完成字段继续分开记录：

```text
engineering_release_ready = true             # 仅限批准的缩减范围与现有受控样本
approved_reduced_scope_complete = true
original_plan_complete = false               # Pipeline/预算/恢复/依赖等仍有断点
longform_product_validated = false
```

下一次审查应优先处理 Pipeline route + task lineage、ContextManifest 有效窗口和取消接管三项；它们分别决定“能否调用”“能否不超窗”“能否在长篇中恢复”，影响面高于继续增加分析字段或 UI 卡片。

### 当前完成字段

```text
engineering_release_ready = true
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false
```

后两项继续保持 `false`，因为《龙族Ⅰ》全量恢复、人工质量抽查、云端对比、真实 Editor V2 成功样本和三外部宿主安装态互操作仍没有直接证据。`production_commits.run_id` 绑定和真实安装用户帐户冒烟仍是发布前风险；SecretStore profile ID 碰撞已由编码后的环境变量名和 `secret-store.test.ts` 关闭。

## 第六轮对抗性重审：修复复核后的剩余产品断点（2026-08-10）

本轮先复核第五轮问题的实际修复，再从“设置是否真的改变行为”“上游变化能否使下游失效”“正式章节能否回溯到运行”“人类是否能看懂生产过程”四个方向继续构造反例。当前回归为 64 个测试文件、260 项通过；typecheck、lint、前端、CLI 与 MCP 构建通过。该证据不包含真实模型、真实 Tauri 有数据态或长篇恢复。

第五轮列出的 Pipeline 路由、Task 绑定、ContextManifest 有效窗口、取消接管、失败子单元重试、Coverage 最新处置、SourceSpan 命名空间和 V1 Reviewer gate 已有实现；但原计划仍不能判定完成，原因如下。

| 严重度 | 反例/直接证据 | 影响 | 关闭条件 |
|---|---|---|---|
| **P1** | **三档自动化仍不是三种完整行为**：`application-mcp-jsonrpc.ts` 只有 Pipeline 的 `pipelineAutoRun()` 读取 `automationMode`，且只区分 `manual` 与“非 manual”；普通 `start_local_creation`、FactExtractor、Writer、Reader、Reviewer、Editor 入口仍在任务 accepted 后无条件调用 `run()`。现有测试只验证设置保存和读取，没有 manual/supervised/autonomous 行为矩阵。 | manual 不能保证“只排队不执行”；supervised 与 autonomous 对普通任务没有可观察差异。设置页展示了尚未被全局执行的产品承诺。 | 建立统一 AutomationPolicy，并让所有任务入口调用；明确三档对“创建、自动运行、关键节点暂停、失败暂停、正式 Commit”的矩阵。至少测试 manual 只排队、supervised 在关键节点暂停、autonomous 自动推进普通任务，且高风险 Commit 始终确认。 |
| **P1** | **依赖失效只覆盖规划文档子集**：CreativeRecipe 仅登记 ChapterContract 依赖；没有登记所冻结 MechanismAsset revision 或采纳 revision。ResearchDossier 仍位于独立 `research_dossiers` 表，`getLatest()` 永远返回最高 revision，没有上游结论、反证和 Coverage 依赖或 stale 状态。 | 机制被撤销/改版后，旧 Recipe 与其 Manifest 仍可能继续向 Writer 提供旧机制；新增或修正研究结论后，UI 仍把旧 Dossier 显示为“最新”。 | 为 Dossier、Mechanism adoption、Recipe、Manifest 建立单一版本依赖模型；冻结时记录精确上游 revision，上游变化原子标 stale；所有读取与 ProductionCommit 对 stale fail closed。 |
| **P1** | **正式章节与具体生产运行仍断链**：`planCommitChapterProduction()` 向 `production_commits.run_id` 固定写入 `NULL`。Pipeline 节点虽已保存 `task_id` 和输出 hash，但 ProductionCommit 没有接收或验证 Writer/Reader/Reviewer/Editor 的 run/task lineage。 | 无法从正式正文反查实际运行、模型、成本和失败重放链；Pipeline 的“完成”与最终被接受章节仍是两条审计链。 | ProductionCommit 接收冻结的 production run/lineage 引用，校验所选 draft、Reviewer、Manifest 与运行一致，并原子写入非空 run_id 或专用 lineage 表。 |
| **P1（产品/UI）** | **R6 的“通过”超出直接证据**：作品页主要生产入口仍要求手写规划 JSON、ID 和 ProductionCommit JSON；没有统一展示 `ChapterContract → Recipe → Manifest → Writer → 3 Readers → Reviewer → Editor → Commit` 的章节生产链，也没有节点级 stale、阻塞原因、taskId、model 和 output hash。真实 Tauri 捕获仍被 Windows Graphics Capture 阻断，已有截图主要是浏览器空状态。 | 人类理论上可修改底层数据，但无法直观看到“本章怎样被生产、为什么被阻塞、上游变化使什么失效”，不满足“高度可干预且易读”的产品目标。 | 将 R6 降为部分完成；先交付一个只读章节生产链垂直切片和真实 SQLite fixture 数据态，再逐状态验收成功、失败、重试、stale、确认和版本选择。无需自由画布。 |
| **P1（治理）** | **用户附件计划仍不是可执行权威版本**：附件继续要求 Rust `rusqlite` 双宿主、`data/settings.json` Secret、可运行 V1 legacy；当前仓库 ADR/AGENTS 则是打包 Node sidecar、环境 SecretStore、legacy 只归档。 | 后续 Agent 按附件或按仓库会得到相反实现，继续产生安全和架构漂移。 | 生成带版本号的“已裁决执行计划”，删除被替代段落，并让 README、ADR、AGENTS 与完成度审计只链接同一个权威版本。 |
| **P2（回归证据）** | SourceSpan 已统一加 segmentation 命名空间，Coverage 已按最新处置投影，但当前测试没有明确覆盖“同一 SourceEdition 创建两个完整 segmentation 并拒绝跨 segmentation span”，也没有覆盖“failed 后 complete/no_pattern 时 Dossier 与 gaps 只看最新处置”的完整反例。 | 代码当前看似正确，但最关键的隔离和重试语义没有被精确锁定，后续重构容易复发。 | 增加两组最小反向测试，不需要扩大产品功能。 |

### 第六轮裁决

当前没有新的 P0；第五轮最危险的“Pipeline 必然调用无效地址”已经关闭。剩余 P1 集中在行为一致性、版本依赖、正式运行 lineage 与 UI 可理解性，都会在多章、重跑和人工干预时暴露，因此仍不能把原计划判为完成。

```text
engineering_release_ready = true             # 仅限当前批准缩减范围
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false

empty_state_visual = pass
information_architecture = mostly_pass
real_tauri_visual_capture = blocked
real_data_state_visual = not_validated
human_fine_grained_intervention_visual = partial
```

推荐关闭顺序：先统一 AutomationPolicy；再补齐 Dossier/Mechanism/Recipe/Manifest 依赖与 ProductionCommit lineage；最后做章节生产链只读视图和真实数据态视觉验收。继续增加分析字段、Prompt 或空状态样式的优先级都低于这三项。

## 第七轮修复复核：运行 lineage、失效传播与线性生产视图（2026-08-10）

本轮按第六轮关闭顺序实际修复并用反向测试复核，不把“新增字段”本身当作闭环。当前默认回归为 64 个测试文件、268 项通过；typecheck、lint、前端、CLI、MCP 与 Tauri 发布构建均通过。以下结论只覆盖代码和构建证据，不替代真实长篇、真实模型质量或桌面有数据态视觉验收。

| 第六轮断点 | 本轮修复与反向证据 | 对抗性裁决 |
|---|---|---|
| 正式章节无法回溯所选生产草稿 | `production_commits.lineage_json` 现在非空保存所选草稿 document/revision、真实 `executionRef`、Manifest、Review、模型与可解析的 Pipeline `runId`；Writer 使用真实 taskId，外部 Agent/人工直接创建 Editor 草稿使用 commandId，不再制造空 taskId。读取接受章节时会校验 lineage 与正文、Manifest、Review 链一致。 | 章节到所选草稿的 lineage 断点已关闭。直接 MCP/CLI 路径允许 `runId = null`，因此不能声称所有正式章节都来自 PipelineRun。 |
| ResearchDossier 永远把最高 revision 当作当前事实 | `research_dossiers.stale` 已进入 schema；事实、线程、Brief/approval、结论、反证、ReadingMap 与失败 FactExtractor 等上游写入会使当前 Dossier stale，`getLatest()` 只返回非 stale 版本。冻结后新增结论的反例返回 `null`。 | 当前 Dossier 的 fail-closed 语义已关闭；这不是“全依赖图已统一”的证明。 |
| Mechanism 改版后旧 Recipe/Manifest 仍可用于生产 | MechanismAsset 纳入 artifact revision；Recipe 冻结时登记 ChapterContract 与每个机制的精确 revision，Manifest 复制机制依赖；依赖只接受 `current_revision = requested_revision`。机制更新会使 Recipe/Manifest stale，读取和 ProductionCommit 均 fail closed。 | 已覆盖当前 Mechanism → Recipe → Manifest → Commit 路径；未扩张为任意 artifact 的递归依赖引擎。 |
| `automationMode` 只展示、不统一改变任务行为 | 新增统一 `AutomationPolicy` 并接入本地创作、备份/恢复/导出、FactExtractor、Writer、三 Reader、Reviewer、Editor 与 Pipeline。`manual` 新任务只排队，但显式 resume 可执行；`supervised/autonomous` 可自动运行普通任务；所有模式的正式 Commit/高风险动作仍需持久 confirmation。CLI 增加 `resume-local-creation` 回归。 | manual 的基本安全语义已关闭。`supervised` 与 `autonomous` 尚未成为完整不同的自动编排产品，且 confirmation 获批后没有通用任务 dispatcher，不能把它们描述为“无人值守全自动”。 |
| Segmentation/Coverage 最关键隔离语义缺少精确反例 | 同一 SourceEdition 的两个完整 segmentation 现在产生独立 span ID；AnalysisProject A 明确拒绝 segmentation B 的 SourceSpan。Coverage 从 failed 转为 `complete` 或 `no_pattern` 后，投影只显示最新处置；`no_pattern` 保留为已检查但无模式的合法结果。 | 第六轮 P2 回归缺口已关闭。 |
| 改写 0001 后旧库可能以旧形状启动 | 启动指纹增加 `research_dossiers.stale` 与 `production_commits.lineage_json`；删除任一字段的旧形状数据库会被直接拒绝，不补列、不迁移、不 fallback。 | 对本轮新增关键形状已 fail closed；这不是任意 schema 漂移检测器。 |
| 人类看不见章节如何被生产 | QueryService 新增固定线性 `productionChains`：ChapterContract → Recipe → Manifest → Writer V1 → 三 Reader → Reviewer → Editor V2/V3 → ProductionCommit。每个节点投影 status、revision、executionRef、model、outputHash、stale 与 blockingReason；作品页只读展示该链，不引入自由画布或 UI 直连 SQL。 | 代码垂直切片已交付；真实 Tauri + SQLite 有数据态尚未视觉验收，不能把 R6 判为全部通过。 |

### 第七轮视觉证据边界

浏览器开发预览的 DOM 与三栏布局计算正常，但本轮截图出现文字竖排、内容被压入左侧窄栏的渲染异常。该截图标记为无效证据，不用于通过判定。新增章节生产链没有真实 Tauri 有数据截图，故视觉字段保持：

```text
preview_screenshot = invalid
empty_state_visual = pass                         # 仅指此前已核查的空状态
information_architecture = mostly_pass
real_tauri_visual_capture = blocked
real_data_state_visual = not_validated
human_fine_grained_intervention_visual = partial
```

### 第七轮完成门

本轮关闭了第六轮列出的主要代码断点，但没有产生《龙族Ⅰ》全量恢复、长篇人工质量抽查、云端对比、真实 Editor V2 成功样本、三个外部宿主安装态互操作或真实桌面有数据视觉证据。因此四个字段不变：

```text
engineering_release_ready = true             # 仅限当前批准缩减范围
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false
```

本轮发布级复跑的直接证据：`npm test` 为 64/268；typecheck、lint、前端、CLI、MCP、4 项 Rust 测试和 `npm run tauri build` 均通过；Tauri 生成 exe、MSI 与 NSIS，仅保留既有的 `.app` bundle identifier 建议。当前 MCP 实际协商 `protocolVersion=2025-06-18`，返回 114 个领域工具，关键工具无缺失，禁止的通用文件/SQL 工具为 0。发布目录密钥值模式扫描为 0 命中，扫描明确排除且未读取 `data/settings.json`。

剩余最高价值验证按顺序是：真实 Tauri 有数据态逐状态视觉验收；恢复长篇/模型质量验证；补齐 Reviewer/运行级 lineage 并在 Codex、Claude Code、OpenCode 三个真实宿主中做安装态互操作。继续增加分析字段或 UI 装饰不能替代这些证据。

## 第八轮真实 Tauri 对抗性复核：发布路径、数据态与状态语义（2026-08-10）

本轮不再以浏览器空状态或单元测试替代桌面事实，直接启动 release `ainovr.exe`、打包 Node sidecar 和 Roaming 工作区。由此发现并关闭两个会让发布版完全无法启动的 P0，同时修正一个会误导人工判断的状态投影。

| 严重度 | 反例与根因 | 修复与直接证据 | 裁决 |
|---|---|---|---|
| P0 | Tauri 把资源目录打包到 `resource_dir/resources/desktop-sidecar`，Rust 却从 `resource_dir/desktop-sidecar` 启动 companion；release 首屏直接报告 companion missing。 | `release_sidecar_directory()` 固定解析打包布局，并用 Rust 反向测试锁定；重新打包后 release `ainovr.exe` 与内置 `resources/desktop-sidecar/node.exe` 同时启动。 | 已关闭。 |
| P0 | Tauri 的 Windows 路径可能带 `\\?\`/`\\?\UNC\` verbatim 前缀；旧 Node 版本会错误解析带驱动器的 verbatim 路径并使 sidecar 退出。 | `node_process_path()` 在传给 Node 前规范化 executable、script 和 workspace 路径；驱动器、UNC 与普通路径均有 Rust 测试。打包 companion 的 MCP initialize 已成功返回 `protocolVersion=2025-06-18`。 | 已关闭。 |
| P1（UI 语义） | `ChapterContract` 为 `pending_review` 时，节点已有 artifact，通用投影却把 `blockingReason` 留空，UI 因而显示“当前节点已具备可用产物”。 | 先新增反例测试。初始夹具因复用 `command_001/idem_001` 被幂等层正确短路；修正唯一命令身份后测试真实变红，证明产品缺陷。`taskBlockingReason()` 现在返回“等待人工审核当前 revision。”，targeted 与完整回归转绿。 | 已关闭。 |

真实 Roaming 工作区已建立不含 Secret 的视觉 fixture。真实 Tauri accessibility tree 已逐页确认：

- 作品页存在两章、固定生产链、revision/status/output hash/stale/阻塞原因，以及 Canon/ReaderPromise 空态；
- 参考页显示 SourceEdition、SourceSpan 半开区间、source/exact hash、ReadingMap、FactLedger、ThreadGraph 与合法 `no_pattern`，不直接铺开原文；
- 待处理页显示持久 confirmation、queued task、Coverage gap 与待审核 BookOutline/StagePlan/ChapterContract；
- 设置页显示 Provider 协议/预算/角色路由、Workspace 策略与线性 PipelineRevision，不显示 Secret、自由画布、SQL 或任意文件工具。

这一证据只证明真实 Tauri 的结构、文本、状态和控件投影。Windows Graphics Capture 仍以 `SetIsBorderRequired failed: 0x80004002` 失败，因此没有合格位图截图，不能声称视觉排版、截断、重叠和颜色层级已经通过。最新 rebuild 后再次启动 release，主进程和打包 sidecar 进程均存在；`pending_review` 的新文案由应用层回归证明，尚未取得新的桌面位图。

本轮发布级复跑：

```text
npm test             64 files / 269 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
cargo test           6 passed
npm run tauri build  passed; exe/MSI/NSIS generated
```

完成门继续保持分离：

```text
engineering_release_ready = true             # 当前批准缩减范围
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false

real_tauri_process_launch = pass
real_tauri_data_state_uia = pass_structural
real_tauri_bitmap_capture = blocked
human_fine_grained_intervention_visual = partial
```

原计划仍不能关闭：没有《龙族Ⅰ》全量可恢复分析与人工质量抽查、真实 Editor V2 成功样本、Codex/Claude Code/OpenCode 三宿主安装态互操作，也没有真实桌面位图级数据态验收。结构化 UIA 证据不能替代这些产品门。

## 第九轮安全与发布重审（2026-08-10）

本轮专门反证“已由人工确认的 Provider 端点”是否仍可能在运行时扩张为未核对目标。结论是此前仍有两处边界没有在代码中固定；均已按先失败后修复关闭。

| 严重度 | 反例 | 修复与直接证据 | 裁决 |
|---|---|---|---|
| P0 | 云端调用的 `fetch` 默认可跟随 HTTP 3xx。即使不同实现通常会处理跨域 Authorization，不能让 Secret 边界依赖该默认行为；已确认的 base URL 可被服务端重定向为另一目标。 | `routed-model-caller` 的云端 `fetch` 明确采用 `redirect: "error"`；新增 runtime 回归断言该选项存在。 | 已关闭；重定向现在 fail closed。 |
| P0 | `save_provider_profile` 接受非回环 `http://` 的 Chat/Responses Provider。运行时会为此类路由附加环境 Secret，等同允许明文传输；同时 UI 标为“仅本机”的 `ollama_native` 也缺服务端强制。 | Provider 保存边界现在只允许回环 HTTP（本地/原生 Ollama）或远程 HTTPS（Chat/Responses）。新增 CommandService 反例分别拒绝明文远程与远程 Ollama。 | 已关闭；此规则同时作用于 UI、CLI 与 MCP。 |
| P1 | 上一轮 release 重建首次失败。根因不是代码或测试，而是已启动的 `ainovr.exe` 锁住打包 sidecar 的 `node.exe`，Windows 无法覆盖资源。 | 关闭该工作区启动的旧 release 后重新构建。MSI 于 14:15、NSIS 于 14:16 重新生成；构建日志明确列出两个 bundle 完成。 | 已验证发布构建；构建前需关闭运行中的桌面 release 是 Windows 的操作约束，而非产品功能失败。 |

本轮直接执行的验证为：

```text
npm test                 64 files / 274 tests passed
npm run typecheck        passed
npm run lint             passed
npm run build            passed
npm run build:cli        passed
npm run build:mcp        passed
cargo test               6 passed
npm run tauri build      passed; MSI and NSIS regenerated
```

位图/UI 证据仍按严格标准处理：早期竖排布局截图、空项目误显示读取状态的截图，以及出现 `desktop MCP sidecar is unavailable` 红条的 Tauri 图，均不可作为通过证据。当前只有 release retry 的有数据图可证明四个一级入口、线性章节生产链、Reference 的 SourceSpan/Hash/Coverage 与待处理/设置的结构；它们不能证明完整的细粒度交互易用性，也没有覆盖“更新既有 Provider 后进入待确认”的新状态。

因此完成门保持不变：

```text
engineering_release_ready = true             # 仅限已批准缩减范围
approved_reduced_scope_complete = true
original_plan_complete = false
longform_product_validated = false
```

此外，用户附件中的旧决策仍含 `data/settings.json` Secret、Rust `rusqlite` 双宿主和活动 V1 legacy 等已被现行 `AGENTS.md`/ADR 替代的条目。它只能作为需求来源，不能再作为实现权威；后续执行应以仓库内现行架构约束为准，避免重新引入已删除的 Secret 与双真相路径。

补充：运行时的 `cloudEndpoint()` 也只接受 HTTPS。因此即使旧 SQLite 在本轮规则前已存有明文远程 Provider，调用会在网络请求前 fail closed；新增回归验证该情况下不会调用 `fetch`。

## 第十轮配置可执行性复核（2026-08-10）

发现并关闭一个“设置可保存、任务必失败”的路由组合：本地回环地址曾允许选择 `responses`，但当前本地调用器只支持 Ollama 原生和 OpenAI Chat Completions；同样，遗留的远程 `ollama_native` 会落入云端调用器的 Chat Completions 分支。

- `save_provider_profile` 现在拒绝本地 Responses；
- `ModelResolver` 对旧数据库中的本地 Responses、远程 Ollama 原生配置均 fail closed；
- `routed-model-caller` 在网络请求前拒绝远程 Ollama 原生，防止协议降级；
- 设置页明确写出“本地回环只支持 Ollama 原生或 Chat Completions；Responses 仅用于 HTTPS 远程 Provider”。

三个新反例覆盖保存、旧持久化配置解析和运行时 caller。它们不改变长篇、三宿主或真实 Editor V2 的未完成判断。

本轮回归：`npm test` 64 files / 276 tests passed；typecheck、lint、前端、CLI、MCP 构建通过；Tauri MSI/NSIS 于 15:09 重新生成。唯一既有警告仍是 macOS bundle identifier 建议，不影响 Windows 发布。

## 第十一轮 Editor V2 失败路径复核（2026-08-10）

领域 CLI 对隔离 `r7-editor-v2-20260810` 工作区的失败任务只返回 checkpoint 与安全诊断：结构化 JSON 修复完成后，`validateChapterEditorDraft` 因“改动必须完全落在选定 Reviewer 问题的精确范围内”拒绝输出。该路径没有泄漏 Prompt、原始模型输出或正文。

本轮没有放宽该范围门。相反，Editor Prompt 现在把唯一可替换的原文字面量单独、明确写出，并要求 `replacement` 不得带入前后句、标点或解释；任务服务回归先失败后通过。尝试在同一章节再次创建 V2 任务时，TaskRunner 正确以相同 `resource_key` 拒绝重复排队，因此新 Prompt 尚未获得新的真实模型成功样本。这个阻断是正确的并发/幂等行为，不能被删除来制造验证结果。

结论：范围失败的可理解性和 Prompt 已改善，但 **真实 Editor V2 成功样本仍未形成**；R7/长篇完成门不变。

## 第十二轮：Pipeline 顺序与长篇路由可复现性（2026-08-10）

本轮针对“冻结的 Pipeline 是否只是名称冻结、长篇恢复是否可能静默换模型”执行了反例修复：

- `PipelineStep` 现在必须持久化 `dependsOn`（空数组也显式保存）；保存与运行快照均拒绝未知、重复、自依赖和循环依赖。
- `complete_pipeline_run_step` 与受支持的 `execute_pipeline_run_step` 都先检查前置节点已完成；`human_review` / `agent_action` 不再显示或接受为自动执行节点。
- PipelineRun 创建时，CLI/MCP/桌面 sidecar 通过同一 `ModelResolver` 冻结每个可执行模型角色的无 Secret route（provider profile、endpoint、model、protocol、有效窗口、输出与安全余量）到 RunSnapshot；执行时只读取该快照，缺少快照 fail closed。
- 长篇 FactExtractor 批任务也在父任务入队时冻结同一 route，后续子单元与断点恢复不重新解析已变更 Provider。

新增回归覆盖循环依赖、跳过前置复核、`human_review` 自动执行拒绝、RunSnapshot route 读取，以及批任务在 Provider 变更后仍把原始冻结 route 传入每个子任务。当前默认回归的计数应以本轮最终复跑为准；这些代码门不能替代《龙族Ⅰ》全量恢复或真实 Editor V2 成功样本。

## 第十三轮：Pipeline 控制面与事务级顺序复核（2026-08-10）

第十二轮的服务层前置检查仍不足以证明顺序不可绕过：若两个写入在检查后交错，或内部调用者直接使用 `CommandService`，后置节点原先可在 SQL 更新时不再复查其 `dependsOn`。同时，MCP 的 `save_pipeline_revision` schema 未公开 `execution` / `dependsOn`，外部 Agent 无法通过项目规定的主要控制面表达完整 Pipeline。

| 严重度 | 反例 | 修复与直接证据 | 裁决 |
|---|---|---|---|
| P0 | 仅在 `PipelineRunService.completeStep()` 预读依赖，`complete_pipeline_run_step` 的事务更新没有约束；绕过服务层或并发交错可能把后置节点写成完成。 | `planCompletePipelineRunStep()` 的目标 `UPDATE` 现通过冻结 RunSnapshot 的 `json_each(...dependsOn)` 在同一 SQLite 事务内要求每个前置 `run_node` 已为 `completed`；直接命令层的反例得到 fail-closed `error`，服务层入口仍返回可读的 `blocked`。 | 已关闭；顺序门同时存在于服务层与提交事务。 |
| P1 | MCP schema 只允许 `id/tool/enabled/config`，即使底层实现已支持依赖与执行分类，Codex/Claude Code/OpenCode 也不能以工具契约声明它们。 | `save_pipeline_revision` schema 现在公开可选的 `execution`（`executable/agent_action/human_review`）和 `dependsOn`；`tools/list` 回归确认这两个字段可发现。 | 已关闭；外部 Agent 与桌面 JSON 编辑器使用同一字段。 |

本轮重新执行的直接验证：

```text
npm test             64 files / 279 tests passed
npm run typecheck    passed
npm run lint         passed
npm run build        passed
npm run build:cli    passed
npm run build:mcp    passed
cargo test           6 passed
npm run tauri build  passed; MSI and NSIS regenerated
git diff --check     passed
```

视觉证据没有因此扩大：现有 22 张 PNG 已逐图判定，但没有显示本轮新增的 MCP schema、依赖禁用态或事务行为；它们依然只能作为历史空态/结构性证据。四个完成字段不变，尤其不能把这次工程门修复解释为长篇生产产品已经验证。
