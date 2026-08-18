# Ainovr 人类可读写作方法验证垂直切片实施计划（2026-08-17）

状态：**P0–P5 已按 TDD 完成；P6 已具备本地、版本化的三组匿名配对冻结、候选 Writer 生成、独立匿名盲评和结论计算契约，真实 Provider 生成和人工盲评尚未开始。**

需求来源：[人类可读写作方法验证垂直切片需求](human-readable-writing-method-slice-requirements-2026-08-17.md)。

## 1. 实施原则

- 先做一个真实、可运行、可视觉验收的单章单卡闭环，不先重做全部 UI。
- 产品行为严格执行 TDD：先写失败测试，再最小实现、重构并运行相关回归。
- 复用 `project_documents`、`artifacts`、`artifact_revisions`、`artifact_dependencies` 与 CommandService；除非失败测试证明现有表无法表达需求，不新增 SQL 表或迁移。
- 不保留 ChapterContract `mechanismCardIds` 的兼容读取；新本章采用记录是唯一真相。
- 不在 React 中拼接业务状态；新增聚合查询投影。
- 不新增依赖，不引入通用表单框架、工作流引擎或全局状态层。
- `AinovrWorkbench.tsx` 只拆本次触及的作品/待处理区域，不顺手重构参考与设置页。

## 2. 阶段与退出门

### P0：权威文档与当前基线

状态：**本轮完成。**

- 决策写入需求文档与本计划。
- 在执行基线登记下一阶段目标、范围与非目标。
- 保持四个完成字段不变。

退出门：需求、非目标、成功标准和用户裁决无悬空分支。

### P1：本章采用记录领域闭环

先写失败测试：

- 新建/更新 `ChapterMechanismApplication` 成功；更新必须 CAS。
- 拒绝未采纳、`editor_only`、外项目、错误 revision 和 stale 方法卡。
- 五项字段拒绝空字符串，接受显式 `unknown/not_applicable`。
- 第一条切片拒绝零卡或多卡 application。
- 一般章节在没有 application 时仍能创建空方法 Recipe。
- application 更新使旧 Recipe 与下游依赖 stale。

最小实现：

- 新增 `src/application/chapter-mechanism-application-service.ts`。
- 通过现有 `commit_project_planning_document` 或等价受控领域命令保存 `chapter_mechanism_application`。
- 修改 `creative-recipe-service.ts`：从 application 读取精确方法 revision；删除对 ChapterContract 裸 `mechanismCardIds` 的依赖和 fallback。
- 更新 StoryPlanning 契约与 fixture，使 ChapterContract 不再承担方法选择真相。

退出门：application → Recipe 的版本、依赖、CAS 与零卡回归全部通过。

### P2：Writer/Reviewer 因果契约

先写失败测试：

- Writer ContextManifest 含去来源化方法和本章采用字段，不含参考标题、人物、剧情、原文、span 或 provenance。
- application/Recipe 变更后旧 Manifest 不能冻结或使用。
- Reviewer TaskManifest 冻结 application revision 与 signals。
- Review 缺少任一 signal 判断、使用非法状态、范围越界或 quote 不匹配时拒绝提交。
- `unknown/not_applicable` 能诚实保存，不被改写为成功。
- 现有三 Reader 独立性与 V1 Reviewer lineage 回归继续通过。

最小实现：

- 扩展 `chapter-context-manifest-service.ts` 的白名单上下文。
- 扩展 `chapter-reviewer-service.ts` 的冻结输入和 Prompt 契约。
- 扩展 `chapter-review-service.ts` 的规范化输出，保留现有 issues，并新增 `effectAssessments`。
- 原始 Reviewer 输出与规范化输出继续先写 ObjectStore，再提交结构化索引。

退出门：同一 application 能被 Writer 与 Reviewer 一致读取，且来源隔离与 UTF-8 范围门全部通过。

### P3：人类判断、带风险接受与 ProductionCommit

先写失败测试：

- Reviewer 报告不可由人类处置命令覆盖。
- 人类可以逐项同意/不同意；不同意缺理由时失败。
- `accept_with_gap` 缺理由时失败。
- outcome 必须绑定当前 application、Review 和 draft revision。
- 任一依赖 stale/CAS 冲突时 outcome 或 ProductionCommit fail closed。
- 单章 outcome 不改变全局 MechanismAsset/adoption 状态。
- UI `human` 和 `human_via_agent` 发起 ProductionCommit 都返回 `needs_confirmation`。
- 批准确认时重新校验命令 Hash、revision 与策略；旧确认不能执行新目标。

最小实现：

- 新增 `src/application/chapter-mechanism-outcome-service.ts`。
- ProductionCommit 输入绑定当前 outcome revision，并将该引用写入 lineage/审计摘要。
- 修改 CommandPlanner：`commit_chapter_production` 对 human 与 human_via_agent 均要求持久确认。
- 扩展 `ConfirmationView.targetSummary`，返回安全、可读的章节/方法/Review/连续性摘要，不返回正文、Prompt 或 Secret。

退出门：正常接受、带风险接受、拒绝、过期确认、stale 和 CAS 冲突均有反向测试。

### P4：MCP、CLI、桌面运行时与查询投影

先写失败测试：

- 新领域工具 schema 拒绝额外字段、空 ID、缺 revision 和非法枚举。
- stdio MCP、CLI 和 desktop_ui 调用同一服务并得到同一结果。
- desktop_ui 不获得原文对象路径、SQL、Secret 或任意命令能力。
- 聚合投影能返回当前阶段、阻塞、下一动作和诊断引用；完整正文/证据保持按需读取。

