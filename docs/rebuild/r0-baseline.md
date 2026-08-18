# R0：重构冻结基线

日期：2026-07-26。

本阶段不修改产品行为；它冻结后续迁移和领域验收所需的独立样本。样本位于 `src/__tests__/fixtures/rebuild-r0.ts`：

- `R0_SHORT_WORK_V1`：旧版短篇作品，验证 v1→v2 的默认值、正文前提、revision 和时间戳不被重写。
- `R0_MULTICHAPTER_WORK`：三章作品，覆盖章节计划、情感周期、production cursor 与作品级状态。
- `R0_FAILED_RUN`：Writer 阶段失败但保留 chapter/workflow 游标的运行，覆盖恢复与运行中心读取。

当前完整单测基线命令为 `npm test`。冻结时的结果：1046 个测试中 1028 通过、5 失败、13 跳过。失败均为既有工作区改动造成，未在 R0 中改动产品代码：

- `book-analysis-v2.test.ts`：测试仍限制 link batch 的输出 token 不超过 8000，但当前模板已提升为 64000。
- `production-run-persistence.test.ts` 的 4 个用例：fixture 未包含当前生产结果必需字段 `automatedGatePassed`，导致后续 provenance 断言未到达。

上述两类断言/fixture 已在 R1 开始前同步到既有生产契约；当前完整套件为 1039 通过、13 跳过、0 失败。

后续 R1+ 的验收规则：不得把真实 `data/` 作为唯一测试输入；所有写入必须在独立内存或临时文件系统中验证。R2 迁移需额外验证真实旧文件的备份与 manifest，但不得删除原文件。
