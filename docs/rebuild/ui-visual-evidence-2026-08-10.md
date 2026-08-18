# UI 视觉证据账本（2026-08-10）

本账本逐张记录本地受控证据目录中的 Ainovr 截图。判定标准是：一张图只能证明其实际显示的布局、文本和状态；出现渲染异常、sidecar 错误或已被更正的错误语义时，不能作为通过证据。

## 逐图判定

| 文件 | SHA-256（前 12 位） | 判定 | 可证明 / 不可证明 |
|---|---:|---|---|
| `ainovr-works-empty.png` | `30D129C4E3D3` | 无效 | 导航和正文发生竖排挤压，不能证明布局。 |
| `ainovr-references-empty.png` | `3E53CC16F3B1` | 无效 | 同样发生竖排挤压。 |
| `ainovr-works-viewport.png` | `16DFEBDD9A8F` | 过时 | 布局可读，但没有选中作品时错误显示“正在读取当前章节”；由 r2 替代。 |
| `ainovr-works-viewport-2026-08-10-r2.png` | `33777284D440` | 通过（空状态） | 四导航、三栏空状态、创建项目入口和无选中时的正确文案。 |
| `ainovr-references-viewport.png` | `9C86FADF78E1` | 重复 | 与同日 r2 完全相同。 |
| `ainovr-references-viewport-2026-08-10-r2.png` | `9C86FADF78E1` | 通过（空状态） | 参考页不铺开原文，清楚显示 SourceSpan/Hash/Coverage 边界。 |
| `ainovr-pending-viewport.png` | `6B38AAA493D1` | 重复 | 与同日 r2 完全相同。 |
| `ainovr-pending-viewport-2026-08-10-r2.png` | `6B38AAA493D1` | 通过（空状态） | 确认、任务、机制、Coverage 与规划审核的分区清晰。 |
| `ainovr-pending-empty.png` | `CB6A004C7CC4` | 通过（空状态） | 同页空态可读；不能证明有待处理数据的操作。 |
| `ainovr-settings-viewport.png` | `96B5B897354A` | 重复 | 与同日 r2 完全相同。 |
| `ainovr-settings-viewport-2026-08-10-r2.png` | `96B5B897354A` | 通过（空状态） | Provider、协议、预算与 Secret 不回显说明可读。 |
| `ainovr-settings-viewport-2026-08-10-r3.png` | `553FFF66C775` | 通过（空状态） | 同上；无自由画布或 SQL/任意文件入口。 |
| `ainovr-settings-policy-viewport-2026-08-10-r3.png` | `8A7307F4B2D2` | 通过（空状态） | Provider 与工作区预算的共同约束说明可读。 |
| `ainovr-settings-pipeline-viewport-2026-08-10-r2.png` | `6093CBB2CC8F` | 有条件通过 | 线性 PipelineRevision 入口符合产品决策；JSON 编辑对非技术用户的易用性未被证明。 |
| `ainovr-real-tauri-reference-2026-08-10.png` | `83D222C8D1EA` | 无效 | 有 `desktop MCP sidecar is unavailable` 红条，不能证明可用桌面态。 |
| `ainovr-real-tauri-works-after-reference-2026-08-10.png` | `75ABFB3F24F2` | 无效 | 同样出现 sidecar 不可用错误。 |
| `ainovr-real-tauri-works-2026-08-10.png` | `91B19B78A175` | 重复 | 与 `ainovr-release-works-retry-2026-08-10.png` 完全相同。 |
| `ainovr-release-works-retry-2026-08-10.png` | `91B19B78A175` | 通过（有数据结构） | 线性章节生产链、`pending_review`、stale、下游阻塞和三栏状态可读；不证明正文编辑体验。 |
| `ainovr-release-reference-retry-2026-08-10.png` | `5921E65A5E13` | 通过（有数据结构） | SourceEdition、SourceSpan/Hash、V2 分析、Coverage 结构可读；不证明完整原文阅读/取证交互。 |
| `ainovr-release-pending-2026-08-10.png` | `B5DB83721DE5` | 通过（有数据结构） | 持久 confirmation、queued task、`no_pattern` Coverage 可见；不证明每类批准/拒绝操作。 |
| `ainovr-release-settings-2026-08-10.png` | `335F93D887BD` | 通过（有数据结构） | Provider 路由、预算和无 Secret 显示可读；未覆盖“更新既有 Provider → 待确认”状态。 |
| `ainovr-settings-empty.png` | `47B334D89BFD` | 通过（空状态） | 设置页结构可读；和 r2/r3 的差异不构成额外功能证据。 |

