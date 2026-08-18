# Ainovr 开发指南

本指南面向第一次参与 Git 项目的开发者。Ainovr 是个人公开源码仓库：当前不接受外部贡献，也没有授予开源许可；本指南说明本地开发和由仓库所有者发起 PR 的流程。

## 先认识四类目录

| 位置 | 职责 | 是否提交 |
|---|---|---|
| `S:\Ainovr` | 最终本地主工作树；完成后应跟踪 `main`。 | 只提交有意的源码与文档。 |
| `S:\CodexWorktrees\<任务>` | 某个分支的隔离开发工作树。 | 可提交该任务的改动，不放运行数据。 |
| `S:\Ainovr\.runs\<任务>` | 本地截图、临时数据库、扫描报告和其他可丢弃证据。 | 永不提交。 |
| 根 `data\` | 运行时 SQLite 与 ObjectStore。 | 永不提交；不要手工编辑。 |

不要把 API Key、正文、Prompt、原始模型输出、截图或数据库复制进 Git。`data/settings.json` 不是有效配置来源，也不应创建。

## 工具版本与首次安装

本仓库固定 Node `24.14.0`、npm `11.11.1` 和 Rust `1.97.1`（含 `rustfmt`、`clippy`）。Node 与 Rust 版本文件位于根目录；先确认环境再安装锁定依赖：

```powershell
node --version
npm --version
rustc --version
npm ci
```

桌面构建还需要 Tauri 所需的 Windows C++ 编译环境与 WebView2 Runtime。不要用 `npm audit fix`、不固定版本的全局升级或手工改 lockfile 来“修复”本项目。

## 每日 Git 流程

Git 里的几个术语：

- `checkout`：把某个分支的文件放到当前工作树。
- `branch`：一条独立提交线；任务必须在自己的 `codex/<任务>` 分支上完成。
- `commit`：把一组已暂存、可解释的改动写成不可变本地历史。
- `push`：把本地分支上传到远端；不是自动合并。
- `pull request (PR)`：请求把分支合入 `main`，并让 CI 在干净 clone 中验证。
- `worktree`：同一 Git 仓库的另一个目录/分支，不是运行时 workspace。

推荐的完整顺序是：

```text
branch → 失败测试 → 最小实现 → diff → commit → push → draft PR → CI → merge
```

PowerShell 示例：

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c codex/short-task

# 先写一个会失败的相关测试；再作最小实现。
npm test
git diff --check
git status --short
git add -- src/相关文件.ts src/__tests__/相关文件.test.ts
git commit -m "fix: describe the change"
git push -u origin codex/short-task
```

不要在脏工作树里执行 `git reset --hard`、`git clean` 或 `git checkout --`。它们会删除未提交资产。不要用 `git add .` 处理混合工作树；列出明确文件，确认每一项都属于本次 PR。

## 运行与验证

开发期的 CLI/MCP 通过 `--workspace .` 使用当前目录；发布版默认使用用户可写 AppData。显式便携 workspace 仅用于测试、恢复或用户明确指定的目录。

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run build:cli
npm run build:mcp
npm run prepare:desktop-sidecar
Set-Location src-tauri; cargo test; Set-Location ..
```

领域、持久化、MCP、CLI 或生产行为变更还要完成 Tauri build、MCP `initialize`/`tools/list` 冒烟、Secret 扫描、备份恢复和便携目录移动验证。UI 最终验收使用 Win32 后台截图或内置浏览器；图片只放 `.runs`。

## 处理冲突

先更新目标分支，再把改动重放到最新 `main`：

```powershell
git fetch origin
git rebase origin/main
```

出现冲突时：打开 Git 标出的文件，保留两边都需要的行为，运行相关测试，然后：

```powershell
git add -- <已解决文件>
git rebase --continue
```

如果还没有作出可保留的解决，可使用 `git rebase --abort` 回到 rebase 开始前。不要删除冲突文件来让命令“通过”。

## 常见误操作恢复

- 尚未暂存：使用 `git diff` 找回改动；不要覆盖工作树。
- 已暂存但未提交：使用 `git diff --cached` 审查；需要撤出暂存时用 `git restore --staged -- <文件>`，文件内容仍保留。
- 已提交但未推送：先保留提交，使用新提交修正；不要改写多人可见历史。
- 已推送：在同一分支追加修复，让 CI 再次验证；不要 force-push。
- 找不到旧提交：先运行 `git reflog`，确认 commit ID 后再请求协助恢复。

## PR 与 CI

PR 必须基于最新 `main`，以普通 merge commit 合并，且 `Windows clean-clone gates` 必须全绿。该 CI 会在新 clone 中安装锁定依赖、执行 TypeScript/Rust 检查、MCP 冒烟和 Tauri release build。CI 失败时先读取失败日志、在同一分支复现、写失败测试并修复；不要跳过或重命名 required check。

在 GitHub 创建 PR 前，填写模板中的范围、验证和风险。`main` 的保护规则要求通过 PR 合并；无需审批不代表可以绕过测试或 review conversation。
