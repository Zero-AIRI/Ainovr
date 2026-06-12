# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

墨韵仿写 — AI 小说风格模仿创作工具。上传小说 → AI 分析文风/剧情/人物 → 按风格仿写新故事。

## Commands

```bash
npm run dev     # 开发服务器 (localhost:3000)
npm run build   # 生产构建
npm run lint    # ESLint 检查
```

无测试框架，无测试命令。有一个手动管线测试脚本：`node data/test-pipeline.mjs [base_url] [api_key] [model]`。

## ⚠️ Next.js Version

**Next.js 16.2.6** — 这不是你训练数据中的 Next.js。API、约定、文件结构可能有 breaking changes。写代码前先读 `node_modules/next/dist/docs/` 中的相关指南。注意 deprecation 警告。

## Architecture

### 单页应用，无 URL 路由

整个应用只有一个 `src/app/page.tsx`，通过 Zustand store 的 `activeView` 状态切换视图组件。不使用 Next.js 的动态路由或嵌套布局。

当前活跃视图：`source-library` | `source-detail` | `writing-project` | `prompt-management` | `layer-generation` | `chapter-generation`（后两个标记为废弃，正迁移到 `writing-project` 内嵌标签页）。

### 数据存储：文件系统，无数据库

所有数据存放在项目根目录 `data/` 下，纯 JSON/TXT/MD/YAML 文件，通过 `fs.promises` 直接读写：

- `data/source_library/{id}/` — 素材库：分析报告、切片、DNA、元数据
- `data/projects/{id}/` — 写作项目 JSON
- `data/novels/{id}/` — 旧版小说数据（兼容）
- `data/prompts.json` — 自定义 prompt 覆盖

所有文件写入必须通过 `safeJoin()`（`src/lib/safe-path.ts`）防止路径遍历。写入使用 `atomic-write.ts` 的临时文件 + rename 模式保证原子性。浏览器端 IndexedDB 仅作缓存/兼容层（`src/lib/sync/idb-helpers.ts`）。

### AI 集成：自研流式客户端

`src/lib/ai/providers.ts` — 手写的 OpenAI-compatible SSE 流式客户端（原生 fetch + ReadableStream）。**不要使用 `ai` 或 `@ai-sdk/openai` 包**，它们在 dependencies 中但运行时未使用。

AI 配置（apiKey/model/baseURL/thinkingMode）存在浏览器 localStorage（Zustand persist），每次请求从客户端传到服务端。服务端不存储 AI 凭证。默认使用 DeepSeek API（`https://api.deepseek.com`，模型 `deepseek-v4-flash`）。

### 流式请求基础设施

两层抽象：

| 模块 | 位置 | 用途 |
|------|------|------|
| `providers.ts` | `src/lib/ai/` | 底层 SSE 流解析，`chatCompletionStream()` 返回 `ReadableStream` |
| `stream-fetcher.ts` | `src/lib/` | 上层封装，`createStreamFetcher()` 提供 `fetch()` + `abort()`，自动注入 `thinkingMode` |
| `stream-route.ts` | `src/lib/api/` | API route 工厂，`createStreamRoute()` 消除 route 的重复样板 |

