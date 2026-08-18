# Project: Ainovr（最终重构）

> 外部 Agent 主导的小说分析与原创生产执行环境：Ainovr 保存项目事实、版本、证据、任务与审计，并提供可选桌面工作台。

## 当前架构

```text
Tauri UI ─→ Rust `desktop_mcp_request` ─→ 打包 Node MCP sidecar ─┐
CLI / stdio MCP ────────────────────────────────────────────────→ WorkspaceApplicationService
                                                                   ├→ CommandService / QueryService / TaskRunner
                                                                   ├→ SQLite（data/ainovr.sqlite3）
                                                                   └→ ObjectStore（data/objects/<sha256>）
```

- `src/App.tsx` 只挂载 `components/workbench/AinovrWorkbench.tsx`；一级导航固定为“作品 / 参考 / 待处理 / 设置”。不要恢复内置聊天或自由画布入口。
- UI 通过 `src/runtime/desktop-workspace-application.ts` 调用受限 MCP 领域通道；组件不得直接持有 SQL、对象路径、sidecar stdin 或旧 JSON Store。
- `src/cli/index.ts` 和 `src/mcp/server.ts` 分别组装 Node CLI 与 stdio MCP，二者调用同一 Application Service 与领域服务。
- Node sidecar/CLI/MCP 使用 `better-sqlite3`；Tauri Rust 仅承担打包 sidecar 生命周期、固定工作区定位和 JSON-RPC 输入边界。Rust 不暴露 SQL、对象 hash 或文件 RPC；小说领域规则仍留在 TypeScript。

## 不变量与安全边界

1. SQLite/Application Service 是唯一业务真相。所有写入经 `CommandService`，读取经 `QueryService`，长任务经 `TaskRunner`；UI、MCP、CLI 与内部 Agent 不得直连 SQL、JSON Store 或 Zustand 业务状态。
2. 正文、原文、完整 Prompt、上下文和模型原始输出先写入 ObjectStore，再由 SQLite 事务提交对象引用；不要把大文本塞进 SQLite。
3. 一个命令对应一个事务。更新命令携带 `expectedRevision`，重试复用 `idempotencyKey`；CAS 冲突不得静默覆盖。
4. LLM 与外部 Agent 调用永远不在数据库事务内；模型输出必须经领域 Commit 才成为项目事实。
5. API Key 只属于运行时 SecretStore（当前 Node CLI/MCP 从进程环境读取），绝不读取、打印、回显、导出、记录或传入 SQLite、ObjectStore、日志、审计或 Prompt；不要重新引入 `data/settings.json` 或旧配置脚本。
6. Writer 只能读取已采纳、去来源化的机制投影。Writer ContextManifest 不得包含参考作品书名、人物、剧情、原文或 provenance。
7. MCP/CLI 只暴露领域命令。禁止添加 SQL、任意路径读写、`read_data_file` 或 `write_data_file` 工具。
8. 删除、外部绝对路径导入、恢复/覆盖等高风险动作必须走持久 confirmation；Agent 代用户批准时记录 `human_via_agent`，并重新检查命令 Hash、revision、策略和目标。

## 分析与生产契约

```text
SourceSpan → FactLedger → ThreadGraph → AnalysisBrief / ResearchQuestion
→ 独立反证 → ResearchDossier → MechanismAsset → 人工采纳
→ CreativeRecipe → ContextManifest → Writer / Reviewer / Editor → ProductionCommit
```

- 支持性结论必须能回到合法 `SourceSpan`、`sourceHash`、`exactTextHash` 与规范化 UTF-8 半开区间；允许 `unknown`、`not_observed`、`no_pattern` 与 `not_applicable`。
- 解释型分析必须包含研究问题、反例、替代解释、边界和生产用途；不得猜测作者意图，也不得把慢节奏自动称为“水”。
- distributed 机制至少跨三个分析单元并完成反证；机制采用前必须能写成去来源化的 `when / do / avoid`。
- 生产规划顺序为 `ProjectIntent → StoryConcept ×3 → StoryContract → StorySystem → 全书/阶段/章节规划 → ChapterContract`。
- 单章最多三版：Writer V1 → 独立 Reviewer → 定向 Editor V2 → 可选 V3。第三版绝不自动覆盖人工选定的较早版本。
- `ProductionCommit` 必须原子更新接受正文、ChapterDelta、Canon、人物知识、ReaderState/Promise、Outline Drift、Manifest、模型与审计；失败或冲突时整体回滚。

