# ✦ Ainovr — AI 小说风格模仿创作

上传你喜欢的小说，AI 深度分析文风、剧情、人物塑造等特征，然后按分析结果仿写全新故事。

## 功能

- 📖 **上传参考小说** — 支持 TXT 文件，可同时上传多本
- 🔍 **AI 风格分析** — 双管线架构：基础 8 步（文风/剧情/角色/体验/约束/DNA）+ 道/气 4 步（体验流标注/消融测试/势能追踪/技术样本库）
- 🧬 **事件图谱** — 200 万字长篇专用：滑动窗口事件提取 → 因果链图谱 → DNA 蒸馏
- ✍️ **5 层层级生成** — 大纲 → 阶段规划 → 分卷 → 章节集 → 每章计划，先框架后细节
- 🔄 **章节审查** — 5 维度自动审查（文风/情节/节奏/模式/伏笔），支持最多 3 轮修正
- 📤 **导出** — 仿写结果导出为 TXT 文件
- 🔧 **30 个可自定义 Prompt** — 所有 AI 提示词均可通过界面定制

## 技术栈

- **前端**：Next.js 16.2.6 + React 19.2.4 + TypeScript 5（strict）
- **样式**：Tailwind CSS v4 + shadcn/ui（base-nova 风格，OKLCH 色彩空间）
- **AI**：自研 SSE 流式客户端（原生 fetch + ReadableStream，OpenAI 兼容协议），默认 DeepSeek API
- **存储**：文件系统（JSON/TXT/MD/YAML），`data/` 目录下持久化，原子写入保证数据安全
- **状态**：Zustand v5，6 个 store

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

浏览器打开 http://localhost:3000

## 使用流程

1. 点击右上角 ⚙️ 配置 AI 后端（推荐 DeepSeek）
2. 上传你喜欢的小说 TXT 文件
3. 点击「一键分析」→ 等待双管线分析完成（基础 8 步 + 道/气 4 步可选）
4. 创建写作项目 → 指定源小说角色（文风参考 / 情节参考 / 两者）
5. 逐层生成：大纲 → 阶段 → 分卷 → 章节集 → 每章计划
6. 生成章节正文 → 自动审查 → 修正
7. 导出完成的作品

## 项目结构

```
src/
├── app/
│   ├── page.tsx              # 应用入口（SPA 视图路由）
│   ├── layout.tsx            # 根布局 + metadata
│   └── api/                  # 43 个 API Route Handler
│       ├── source/process/   # 素材分析（slice/style/plot/character-dynamics/…）
│       ├── generation/       # 5 层生成（outline/phase/volume/chapter-set/chapter-plan）
│       ├── chapter/          # 章节生成/审查/修正
│       ├── library/          # 素材库 CRUD
│       ├── project/          # 写作项目 CRUD
│       ├── prompts/          # 自定义 prompt 管理
│       └── novels/           # 旧版兼容接口
├── lib/
│   ├── ai/
│   │   ├── providers.ts      # 自研 SSE 流式 AI 客户端
│   │   └── prompts/          # 30 个 prompt 构建器
│   ├── api/
│   │   └── stream-route.ts   # API route 统一工厂
│   ├── store/                # 6 个 Zustand store（settings/navigation/source-library/source-processing/project/prompts）
│   ├── source-processing/    # 素材分析管线（15+ 提取模块 + 2 个编排器）
│   ├── generation/           # 5 层生成管线 + 上下文组装
│   ├── stream-fetcher.ts     # 共享流式 fetch 工具
│   ├── safe-path.ts          # 路径遍历防护
│   ├── atomic-write.ts       # 原子文件写入
│   └── constants.ts          # 共享常量
├── components/
│   ├── ui/                   # shadcn/ui 基础组件（16 个）
│   ├── source/               # 素材库/详情/文风情节库视图
│   ├── project/              # 写作项目视图
│   ├── generation/           # 层级生成视图
│   ├── chapter/              # 章节生成/审查视图
│   ├── prompts/              # Prompt 管理视图
│   ├── Sidebar.tsx           # 侧边栏导航
│   └── SettingsDialog.tsx    # 设置弹窗
└── types/
    └── index.ts              # 全部类型定义（~675 行）
```

## 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│  阶段 A：基础分析管线（8 步 · 步骤 4/5 并行 · 支持断点恢复）  │
│  上传小说 → 语义切片 → 文风/情节/角色/体验∥约束 → DNA 压缩     │
├──────────────────────────────────────────────────────────────┤
│  阶段 B：道/气深度分析（DAG 并行 · 可选）                     │
│  体验流标注 → 消融测试∥势能追踪 → DNA V2 构建 → 技术样本库    │
├──────────────────────────────────────────────────────────────┤
│  阶段 B'：事件图谱（200 万字长篇专用）                        │
│  滑动窗口事件提取 → 因果链合并 → 价值采样 → DNA 蒸馏          │
├──────────────────────────────────────────────────────────────┤
│  阶段 C：写作生成管线（5 层层次化 · 先框架后细节）            │
│  大纲 → 阶段 → 分卷 → 章节集 → 每章计划 → 正文 → 审查 → 修正 │
└──────────────────────────────────────────────────────────────┘
```

## 开发

```bash
npm run dev     # 开发服务器（localhost:3000）
npm run build   # 生产构建
npm run lint    # ESLint 检查
```

### 手动测试管线

```bash
# 需要先启动 dev server
node data/test-pipeline.mjs http://localhost:3000 YOUR_API_KEY deepseek-chat
```

## 许可

私有项目。