`stream-route.ts` 提供三种模式：
- `handlePassThroughStream` — 客户端预构建 systemPrompt + userMessage（source/process/* 路由用）
- `handlePromptBuiltStream` — 服务端通过 promptBuilder 构建（generation/* 和 chapter/* 路由用）
- `createStreamRoute` — 一行创建完整 POST handler，自动包 try/catch

### Prompt 系统

Prompt 构建器在 `src/lib/ai/prompts/`，28 个构建器文件，每个导出 `build*Messages()` + `DEFAULT_SYSTEM_PROMPT`。统一从 `src/lib/ai/prompts/index.ts` 导出。

Prompt 注册表在 `src/lib/store/prompts.ts`（`PROMPT_REGISTRY`），34 个可自定义 prompt，分为四个类别：统一管线（5）、素材处理（14）、层级生成（9+1大纲）、章节写作（3）。用户可通过 PromptManagementView 自定义任意 prompt，覆盖存储在服务端 `data/prompts.json`。

统一管线 prompt 使用公共约束段（`pipeline-common.ts`），所有分析 prompt 注入「工程逆向分析」核心约束，禁止文学赏析、强制量化输出。

### Zustand Stores（`src/lib/store/`）

| Store | 职责 |
|-------|------|
| `useSettingsStore` | AI 配置，localStorage 持久化（当前 migration v8），含 thinkingMode |
| `useNavigationStore` | 当前视图路由（`activeView`）+ 管线任务追踪 |
| `useSourceLibraryStore` | 素材库列表与当前选中，启动时加载，处理中状态自动重置为 error |
| `useSourceProcessingStore` | 统一 7 步素材分析管线状态，支持断点恢复 |
| `useProjectStore` | 写作项目 CRUD、5 层生成输出、章节管理 |
| `usePromptStore` | 自定义 prompt 覆盖，启动时从服务端加载 |

### API Routes（`src/app/api/`）

46 个 Route Handler，按领域分组：
- `source/process/` — 15 个：统一管线步骤（event-extraction, event-alignment, deep-analysis, summary, dna-compression）+ 旧版步骤（slice, style, plot, character-dynamics, reader-experience, narrative-constraints, samples, classify-entities）+ 进阶分析（experience-annotation, ablation-testing, tension-tracking）
- `generation/` — 9 个层级生成（outline, phase-framework/detail, volume-framework/detail, chapter-set-framework/detail, chapter-plan-framework/detail）
- `chapter/` — 3 个章节操作（generate, review, revise）
- `library/` — 7 个素材管理（list, get, upload, save, save-step, delete, rename）
- `project/` — 5 个项目 CRUD（create, save, load, list, delete）
- `prompts/` — 2 个 prompt 管理（list, save）
- `novels/` — 4 个旧版兼容（list, detail, save, delete）

source/process/* 和 generation/* 路由（共 28 个）使用 `createStreamRoute()` 一行创建，模式统一。

### 素材处理管线（统一 7 步架构）

**统一管线**（`src/lib/source-processing/unified-pipeline.ts`）：
1. 小切片（代码，~2万字/片）
2. 逐片事件提取（N 次并行 AI）
3. 事件对齐（代码预处理 + 1 次 AI）→ 全书记忆图谱
4. 大切片（代码，按 maxContextTokens 自适应）
5. 逐大切片深度分析（并行 AI，带完整图谱）
6. 汇总 + 刺激点分析 + 一致性报告（1 次 AI）
7. DNA 压缩（代码填充量化参数 + AI 定性）→ 纯量化生成规则

核心转向：从「文学鉴赏式分析」转向「工程逆向式分析」。只提取可量化的生成规则，不分析作者意图。
类型定义在 `pipeline-types.ts`。所有分析 prompt 注入公共约束段（`pipeline-common.ts`）。
支持断点恢复（`PipelineCheckpoint`），重试 2 次后停止，已完成结果保留。

旧版管线（basic-pipeline.ts、dao-pipeline.ts）仍存在但已不使用，逐步清理中。

### 5 层生成管线

`src/lib/generation/layer-pipeline.ts` — "框架-后细节"模式：
大纲 → 阶段规划 → 卷规划 → 章节集 → 章节计划

每层先生成框架结构，再逐个填充细节。上下文由 `context-assembler.ts` 按层组装，优先使用新 `GenerationRulesDNA`（量化参数），回退到旧 DNA 格式。

## Key Files

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | 应用入口，视图路由 |
| `src/app/layout.tsx` | 根布局，metadata + Toaster |
| `src/lib/ai/providers.ts` | 自研 SSE 流式 AI 客户端 |
| `src/lib/ai/prompts/index.ts` | Prompt 统一导出 |
| `src/lib/ai/prompts/pipeline-common.ts` | 统一公共约束段（工程逆向分析） |
| `src/lib/api/stream-route.ts` | API route 统一工厂（消除重复样板） |
| `src/lib/stream-fetcher.ts` | 共享流式 fetch 工具（自动注入 thinkingMode） |
| `src/lib/store/settings.ts` | AI 配置 store（migration v8） |
| `src/lib/store/source-processing.ts` | 统一 7 步管线编排 store |
| `src/lib/store/prompts.ts` | Prompt 注册表（34 个）+ 自定义覆盖 store |
| `src/lib/source-processing/unified-pipeline.ts` | 统一 7 步管线编排器 |
| `src/lib/source-processing/pipeline-types.ts` | 管线类型定义（343 行） |
| `src/lib/generation/layer-pipeline.ts` | 5 层生成管线 |
| `src/lib/generation/context-assembler.ts` | 层级上下文组装（含 GenerationRulesDNA 支持） |
| `src/types/index.ts` | 全局类型定义（679 行） |
| `src/lib/safe-path.ts` | 路径遍历防护 |
| `src/lib/atomic-write.ts` | 原子写入（临时文件 + rename） |
| `src/lib/constants.ts` | 共享常量（默认模型/URL/协议白名单） |

## Conventions

- **中文代码库**：UI 文本、注释、prompt 内容均为中文
- **ID 生成**：统一使用 `nanoid`
- **SSRF 防护**：`providers.ts` 校验 URL 协议（仅 https），屏蔽内网地址
- **Tailwind CSS v4** + **shadcn/ui**（base-nova 风格），OKLCH 色彩空间，暖纸色调主题
- **路径别名**：`@/*` → `./src/*`
- **文件写入**：必须通过 `safeJoin()` 防路径遍历，使用 `atomicWrite*()` 保证原子性
- **API 凭证**：服务端不存储，每次请求从客户端传入