建议工具/查询：

- `save_chapter_mechanism_application`
- `get_chapter_mechanism_application`
- `save_chapter_mechanism_outcome`
- `get_chapter_mechanism_outcome`
- `get_chapter_method_workbench`
- 复用或收束现有证据摘录查询，不新增任意 span/路径读取工具

最小实现：

- 新增高内聚的章节方法工作台 QueryService 模块；不要继续把全部 SQL 堆入 React。
- 在 `application-mcp-jsonrpc.ts`、`workspace-cli.ts`、桌面运行时类型和组装入口注册受控领域工具。
- Query 投影使用人类状态，同时提供折叠诊断字段。

退出门：MCP `tools/list`、schema、CLI、desktop runtime 和应用服务集成测试通过。

### P5：待处理与章节工作台 UI

先写纯逻辑/交互失败测试：

- 待处理卡片完整显示六组人类字段，证据默认折叠且最多加载 1–3 条。
- 作者不输入内部 ID/JSON 即可批准方法、保存 application 和创建 outcome。
- 作品页能区分加载、空态、待填写、stale、Reviewer 完成、带风险、等待确认和 accepted。
- 点击 Reviewer 问题能从 UTF-8 字节范围得到正确高亮，覆盖中文、emoji/代理对、混合换行。
- 诊断详情默认折叠但可以复制。
- 11 节点生产链不再占据正文主区。

组件边界建议：

```text
src/components/workbench/
├─ AinovrWorkbench.tsx                 # 壳、一级导航、刷新编排
├─ pending/MechanismReviewPanel.tsx    # 全局方法审核与证据
└─ works/
   ├─ ChapterMethodWorkbench.tsx       # 章节工作流编排
   ├─ ChapterDraftViewer.tsx           # 完整正文与 UTF-8 锚点
   ├─ ChapterMethodInspector.tsx       # 方法 / Reviewer / 诊断
   └─ chapter-method-view-model.ts      # 纯状态映射
```

实现要求：

- 保留固定一级导航。
- 作品页采用左侧导航、中间正文、右侧检查器布局。
- React 只保存选中章节、标签、展开状态与未提交表单草稿。
- 保存后以 change feed/QueryService 刷新；不在 Zustand/组件中维护第二份业务真相。
- 不改造参考/设置页，不添加新视觉系统或依赖。

退出门：组件测试通过，浏览器只作开发交互检查；最终视觉裁决必须使用真实 Tauri 位图。

### P6：隔离验收工作区与真实桌面验收

验收 fixture：

- 原始 `data/r7-dstdyj-20260809` 只读。
- 在测试专用目录构建 replay fixture，复用冻结对象但明确记录 `fixture_replay`，停在 Reviewer 完成、ProductionCommit 未执行。
- fixture 构建器不得成为产品工具，不得接受任意用户路径，不得直接修改用户工作区。

逐状态验收：

1. 待处理方法卡首屏；
2. SourceSpan 证据展开；
3. 本章采用记录的空态、合法保存和字段错误；
4. 完整草稿与 Reviewer 锚点；
5. Reviewer `observed` 与未证实/分歧状态；
6. 正常接受与带风险接受确认；
7. stale/CAS 冲突；
8. 确认批准后的正式章节状态。

视觉方式：

- 使用 Win32 `PrintWindow(PW_RENDERFULLCONTENT)` 后台截图或项目规范允许的内置浏览器交互；最终发布态以真实 Tauri + SQLite 位图为准。
- 以至少 1280×800 的桌面视口检查遮挡、截断、密度、滚动、焦点和状态层级。
- 图片保存到本地证据目录，记录 SHA-256；不写入数据库，不输出正文或 Secret 到报告。

退出门：所有成功标准均有测试、查询或位图直接证据；报告明确区分 fixture replay、真实历史模型结果和新代码行为。

## 3. 验证命令

每个阶段先跑最相关失败测试；完成后至少运行：

```text
npm test
npm run typecheck
npm run lint
npm run build
npm run build:cli
npm run build:mcp
npm run tauri build
```

发布验收再补：Secret 扫描、MCP `tools/list` 冒烟、备份恢复与便携目录移动。不能将未运行的检查写成通过。

## 4. 风险与控制

| 风险 | 控制 |
|---|---|
| application 与 ChapterContract 双重保存方法选择 | 删除裸 `mechanismCardIds` 读取，不加 fallback |
| Writer 泄漏参考来源 | Manifest 白名单、禁词反向测试、Writer 不读取证据查询 |
| Reviewer 总评无法验证目标 | 强制每个 signal 有结构化 assessment |
| JS 字符下标误当 UTF-8 字节 | 复用/新增纯范围转换器并覆盖中文、emoji、换行测试 |
| 人类接受被误报为方法有效 | outcome 与全局机制生命周期分离 |
| UI 绕过持久确认 | human/human_via_agent ProductionCommit 同一确认策略 |
| replay fixture 被误认为新模型结果 | 显式 `fixture_replay` lineage，报告禁止模型成功声明 |
| 3,000 行组件继续膨胀 | 只拆本次触及的两个领域面板，不做全局重构 |

## 5. 完成后的下一次决策

本切片完成并经用户视觉验收后，才在以下方向中选择一个：

1. 同章多方法卡及冲突解释；
2. 跨章节方法效果汇总与全局生命周期；
3. 真实 Editor V2 定向修订成功样本；
4. 长篇分阶段恢复与实际 usage/成本遥测。

这些均不是当前实施范围。
