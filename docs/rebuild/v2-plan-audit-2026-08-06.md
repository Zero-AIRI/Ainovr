# Agent 文档创作闭环 v2 对照审计

日期：2026-08-06。对照用户提供的《Ainovr 重构计划 v2：Agent 文档创作闭环》，以当前代码、测试、真实本地调用和 `data/` 落盘结果为证据。

## 结论

当前工程已具备可运行的 Agent 单章闭环、作品/文档/Canon 双层状态、Context Manifest、局部 revision、独立评审、大纲对账、三档自动化和 13 个 MCP 工具。作品页已能稳定切换书籍并逐章阅读已接受正文。

但不能标记为整份计划最终完成：R11 的十章长篇只有确定性端到端测试，尚未由本地模型真实连续生产完成；新 Agent 链的 Reader 仍是一个合并任务，未拆成沉浸型、低耐心、逻辑敏感三份独立上下文；旧生产正文通过 artifact 兼容读取，尚未全部迁移成 `04.正文/` 文档 revision。

## R1–R11 状态

| 阶段 | 状态 | 已验证能力 | 未完成或边界 |
|---|---|---|---|
| R1 领域命令/revision/stale | 完成 | UI/MCP 共用 CommandService；revision、actor、依赖、stale 有测试 | — |
| R2 NovelProject v2/文档工作区 | 部分完成 | Markdown 文档树、状态、读权限、Canon 并存 | 旧 artifact 正文/评审未全部迁移为项目文档 |
| R3 作品首页/统一资产库 | 完成 | 首页为作品；图纸/Prompt/Skill 等统一入口；通用聊天入口移除 | — |
| R4 Context Manifest | 完成 | 计划/实际读取、token、禁止读取、截断诊断、fail closed、Provider/model trace | 历史旧运行没有执行 trace，无法追溯模型 |
| R5 详细大纲/章节细纲 | 完成核心 | 细纲结构与 Outline Reviewer；未批准不启动 Writer | 分卷模型仍以文档为主，没有独立结构化卷实体 |
| R6 单主稿/局部问诊 | 部分完成 | Writer 单主稿；span 问诊、revision、影响分析和非破坏历史 | 问诊主要通过 MCP/生产工作台，作品正文阅读页尚未提供选中文本直接问诊 |
| R7 独立评审/质量门 | 部分完成 | 故事、连续性、文本、原创性、Reader 使用独立 Manifest；证据化问题进入质量门 | Reader 是一个合并任务，未拆成三类独立 Reader |
| R8 正文—大纲对账 | 完成 | Outline Drift、人工裁决、Canon patch、后续 stale 范围 | — |
| R9 分析覆盖/原文证据 | 完成核心 | SourceSpan、coverage ledger、MechanismCard adoption、去来源化 TransferBundle | 真实大规模语料质量仍需持续样本验收 |
| R10 三档自动化/MCP | 完成核心 | manual/supervised/autonomous；13 个 MCP 工具；stdio companion | 外部宿主的安装说明和兼容性仍需按宿主实测 |
| R11 整书生产验证 | 部分完成 | 一章真实本地 Agent 闭环；十章确定性端到端；恢复/暂停/回滚测试 | 尚未真实本地连续完成十章长篇与卷末审查 |

## 本次 UI 修复与验收

- 修复切换书籍时旧 `BookProductionState` 短暂进入新项目、触发严格校验并导致白屏的问题。
- 新增“章节正文”阅读页：按 Canon 接受顺序读取 artifact，列出全书章节计划；缺失单章只标记不可用，不拖垮整本书。
- 阅读和文档编辑时隐藏重复右栏；文档树折叠为“设定与大纲 / 章节细纲 / 生产记录”。
- 作品总览显示当前卷、当前章节、完成度、大纲/正文 revision、Canon revision、自动化模式、待确认提案、阻塞问题和推荐下一步。
- 使用实际 `novel_atmosphere_50k` 数据验证：2/10 章可读；第一章 5312 字、第二章 5825 字；第三至十章明确显示尚未生成。
- 从 DeepSeek 对照项目切换到普通项目不再白屏；实际点击第二章后正文成功切换。

## 2026-08-06 验证结果

- `npm test`：1104 通过，13 跳过，0 失败。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run build:mcp`：通过。
- MCP stdio smoke：`initialize` 通过，`tools/list` 返回 13 个工具。
- 本地 Ollama `qwen3.5:9b` 真实 Agent 单章闭环：1 通过，耗时约 151 秒。

## 距离最终验收的剩余工作

1. 将 Reader 模拟拆成沉浸型、低耐心、逻辑敏感三份独立 Manifest 与输出。
2. 为作品正文阅读页加入选中文本问诊和定点 revision 入口。
3. 把旧 accepted artifact/评审迁移为 `04.正文/`、`05.评审/` 文档 revision。
4. 使用本地模型从当前游标真实连续完成至少十章，执行卷末审查，并验证中断恢复。

本文件保留当日审计结论；后续重构状态以 `final-completion-audit-2026-08-08.md` 为准。
