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

无测试框架，无测试命令。

## ⚠️ Next.js Version

**Next.js 16.2.6** — 这不是你训练数据中的 Next.js。API、约定、文件结构可能有 breaking changes。写代码前先读 `node_modules/next/dist/docs/` 中的相关指南。注意 deprecation 警告。

## Architecture

### 单页应用，无 URL 路由

整个应用只有一个 `src/app/page.tsx`，通过 Zustand store 的 `activeView` 状态切换视图组件。不使用 Next.js 的动态路由或嵌套布局。

### 数据存储：文件系统，无数据库

所有数据存放在项目根目录 `data/` 下，纯 JSON/TXT/YAML 文件，通过 `fs.promises` 直接读写：

- `data/source_library/{id}/` — 素材库：分析报告、切片、DNA（YAML）
- `data/projects/{id}/` — 写作项目 JSON
- `data/novels/{id}/` — 旧版小说数据（兼容）

所有文件写入必须通过 `safeJoin()`（`src/lib/safe-path.ts`）防止路径遍历。浏览器端 IndexedDB 仅作缓存/兼容层。

### AI 集成：自研流式客户端

`src/lib/ai/providers.ts` — 手写的 OpenAI-compatible SSE 流式客户端（原生 fetch + ReadableStream）。**不要使用 `ai` 或 `@ai-sdk/openai` 包**，它们在 dependencies 中但运行时未使用。AI 配置（apiKey/model/baseURL）存在浏览器 localStorage，每次请求从客户端传到服务端。

### Prompt 系统

30+ 个 prompt 构建器在 `src/lib/ai/prompts/`，每个导出 `build*Messages()` + `DEFAULT_SYSTEM_PROMPT`。用户可通过 PromptManagementView 自定义任意 prompt，覆盖存储在服务端。

### Zustand Stores（`src/lib/store/`）

| Store | 职责 |
|-------|------|
| `useSettingsStore` | AI 配置，localStorage 持久化（当前 migration v7） |
| `useSourceLibraryStore` | 素材库列表与当前选中 |
| `useSourceProcessingStore` | 8 步素材分析管线状态 |
| `useProjectStore` | 写作项目、5 层生成输出、导航视图 |
| `usePromptStore` | 自定义 prompt 覆盖（30+ key） |

### API Routes（`src/app/api/`）

30+ 个 Route Handler，统一模式：解析 JSON body → 调用 `chatCompletionStream()` → 返回 `text/plain` 流式响应。服务端不存储 AI 凭证。

### 素材处理管线（8 步串行）

`src/lib/source-processing/` — 9 个提取模块，严格串行执行：
切片 → 文风提取 → 叙事动态 → 人物动态 → 读者体验 → 叙事约束 → 样本选择 → DNA 压缩

### 5 层生成管线

`src/lib/generation/layer-pipeline.ts` — "框架-后细节"模式：
大纲 → 阶段规划 → 卷规划 → 章节集 → 章节计划

每层先生成框架结构，再逐个填充细节。

## Key Conventions

- **中文代码库**：UI 文本、注释、prompt 内容均为中文
- **ID 生成**：统一使用 `nanoid`
- **SSRF 防护**：`providers.ts` 校验 URL 协议，屏蔽内网地址
- **Tailwind CSS v4** + **shadcn/ui**（base-nova 风格），OKLCH 色彩空间，暖纸色调主题
- **路径别名**：`@/*` → `./src/*`
- **README.md 已过时**：技术栈描述（Next.js 14、IndexedDB/Dexie、Vercel AI SDK）已不反映实际代码，勿以此为依据
