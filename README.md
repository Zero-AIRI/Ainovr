# ✦ 墨韵仿写 — AI 小说风格模仿创作

上传你喜欢的小说，AI 深度分析文风、剧情、人物塑造等特征，然后按分析结果仿写全新故事。

## 功能

- 📖 **上传参考小说** — 支持 TXT 文件，可同时上传多本
- 🔍 **AI 风格分析** — 从文风、剧情结构、人物塑造、叙事技巧等维度深度分析
- ✍️ **风格仿写** — 基于分析报告，AI 按目标风格创作全新内容
- 🔄 **续写** — 可持续续写，保持风格一致
- 📤 **导出** — 仿写结果导出为 TXT 文件
- 🔌 **多 AI 后端** — 支持 DeepSeek / Kimi / OpenAI / Claude / Ollama

## 技术栈

- **前端**: Next.js 14 + React + TypeScript + Tailwind CSS + shadcn/ui
- **AI**: Vercel AI SDK（统一流式传输）
- **存储**: IndexedDB (Dexie.js) — 所有数据本地存储
- **状态**: Zustand

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

浏览器打开 http://localhost:3000

## 使用流程

1. 点击右上角 ⚙️ 配置 AI 后端（推荐 DeepSeek，便宜好用）
2. 上传你喜欢的小说 TXT 文件
3. 点击「开始分析」→ 查看风格分析报告
4. 确认后进入「仿写」页面，输入故事梗概和创作要求
5. AI 按参考风格生成全新内容

## 支持的 AI 后端

| 后端 | 推荐模型 | 上下文 | 说明 |
|------|---------|--------|------|
| DeepSeek | deepseek-chat | 128K | **推荐**，低价中文强 |
| Kimi (月之暗面) | moonshot-v1-128k | 128K | 中文长文本优秀 |
| OpenAI | gpt-4o | 128K | 综合能力好 |
| Claude | claude-sonnet-4-6 | 200K | 分析质量最高 |
| Ollama (本地) | qwen2.5:14b | 128K | 完全离线 |

## 部署

### Vercel（推荐）

```bash
npx vercel
```

### Docker

```bash
docker build -t ainovr .
docker run -p 3000:3000 ainovr
```

## License

MIT
