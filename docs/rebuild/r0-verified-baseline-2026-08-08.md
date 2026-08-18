# R0：最终重构冻结基线（2026-08-08）

- 状态：完成
- TDD 状态：备份、恢复演练、基线记录和 ADR/AGENTS 更新属于 R0 治理豁免；没有修改产品行为。
- Git 基线：`master`，`996e0fdf87a30605ac8eab43d6746ef89938e710`，相对 `origin/master` 领先 170 个提交。
- 工作树：存在大量已修改和未跟踪文件；所有这些文件均视为用户资产，未执行 reset、checkout 覆盖、删除、自动 stage、commit 或 push。

## 外部备份与恢复演练

已在工作区外的本地备份目录生成：

- 全部 Git refs 的 bundle；
- 已暂存和未暂存 tracked binary patch；
- 保持相对路径的 242 个未跟踪源码/文档文件归档；
- 根 `data/` 和 `src-tauri/data/` 的完整副本；
- SHA-256 manifest、备份元数据与恢复证明。

`data/settings.json` 只作为本地安全备份的一部分复制，并仅在备份元数据中记录 SHA-256；本报告未读取、打印或记录其内容。

在独立临时目录执行了 bundle clone、补丁应用、未跟踪归档展开和两组数据恢复。恢复证明逐项通过：

| 校验 | 结果 |
|---|---|
| 未暂存补丁 | SHA-256 一致 |
| 暂存补丁 | SHA-256 一致 |
| 未跟踪源码/文档 | 242 个文件逐项 SHA-256 一致 |
| 根 `data/` | 1,397 个文件逐项 SHA-256 一致 |
| `src-tauri/data/` | 95 个文件逐项 SHA-256 一致 |
| 备份 manifest | 全部 Hash 验证通过 |

## 真实基线

执行时间：2026-08-08（本工作树、默认测试不访问真实 API）。

| 命令 | 结果 |
|---|---|
| `npm test` | 159 个测试文件通过、2 个跳过；1,109 个测试通过、13 个跳过 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过；仅有既有 Tauri FS 动静态导入分包提示 |
| `npm run build:mcp` | 通过 |

## 冻结的测试资产与契约入口

这些仅是 R1 迁移的对照样本，不是允许继续以 JSON 作为新系统真相的理由：

| 资产 | 位置 | 用途 |
|---|---|---|
| R0 短篇、三章、失败运行 fixture | `src/__tests__/fixtures/rebuild-r0.ts` | 回归验证版本、章节计划、production cursor 与失败恢复语义 |
| R0 领域 fixture 测试 | `src/__tests__/rebuild/r0-domain-fixtures.test.ts` | 固定 fixture 的领域可用性 |
| V2 证据分析 JSON Schema | `src/lib/analysis/analysis-json-schemas.ts` | Reading/事实/链接等结构化输出的既有严格格式入口 |
| V2 Schema 测试 | `src/__tests__/lib/analysis/analysis-json-schemas.test.ts` | 确认 Provider 格式与导出 Schema 的对应关系 |
| 现有生产领域模型 | `src/lib/production/` | 用于识别 R1 Repository/Commit 所需领域对象，不直接迁移旧持久化 JSON |

R1 必须建立新的 schema registry、SQLite fixture 和双宿主契约测试；不得把上述旧运行数据接入新数据库，也不得在新实现中回退读取旧业务 JSON。

## R1 准入结论

R0 的备份、恢复、基线、决策记录和过时指令替换均已完成。下一步从失败的 `SqlDriver` 双适配器契约测试开始，再引入 Node `better-sqlite3`、Tauri `rusqlite`、迁移 `0001` 和 ObjectStore。