## 结论

- 有效截图证明四个固定工作台、无内置聊天/自由画布、线性章节生产链与核心分析/待处理/设置投影均可读。
- 有两组明确无效的早期布局图和两张明确无效的 sidecar 错误图；它们不参与任何“视觉通过”结论。
- 当前证据仍不足以证明：所有编辑控件的交互易用性、全量真实数据态、Provider 更新确认态、正文选区问诊，或所有 DPI/窗口尺寸下的视觉质量。
# 第十二轮逐图复核（2026-08-10，Pipeline 依赖门之后）

本轮重新通过本机图片查看器打开本地受控目录下的全部 **22** 张 PNG，并用 SHA-256 去重为 **17** 张像素不同的图片。重复文件只计一次，不把同一张图片以不同名称重复计入证据：

- `ainovr-pending-viewport.png` = `ainovr-pending-viewport-2026-08-10-r2.png`；
- `ainovr-references-viewport.png` = `ainovr-references-viewport-2026-08-10-r2.png`；
- `ainovr-settings-viewport.png` = `ainovr-settings-viewport-2026-08-10-r2.png`；
- `ainovr-real-tauri-works-2026-08-10.png` = `ainovr-release-works-retry-2026-08-10.png`。

审查原则是“图片只能证明它真实呈现的像素和状态，不能替代缺失状态、领域约束或后续代码变更”。结论如下：

| 图片组 | 逐图结论 | 是否可作为当前通过证据 |
|---|---|---|
| `*-empty.png` 与 `*-viewport-r2/r3.png` | 可证明当时浏览器预览的空状态、四个一级入口和浅色工作台基本布局；不含真实项目、任务、证据或生产 lineage。旧 `works-empty` 仍包含已在后续修正的错误空状态语义。 | 仅空状态/历史布局；不能证明当前产品闭环。 |
| `ainovr-real-tauri-reference*`、`ainovr-real-tauri-works-after-reference*` | 含当时 sidecar 不可用或未成功读取所需 SQLite 投影的状态。 | 无效，不作为通过证据。 |
| `ainovr-real-tauri-works*` / `ainovr-release-works-retry*` | 可证明真实 Tauri 有数据作品页、固定生产链和章节元数据投影。 | 结构性通过；不能证明正文编辑、Manifest、Reviewer/Editor 细粒度操作。 |
| `ainovr-release-reference-retry*` | 可证明参考页能显示 SourceSpan/Hash/Coverage 等索引。 | 结构性通过；不证明原文核验、Dossier 质量或遗漏处置交互。 |
| `ainovr-release-pending*` | 可证明待处理页存在 confirmation、任务、Coverage 与规划审核区域。 | 结构性通过；不证明批准、冲突、失败恢复的完整交互。 |
| `ainovr-release-settings*`、`settings-policy*` | 可证明非秘密 Provider、预算、策略与线性 Pipeline 编辑区当时可见。 | 结构性通过；Provider 已配置成功、确认冲突、Secret 可用性均未验证。 |
| `settings-pipeline-viewport-r2` | 只证明旧的 Pipeline 编辑/运行外观。当前实现已增加 `dependsOn`、execution 分类与禁止跳步，因此该图没有显示新依赖提示或按钮禁用态。 | 对当前 Pipeline 语义已过时，必须重拍。 |

本轮不会把这些截图宣称为完整 UI 验收。特别是最新的 Pipeline 依赖门还缺少下列真实 Tauri 位图：前置节点未完成时的禁用态、`human_review` 节点无自动执行按钮、完成前置任务后的解锁态，以及冻结模型路由的可读投影。Windows Graphics Capture 的历史 `0x80004002` 阻断仍然存在；在得到有效捕获前，UIA/组件测试只能证明结构和行为，不能证明 DPI、遮挡、截断、颜色层级或最终可读性。
