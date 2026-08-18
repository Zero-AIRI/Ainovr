# Ainovr

[![Windows clean-clone gates](https://github.com/Zero-AIRI/Ainovr/actions/workflows/clean-clone-verify.yml/badge.svg?branch=main)](https://github.com/Zero-AIRI/Ainovr/actions/workflows/clean-clone-verify.yml)

Ainovr 是一个面向小说参考分析与原创生产的本地执行环境。它不是内置聊天机器人：Codex、Claude Code、OpenCode 等外部 Agent 负责理解与编排；Ainovr 负责把项目事实、证据、版本、确认、长任务和生产提交可靠地保存下来，并提供可选的桌面工作台。

当前桌面入口固定为“作品 / 参考 / 待处理 / 设置”。它展示线性、可展开的流程与版本证据；自由画布和产品内聊天不是当前产品入口。

## 架构

```text
Tauri UI ─→ Rust `desktop_mcp_request` ─→ 打包 Node MCP sidecar ─┐
CLI / stdio MCP ────────────────────────────────────────────────→ WorkspaceApplicationService
                                                                   ├→ CommandService / QueryService / TaskRunner
                                                                   ├→ SQLite: data/ainovr.sqlite3
                                                                   └→ ObjectStore: data/objects/<sha256>
```

- UI、CLI 和 MCP 共享同一套 Application Service 语义。
- Node sidecar、CLI 和 MCP 使用 `better-sqlite3`；Tauri Rust 只负责 sidecar 生命周期、固定工作区定位和 JSON-RPC 输入边界，不直接访问 SQLite。
- 正文、原文、Prompt 与大型上下文使用内容寻址对象存储；SQLite 保存结构化索引、revision、依赖和审计。
- 所有写入走 CommandService，读取走 QueryService，长任务走带 lease、heartbeat、checkpoint、取消和恢复能力的 TaskRunner。
- MCP/CLI 只提供领域命令，不提供 SQL、数据库文件、Secret 或任意路径文件工具。

完整架构决策见 [ADR-0001](docs/adr/0001-final-rebuild-architecture.md)。

## 技术栈

- TypeScript 5（严格模式）、React 19、Vite 7、Tailwind CSS 4
- Tauri 2 与 Rust 1.97.1；Rust 侧只负责 sidecar 生命周期和 JSON-RPC 输入边界
- Node 侧 `better-sqlite3`
- Vitest 4 与 ESLint 9

Node 固定为 24.14.0（`engines: >=24 <25`），npm 固定为 11.11.1；根目录的 `.node-version` 与 `rust-toolchain.toml` 是本地和 CI 的共同版本来源。

## 前置条件

- Node.js 24.14.0 与 npm 11.11.1
- Rust 1.97.1（含 `rustfmt`、`clippy`）与 Tauri 工具链（仅在运行或构建桌面端时需要）
- 可选：Ollama。使用本地 FactExtractor、Writer、Reader、Reviewer 或 Editor 时，需要本机回环服务和已安装模型。

## 安装与运行

```powershell
npm install
npm run dev
```

启动桌面开发版：

```powershell
npm run tauri dev
```

生产构建：

```powershell
npm run build
npm run build:cli
npm run build:mcp
npm run tauri build
```

## CLI 与 MCP

构建领域 CLI 后，所有参数都通过 `--json` 传入；CLI 不接受任意数据库或对象路径。

```powershell
npm run build:cli
node dist-cli/ainovr-cli.mjs --workspace . get-workspace-status --json '{}'
```

构建并启动 stdio MCP companion：

```powershell
npm run build:mcp
node dist-mcp/ainovr-mcp.mjs --workspace .
```

MCP 客户端使用该 stdio 命令即可与 UI 操作同一工作区。示例配置及连通性检查见 [MCP companion 设置](docs/rebuild/mcp-companion-setup.md)。

未传入工作区时，CLI/MCP 使用 Windows `%APPDATA%\com.ainovr.app`，与发布版桌面端一致。`--workspace <目录>` 优先级最高，适用于开发、便携目录、测试夹具和恢复目录；`AINOVR_WORKSPACE` 可作为次级覆盖。开发脚本继续显式使用 `--workspace .`，不会触碰发布版数据。

## 本地模型创作

本地模型调用只允许回环 HTTP 地址。标准 Ollama 端口会使用原生 `/api/chat`，关闭思考模式；正文任务直接输出原创文本，结构化 Reader/Reviewer/Editor 任务会请求 JSON 并在本地严格校验。

Provider、角色路由和模型预算通过 Ainovr 的“设置”工作台或领域 MCP/CLI 保存为非秘密元数据。API Key 不进入 Ainovr 数据库、对象库、导出、日志、审计或 Prompt；需要云端模型时，将密钥只注入启动 CLI/MCP 进程的环境变量：

```powershell
$env:AINOVR_PROVIDER_00007A000065000075000073_API_KEY = "<仅当前进程可见的密钥>"
node dist-mcp/ainovr-mcp.mjs
```

环境变量中的 Provider ID 使用每个 Unicode 字符的十六进制编码，以避免 `a-b`、`a_b` 或大小写 ID 在 Windows 上碰撞。可调用 `providerEnvironmentVariableName()` 生成名称。本地 Ollama 不需要 API Key；角色路由中的 `baseURL`、协议、模型和预算仍由设置工作台保存。

## 从参考分析到原创生产

```text
SourceSpan → FactLedger → ThreadGraph → AnalysisBrief / ResearchQuestion
→ 独立反证 → ResearchDossier → MechanismAsset → 人工采纳
→ CreativeRecipe → ContextManifest → Writer / Reviewer / Editor → ProductionCommit
```

核心约束：

- 每个支持性结论都要能追溯到 `SourceSpan`、`sourceHash`、`exactTextHash` 和 UTF-8 半开字节区间。
- 分析允许 `unknown`、`not_observed`、`no_pattern` 等弃权；不得猜测作者意图或强行把慢节奏判为“水”。
- Writer 只能读取人工采纳后、去来源化的机制投影，不能读取参考作品的名称、人物、剧情、原文或 provenance。
- 章节最多三版：Writer V1、独立 Reviewer、定向 Editor V2，以及可选 V3。最终由人工选择并以原子 `ProductionCommit` 更新正文、Canon、人物知识和 Reader 状态。

## 工作区数据

```text
data/
├── ainovr.sqlite3         # 业务真相库
├── objects/<sha256>       # 内容寻址的大文本对象
├── backups/               # 备份与迁移前快照
├── exports/               # 受控导出
└── restores/              # 受控恢复演练结果
```

不要手工修改数据库或对象库，也不要把 API Key 写入工作区。外部绝对路径导入、恢复、覆盖与删除操作会创建持久 confirmation；Agent 代表用户批准时会以 `human_via_agent` 审计。

## 项目结构

```text
src/
├── application/           # Command/Query、TaskRunner 与分析/生产领域服务
├── persistence/           # SqlDriver、迁移、ObjectStore 与仓库
├── runtime/               # Tauri/本地模型运行时适配器
├── cli/                   # 薄领域 CLI
├── mcp/                   # stdio MCP companion
├── components/workbench/  # 四个桌面工作台及其可渲染模型
├── lib/analysis/          # 纯分析规则、分段、证据和机制校验
└── __tests__/             # 单元、契约、应用、持久化和运行时测试

src-tauri/                 # Rust sidecar 生命周期、Tauri 配置和发布资源
docs/adr/                  # 架构决策
docs/rebuild/              # R0–R8 的基线、验证和完成度审计
```

## 开发与验证

| 命令 | 说明 |
|---|---|
| `npm test` | 默认 Vitest 回归；排除真实 API 测试。 |
| `npm run test:real` | 显式执行 `src/__tests__/real-api/` 的探索测试。 |
| `npm run typecheck` | 严格 TypeScript 检查。 |
| `npm run lint` | ESLint 检查。 |
| `npm run build` | 前端生产构建。 |
| `npm run build:cli` | 构建 CLI。 |
| `npm run build:mcp` | 构建 MCP companion。 |
| `npm run tauri build` | 生成桌面发布物。 |

产品行为遵循 TDD：先写失败测试，再最小实现、重构和全套相关回归。发布前还应执行 Tauri 构建、MCP 工具面冒烟、Secret 扫描、备份恢复和便携目录移动验证。当前验证状态与尚未完成的真实文本验收见 [最终完成度审计](docs/rebuild/final-completion-audit-2026-08-08.md)。

## 协作规则

详细的架构约束、依赖方向、密钥与来源泄漏红线、命令规范和交付门见 [AGENTS.md](AGENTS.md)。

日常开发、Git 分支、worktree、冲突和恢复流程见 [开发指南](DEVELOPMENT.md)，其他入口见 [文档索引](docs/README.md)。

## 公开源码边界

本仓库是个人公开源码，当前未授予开源许可，也暂不接受外部贡献。请勿假定可以将其代码、数据或发布物用于其他项目；如需授权，请联系仓库所有者。
