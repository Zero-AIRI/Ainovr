# Ainovr Win32 后台截图视觉复核（2026-08-15）

## 1. 复核口径

本轮按最新工程约定，不再以浏览器预览、DOM、UIA 树或 Windows Graphics Capture 代替桌面位图证据。实际启动当前 `src-tauri/target/release/ainovr.exe`，定位其 Win32 顶层窗口与 WebView 子窗口，并使用 `PrintWindow(PW_RENDERFULLCONTENT)` 在窗口被遮挡时后台捕获真实 Tauri + SQLite 数据态。

截图保存在不公开的本地证据目录。

页面切换和滚动只使用 Win32 窗口消息；没有保存表单、批准命令、取消任务、调用模型或修改项目事实。重复截图按 SHA-256 去重，不作为额外证据。

## 2. 有效截图账本

| 截图 | SHA-256 前 12 位 | 可证明的状态 |
|---|---:|---|
| `ainovr-win32-works-2026-08-15.png` | `91B19B78A175` | 作品页真实三栏布局、两章生产链、ChapterContract 待审核、下游 stale 和阻塞。与 2026-08-10 同名状态截图像素哈希相同，说明该首屏视觉没有发生变化。 |
| `ainovr-win32-works-middle-2026-08-15-r2.png` | `03322F2DDA4B` | 生产链下半部、原创生产规划、原始规划 JSON、Chapter/Manifest/Document ID 输入。 |
| `ainovr-win32-works-lower-2026-08-15.png` | `5817D4E0BBD2` | 项目文档列表、内部 document ID、revision/status 和结构化索引/版本比较入口。 |
| `ainovr-win32-reference-2026-08-15.png` | `5F7333E84A36` | 参考作品、SourceEdition、分析启动入口、Coverage 与 SourceSpan/Hash 证据列表。 |
| `ainovr-win32-reference-lower-2026-08-15.png` | `3653178A624C` | 分析阶段 JSON 提交、ResearchQuestion/AnalysisBrief、MechanismAsset 和分析链折叠项。 |
| `ainovr-win32-pending-2026-08-15.png` | `06125A339BB8` | 持久确认、queued 任务、机制候选空态和 `no_pattern` Coverage 处置。 |
| `ainovr-win32-pending-lower-2026-08-15.png` | `FA0EB074EEFC` | ChapterContract、StagePlan、BookOutline 的待审核列表与批准/驳回入口。 |
| `ainovr-win32-settings-2026-08-15.png` | `72566B71C09D` | 本地 Provider、协议、模型、上下文预算和角色路由。 |
| `ainovr-win32-settings-lower-2026-08-15-r3.png` | `13D48E3B6952` | 工作区预算尾部、线性 PipelineRevision 与原始步骤 JSON。 |

## 3. 视觉裁决

### 3.1 已经成立的部分

- 1296 × 839 视口下，固定四导航、卡片边界、字号和基本留白没有重叠、竖排挤压或明显截断。
- 作品页能真实显示上游 revision 变化导致的 stale，下游不会伪装成可执行。
- 参考页没有把整部原文铺进界面，SourceSpan、Hash、Coverage 和 `no_pattern` 都可见。
- 待处理页把确认、任务、机制、Coverage、规划审核分区，危险写操作没有伪装成普通按钮。
- 设置页没有显示 API Key；Provider 能力和工作区预算都能被看见。

以上只能判定为“工程状态可视化结构通过”，不能判定为“小说生产体验通过”。

### 3.2 当前不通过的核心问题

1. **界面用系统语言组织，而不是用创作任务组织。** 首屏主要信息是 `pending_review`、`stale`、`ContextManifest`、revision、对象 hash 和内部 stage；用户仍需自己翻译成“这一章为什么还不能写、现在应当审核什么”。
2. **主要人工输入仍是数据库边界的可视化壳。** ProjectIntent、分析阶段、ProductionCommit 和 Pipeline 都依赖原始 JSON；Chapter ID、Manifest ID、Document ID 需要人工复制。它们虽然受领域服务约束，但不构成人类可用的小说编辑界面。
3. **分析与创作的因果连接不可见。** 参考页显示 Fact/Thread/Question/Mechanism，作品页显示 CreativeRecipe/Manifest，但没有一条人类可读链说明“哪条原文证据形成了什么可迁移方法、为什么本章选择它、它将改变哪个可观察写作行为”。
4. **审核缺少同屏内容。** 待审核规划页有清楚的批准/驳回按钮，却不显示待审核内容本身；文案要求用户返回作品页检查，产生跨页记忆负担。
5. **作品页纵向密度过高。** 每章固定展开 11 个内部节点，尚未开始的 Reader/Editor 节点占据大量空间；重要的“当前一步”和“下一动作”没有获得最高视觉权重。
6. **设置页混合三种心智模型。** Provider 配置、创作策略和 Pipeline 编辑放在同一长页；普通创作设置与工程级工作流 JSON 没有分层。
7. **全局调试信息暴露。** 顶栏 `revision 40 · change 40` 对排障有用，对创作没有直接意义，应进入诊断详情而不是占据全局主导航。

## 4. 第一性原理结论

Ainovr 的 UI 首先应让人无需理解内部架构即可回答五个问题：

1. 我正在处理哪部参考作品或原创作品？
2. 当前分析/创作推进到了哪里？
3. 为什么停在这里？
4. 现在需要我阅读、修改或批准什么具体内容？
5. 这份分析产物最终影响了哪一章的什么写作行为？

当前界面对第 1–3 项有工程级答案，对第 4 项只有 JSON/跨页入口，对第 5 项几乎没有人类可读答案。因此本轮最终裁决为：

```text
win32_background_capture = passed
real_tauri_data_rendering = passed
structural_ui_visibility = passed
human_readable_novel_workflow = failed
analysis_to_generation_traceability = failed
```

下一阶段不应先更换色彩、图标或添加自由画布；应先做一条真实垂直切片，把“参考证据 → 可迁移写作机制 → 本章采用理由 → 生成/评审结果”改造成同屏可读、可编辑、可复核的领域界面。
