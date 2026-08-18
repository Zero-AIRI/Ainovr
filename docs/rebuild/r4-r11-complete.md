# R4–R11：Agent 文档创作闭环完成记录

日期：2026-08-05。

本轮把 R3 的作品工作区继续向下贯通为一条正式 Agent 章节生产主链。旧 `tpl_novel_chapter_production_v1` 继续作为高级画布兼容模板，但不再代表普通写作的默认方法。

## R4：Context Manifest

- `executeManifestBoundAgentTask` 是正式生产 Agent 的唯一调用入口。
- 调用前保存计划 Manifest，调用后保存实际读取、实际 token 和诊断。
- 未读、读取失败、截断或读取禁止文档都会 `fail closed`，产物不能提交。
- Agent 生成的已批准细纲和当前主稿也会成为 Manifest 文档，不再绕过读取审计。
- session 与 Manifest 保存到 `data/projects/{projectId}/agent-production/`。
- 完成 Manifest 同时保存任务 Prompt、实际输入、Provider、模型和结构化输出，作品页可逐任务展开核对。

## R5–R6：详细细纲、单主稿和局部问诊

- 详细细纲覆盖时间、地点、进入/退出状态、人物欲望、冲突、压力、转折、必做/禁做事件、物件/认知变化、情绪周期和下一章接口。
- Outline Reviewer 未通过时不会调用 Writer。
- 每章 Writer 只生成一次完整主稿；后续变化使用带父版本的 revision。
- span 问诊是独立 Manifest 任务，返回问题定位、上下文关系、原因、三个方案、影响范围和推荐方案。

## R7–R8：独立评审和大纲对账

- 故事、连续性、文本、原创性和三类 Reader 使用不同 Manifest，`conversationHistory` 固定为空。
- 质量门只消费带位置和证据的问题；夸赞字段不参与通过判断。
- 阻断问题会暂停生产，不会静默进入 Canon。
- Outline Drift 支持 `wording_only / local_improvement / state_change / future_dependency / canon_conflict` 等类型和正文/大纲/人工裁决建议。
- 监督模式在正文、大纲提案和 Canon patch 提交前暂停；人工确认产生正式 session commit。

## R9：分析覆盖和生产准入

R9 复用并接入仓库已有的证据链能力：

- SourceSpan 原文证据和分析审阅示例。
- coverage ledger 的未提取、预算跳过、请求失败和模块关闭原因。
- MechanismCard 的证据实例、反证和人工 adoption。
- TransferBundle 白名单投影；Writer 不读取证据 span、源作观察或反证记录。

## R10：自动化与外部 Agent

- `manual`：完成当前人工启动步骤后暂停。
- `supervised`：自动完成细纲评审、主稿、独立评审和对账，在提交前暂停。
- `autonomous`：质量门通过时自动提交；Canon 冲突或人工裁决建议会暂停。
- 外部工具面覆盖文档查询/revision、读取策略、Manifest、问诊、评审和大纲对账。
- 查询统一经过 DomainQueryService，文档修改统一经过 DomainCommandService；MCP transport 不得直写文件。
- `dist-mcp/ainovr-mcp.mjs` 是可连接的 stdio MCP companion，已实测 `initialize`、`tools/list` 和领域工具调用；Node 文件适配器限制在工作区 `data/`。
- 项目级协调器跳过已接受章节，每章提交后刷新文档树并继续；调用预算、Canon 冲突、人工裁决或持久化失败会立即暂停。
- 逻辑 commit 会写入正文/细纲/评审/对账 revision，同时推进 NovelProject 和 BookProductionState 的机器 Canon revision。

## R11：验收

确定性端到端测试覆盖：

- 一章完整短篇。
- 十章长篇顺序生产。
- 每章均包含 Manifest、已批准细纲、一次 Writer 主稿、五类独立评审、Outline Drift 和提交。
- 复用既有 full-book run、ChapterRevision 和 external-agent tests 验证失败恢复、非破坏回滚和外部接管。

真实本地模型验收：

- `qwen3.5:9b` 通过 Ollama OpenAI 兼容端点完成一章完整链路。
- 实际执行包含详细细纲、Outline Reviewer、一次 Writer 主稿、五类独立评审和 Outline Reconciler，耗时约 105 秒。
- 真实验收发现并修复了本地模型空列表、自由对象和不完整 JSON 问题；所有任务现使用严格 JSON Schema，非 Writer 仅允许一次结构修复重试，Writer 仍只生成一次主稿。
- 十章长篇由项目级协调器的确定性端到端测试覆盖，验证逐章保存、恢复、暂停和不重复 accepted 章节；不会用十章真实模型重复调用作为默认回归。

真实 Provider 已通过 `createAgentCreationCaller` 接入角色路由，模型字段保持空字符串并回退 settings。当前创作角色已用 `npm run configure:local-creation` 路由到本地模型，不产生远程 API 费用。

完成时验证：

- `npm test`：1097 通过，13 跳过，0 失败。
- 本地真实 Agent 创作测试：1 通过，0 失败。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run build:mcp`：通过，stdio smoke test 通过。
- `npm run tauri build`：通过，生成便携执行文件、MSI 和 NSIS 安装包。
