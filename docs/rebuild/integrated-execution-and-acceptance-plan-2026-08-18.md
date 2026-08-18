# Ainovr 整合执行与验收计划（已裁决版）

日期：2026-08-18
状态：执行中；本文件替代临时附件中的整合计划。

## 目标与边界

本轮先保证桌面、CLI 和 MCP 共享同一受控工作区，再交付单章节、单机制卡的人类可读生产闭环，并以三组盲评配对实验验证机制的实际效用。所有领域事实仍由 Application Service、SQLite 与 ObjectStore 管理；Rust 只管理打包 sidecar，Secret 只来自启动进程环境。

不恢复内置聊天、自由画布、`settings.json` Secret、任意文件/SQL RPC 或通用代码节点。截图、正文、Prompt、原始模型输出、对象 hash 与实验 A/B 映射只保留在本地受控证据中，不进入公开仓库。

## P0–P6 顺序

### P0：统一工作区解析

- CLI/MCP 解析优先级固定为显式 `--workspace`、`AINOVR_WORKSPACE`、桌面 AppData 默认位置；无法解析则拒绝启动。
- Tauri release 与外部 MCP 必须读取同一 workspace revision、change sequence、项目与待处理投影；显式便携工作区不得回退到 AppData。
- 不迁移、合并或覆盖既有用户工作区；未来 schema 仍须在 WAL、备份和写入前拒绝。

### P1：本章机制采用记录

- 建立版本化 `ChapterMechanismApplication`，首条切片恰好绑定一张已采纳 Writer 方法卡；普通章节仍允许零卡。
- 采用记录包含原因、计划用法、可观察读者效果、避免误用及 review signals，并受 CAS、依赖失效和项目边界约束。
- 旧的裸机制卡 ID 不再作为生产真相；不引入 fallback 或双轨读取。

### P2：Writer / Reviewer 同一目标契约

- Writer Manifest 仅接收去来源化方法与采用记录，禁止参考书名、人物、剧情、原文、SourceSpan 或 provenance。
- Reviewer 对每一 review signal 记录可复核的效果判断、正文范围、副作用和建议；其任务输入冻结 application、Manifest、draft 与 Reader 输入 revision。
- 引文、范围、draft revision 或 signal 集合不匹配时 fail closed。

### P3：人类判断与正式提交

- `ChapterMechanismOutcome` 分离保存 Reviewer 判断与人类同意、异议、带风险接受理由和最终处置。
- ProductionCommit 只接受当前、未 stale 的 application、review 与 outcome；由 Agent 代表人类批准时使用持久 confirmation 与 `human_via_agent` 审计。
- 接受保持既有的原子章节、Canon、人物知识、ReaderState/Promise、Outline Drift 和生产游标更新；接受章节不等于机制有效。

### P4：MCP、CLI 与桌面工作台

- 只新增受控领域命令和聚合 Query 投影，不开放 SQL、任意路径或原始正文总览接口。
- “作品”与“待处理”工作台提供本章采用、草稿、Reviewer 锚点、人类判断与确认；四个一级入口保持不变。
- ID、revision、模型路由、hash 与原始 JSON 默认折叠；UI 仅保存选择和未提交草稿。

### P5：隔离 replay 与桌面验收

- replay fixture 仅限测试/验收目录，标注为 fixture，不把历史对象误报为新模型调用。
- 最终桌面证据使用真实 Tauri + SQLite 的 Win32 后台位图；至少覆盖宽屏、窄屏、待处理与诊断状态。
- 位图与其校验记录只保留在本地证据目录。

### P6：正式机制效用盲评实验

- 采用三对样本：同一 ChapterContract 下不注入方法卡的 A，与注入一张已采纳方法卡的 B；除方法注入外，冻结输入、路由、模型、预算与 Reviewer signals 必须一致。
- 匿名盲评记录目标效果、契约符合度、连续性、原创性、可读性、副作用、来源泄漏和上下文成本。
- 通过要求 B 至少赢得 2/3，零 blocker/major 回归、零来源泄漏，且人类与结构化判断至少 2/3 方向一致；inconclusive 不算胜出。

## P7：后续产品完成门

只有 P0–P6 均通过后才可启动：

1. 取得真实 Provider 的 Editor V2 成功样本，并证明只修改 Reviewer 指定范围且不引入契约、连续性或原创性退步。
2. 记录实际 usage 与成本遥测；Provider 未返回 usage 或没有可靠价格时明确保存 `unknown`。
3. 从 20–30 个代表性单元逐步验证可终止、可恢复的长篇分阶段处理，再扩展至 100 个；此前不启动全量长篇或有限并发。
4. 在三种独立 Agent 安装态验证同一 MCP bundle、恢复、便携目录移动、future schema 拒绝、Secret 扫描和桌面发布。

## 统一验收门

每个行为先以失败测试定义，再作最小实现。各阶段至少通过 `npm test`、类型检查、lint、前端/CLI/MCP 构建、Rust 测试、Tauri 构建、MCP `tools/list` 冒烟、`git diff --check` 和候选树 Secret 扫描。发布验收额外覆盖备份恢复、便携目录移动、首次启动与 future schema 不修改数据库。

当前状态不以历史截图、fixture、候选正文或部分测试替代直接证据。P6 的失败或 inconclusive 不自动删除方法卡，也不构成模型资格认证。