## 关键文件

| 文件 | 用途 |
|---|---|
| `src/application/workspace-application-service.ts` | Command/Query 投影、审计、确认、Coverage 与领域事务计划。 |
| `src/application/task-runner.ts` | lease、heartbeat、checkpoint、取消与恢复。 |
| `src/application/*-service.ts` | 参考分析、机制、规划、ContextManifest、Writer/Reader/Reviewer/Editor 与提交的领域服务。 |
| `src/persistence/node-sqlite-driver.ts` | Node SQLite 适配器、WAL/迁移/未来 schema 拒绝。 |
| `src/persistence/node-object-store.ts` | Node 内容寻址对象存储。 |
| `src/runtime/desktop-workspace-application.ts`、`src-tauri/src/lib.rs` | Tauri 受限领域 RPC 客户端与打包 Node MCP sidecar 生命周期。 |
| `src/cli/workspace-cli.ts` | CLI 到领域服务的薄适配。 |
| `src/application/application-mcp-jsonrpc.ts` | MCP 领域工具 schema 与 JSON-RPC 分发。 |
| `src/components/workbench/AinovrWorkbench.tsx` | QueryService 投影、change feed 刷新与四个桌面工作台。 |
| `docs/adr/0001-final-rebuild-architecture.md` | 最终重构的权威架构决策。 |
| `docs/rebuild/` | R0–R8 基线、验证、恢复与完成度审计。 |

## 开发命令

| 命令 | 用途 |
|---|---|
| `npm test` | 默认 Vitest 回归，排除真实 API 测试。 |
| `npm run typecheck` | TypeScript 严格检查。 |
| `npm run lint` | ESLint。 |
| `npm run build` | TypeScript 检查与 Vite 前端构建。 |
| `npm run build:cli` | 构建 Node 领域 CLI。 |
| `npm run build:mcp` | 构建 stdio MCP companion。 |
| `npm run tauri build` | 构建桌面发布物。 |
| `npm run test:real` | 显式 opt-in 的真实模型探索测试。 |

## 约定

- TypeScript 为严格模式，路径别名 `@/*` 指向 `src/*`；纯逻辑文件使用 kebab-case，React 组件使用 PascalCase。
- 中文用于 UI、注释、Prompt 与用户可见文档。
- 依赖单向：纯领域/规则 → persistence/ObjectStore → Application Service → runtime adapter → UI store（仅选择和草稿）→ React 组件。领域层不得 import React、Tauri、MCP 或 Zustand。
- 测试镜像源码，默认测试不得依赖真实 API、用户数据或运行时 Secret；真实模型测试只放在 `src/__tests__/real-api/` 并显式运行。
- **TDD Iron Law**：产品行为先写失败测试，再最小实现、重构并运行相关回归。脚手架、纯渲染壳、运行时组装和治理文档可豁免，但要在代码或提交说明中标明。
- 工作树可能长期为脏；所有既有改动视为用户资产。不要执行 `git reset --hard`、`git checkout --`、`git clean`，也不要自动 stage、commit 或 push。
- 新迁移只前进；迁移前备份数据库和对象引用清单。高于已知 `schema_version` 的库必须拒绝启动且不修改。

## 验证与交付

- 修改领域、持久化、MCP、CLI、分析或生产行为后，先运行相关失败测试，再至少运行 `npm test`、typecheck、lint、build、build:cli 和 build:mcp。
- 发布前额外运行 `npm run tauri build`、Secret 扫描、备份恢复、便携目录移动与 MCP `tools/list` 冒烟；发布物和导出物不得包含 API Key。
- 不要把探索性本地/云端模型调用或候选正文称为模型资格认证或已接受章节；以 `docs/rebuild/final-completion-audit-2026-08-08.md` 的直接证据判断完成度。
