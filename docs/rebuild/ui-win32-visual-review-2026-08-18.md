# Ainovr 当前发布版 Win32 视觉复验（2026-08-18）

## 复验方式

在隔离 replay workspace 启动真实 Tauri release。所有位图均由 `PrintWindow(PW_RENDERFULLCONTENT)` 产生；页面切换、选择章节和展开详情只使用该临时进程的窗口消息，未保存表单、批准确认、调用模型或改变项目事实。

## 当前位图账本

| 截图 | 尺寸 | SHA-256 前 12 位 | 已验证状态 |
|---|---:|---:|---|
| `ainovr-win32-p6-works-human-readable-1280x800.png` | 1280 × 800 | `F3E4CC6C3D51` | 作品页三栏布局、章节方法工作台、可读的阶段与下一步；默认不显示内部 revision、chapter ID 或 commit ID。 |
| `ainovr-win32-p6-works-diagnostics-open-1280x800.png` | 1280 × 800 | `2D8857AEA9B6` | 顶栏诊断按需展开，workspace revision/change 以独立浮层展示且没有遮挡主内容。 |
| `ainovr-win32-p6-works-human-readable-narrow-900x800.png` | 900 × 800 | `268A0E6739DB` | 小窗口转换为单列，导航、章节选择和状态卡均可见，无横向截断。 |
| `ainovr-win32-p6-pending-evidence-1280x800.png` | 1280 × 800 | `99A14BB2680` | 待处理方法卡、展开 SourceSpan 定位摘要、采纳/仅 Editor/拒绝操作均可见。 |
| `ainovr-win32-p6-evidence-release-20260818.png` | 1296 × 839 | `B4AE9CCEF4F8` | 本轮 P6 草稿/盲评证据绑定改动后的新 release 首屏；打包 Node sidecar 能连接隔离 SQLite，三栏工作台可读且无重叠或异常空态。 |

最终 Tauri 打包完成后，使用同一隔离 workspace 重拍 `ainovr-win32-final-release-works-1280x800.png`；其 SHA-256 与第一张一致（`F3E4CC6C3D51…`），证明最终 release 的首屏没有引入额外视觉漂移。

在后续 P6 证据绑定实现与 2026-08-18 04:30 release 重建后，再次启动同一隔离 workspace 并捕获上述 `1296 × 839` 位图。该轮不改变 React/CSS，只验证当前打包 sidecar 与 SQLite 仍能让桌面工作台正常起屏；临时窗口随后已正常关闭。

## 裁决

- 当前 release 的 1280 × 800 与 900 × 800 均没有观察到重叠、竖排、横向溢出或不可读的默认内部标识。
- 默认视图现在按创作任务组织；revision、change sequence、chapter/commit ID 与对象级信息仅在“诊断详情”按需显示。
- 本轮没有重新执行带风险接受、过期确认、CAS 冲突或正式章节批准，因为这些状态的既有 replay 位图仍覆盖其交互契约，且本轮未修改相应 UI/领域代码。它们不构成 P6 真实实验通过证据。
