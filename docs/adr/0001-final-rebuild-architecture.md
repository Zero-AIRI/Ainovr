# ADR-0001：Ainovr 最终重构架构

- 状态：接受
- 日期：2026-08-08
- 决策者：项目负责人
- TDD 状态：治理/架构文档豁免；不含产品行为改动

## 背景

旧实现将业务事实分散在 JSON 文件、Zustand、UI 和 MCP 适配器中。它可以运行单次工作流和旧的 Agent 创作链，但无法保证版本、证据、确认、长任务恢复和原子 ProductionCommit 的一致性。新版产品的目的不是内置聊天或自由画布，而是为外部 Agent 提供可靠的小说分析与生产执行环境。

## 决策

### 1. 产品定位与 UI

Codex、Claude Code、OpenCode 等外部 Agent 理解人类意图并通过 stdio MCP/CLI 编排。Ainovr 提供 Application Service、项目真相库、对象库、版本、证据、审计、确认、TaskRunner 和可选可视化工作台。

UI 固定为“作品 / 参考 / 待处理 / 设置”四个一级入口，展示线性流程、版本、证据、阻塞和下一步。内置聊天和自由拖拽画布不再是产品主入口；底层 DAG 可以保留，但不能成为业务真相。

### 2. 唯一真相与受信 Node 宿主 SQLite

`data/ainovr.sqlite3` 是唯一业务真相。所有读取经 QueryService，所有写入经 CommandService，所有长任务经 TaskRunner。UI、MCP、CLI、内部 Agent 都不能直连 SQL、JSON Store 或 Zustand。

SQLite 只由 Node Application Service 宿主通过 `better-sqlite3` 访问。CLI 与 stdio MCP 直接组装该宿主；桌面端由 Rust 启动打包的 Node MCP sidecar，并且 WebView 仅可调用 `desktop_mcp_request` 这一 JSON-RPC 边界。Tauri 不公开 SQL、对象 hash 或任意路径 RPC，也不再实现 `SqlDriver`。所有领域规则保持 TypeScript。

数据库使用 WAL、foreign keys、`busy_timeout=5000`、`synchronous=NORMAL` 与 `BEGIN IMMEDIATE`。迁移只前进，迁移前建立备份；面对更高 `schema_version` 时拒绝启动而不改库。桌面发布物打包 Node runtime、MCP bundle 与所需原生 SQLite 依赖，不能依赖用户已安装的 Node。

### 3. 对象存储与安全边界

正文、原文、完整 Prompt、实际输入、模型原始输出和大型上下文进入 `data/objects/<sha256>` 内容寻址对象库。写入顺序为临时文件、Hash/长度校验、原子 rename、再由数据库事务提交引用。事务失败产生的孤儿对象暂时保留。

API Key 仅存在于运行时 SecretStore；当前 Node CLI/MCP 只从启动进程的环境变量读取。它不进入 SQLite、对象库、导出、日志、审计或 Agent 上下文。不得重新引入 `data/settings.json`。MCP 不提供 SQL、数据库文件或任意工作区文件读写工具；导入/导出均受固定路径与确认策略限制。

### 4. 分析—生产边界

参考分析的正向链为 `SourceSpan → EvidenceInstance → Observation → Conclusion`，并保存 `sourceHash`、`exactTextHash` 和规范化 UTF-8 区间。解释允许未知与弃权，必须有反例、替代解释、边界和生产用途。

MechanismAsset 只有经人工采纳、去来源化并投影为 CreativeRecipe 后才能进入 Writer。Writer 不读取参考作品的名称、人物、剧情、原文或 provenance。章节生产使用冻结的六层 ContextManifest，经过 Writer、独立 Reviewer、定向 Editor 的最多三版循环，并由原子 ProductionCommit 同时更新正文、Canon、人物知识、Reader 状态/承诺、Outline Drift、版本和审计。

### 5. 外部 Agent 控制面

V1 控制面只提供本机 stdio MCP 和薄 CLI。其工具按工作区、任务、确认、参考、分析、机制、管线、作品、文档、规划、生产、导出/批量等领域暴露，调用同一 Application Service。无 HTTP/WebSocket 控制面。

长任务采用队列、lease、heartbeat、checkpoint、取消、重试和恢复。确认持久化保存；通过 Agent 获得的用户批准必须记录为 `human_via_agent`，并在批准时重新检查命令 Hash、revision、数据策略、诊断和目标资源。

## 后果

- 旧 JSON 业务数据不迁移、不双读、不双写。公开仓库不携带 legacy 运行时；本地封存 bundle 保留回溯能力。
- Rust 只允许作为桌面 sidecar 的固定生命周期与输入边界；它不得重建小说领域规则、SQL 网关或对象读取 API。
- R1 前不大规模改分析 Prompt；R4/R5 前不重做 UI。每个 R 阶段必须以失败测试、最小实现、全套回归和独立提交推进。
- 现有旧 Agent 创作闭环仍可作为质量与本地模型路由参考，但其 JSON 持久化不能被标记为最终真相架构。
