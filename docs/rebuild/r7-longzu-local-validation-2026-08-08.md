# R7：第一册本地 FactExtractor 分块验证（2026-08-08）

状态：进行中。本文只记录已执行的探索性验证，**不**构成模型资格认证或第一册完成声明。

## 已验证的安全边界

- 所有动作均经 Ainovr CLI、`TaskRunner`、`CommandService` 和 ObjectStore 执行；没有直连 SQLite、对象文件或旧 JSON。
- 本地调用固定为回环 Ollama `http://localhost:11434/v1`，模型为 `qwen3.5:9b`，不使用或读取 API Key。
- 本地任务输出先经 JSON/合法 `spanId`/领域 Commit 校验；`finish_reason=length` 一律 fail closed，并写入任务与 Coverage 处置，而非提交部分事实。
- 本文不记录参考原文、人物、剧情、Prompt 或模型原始输出。

## 已执行的 Corpus 对比

| Corpus | 预算策略 | 计算单元 | 结果 |
|---|---:|---:|---|
| `analysis_r7_longzu_volume1_003` | 16,384 窗口、6,963 source tokens；旧 CJK 估算 | 33 | 发现 UTF-8 边界重复全量扫描性能瓶颈；修复后可建库。中等单元本地结构化输出超长，未提交事实。 |
| `analysis_r7_longzu_volume1_004` | 相同预算；CJK 按约 1 token 重估 | 46 | 避免了中文 token 低估，但中等单元对当前本地模型仍可能超出输出预算；失败均保持可恢复、无部分提交。 |
| `analysis_r7_longzu_volume1_005` | 8,192 窗口、409 source tokens | 722 | 微型实际正文单元 `unit:00003` 成功：任务 `succeeded`，FactLedger 提交 8 条，且无未解决 Coverage。 |
| `analysis_smoke_001` | 2,048 窗口、614 source tokens | 1 | 独立自写短文本的父级批任务 `batch_smoke_001` 成功：`qwen3.5:9b` 提交 10 条经 span 校验的事实、1 个 `complete` Coverage；父任务写入 `nextOrdinal: 2` checkpoint 和对象化摘要。 |

## 本轮实现修复

1. `AnalysisCorpusService` 对每段文本只构建一次 UTF-16→UTF-8 边界索引，消除每个 SourceSpan 重扫全文的 O(n²) 行为。
2. 分段估算改为 CJK/全角约 1 token、连续 ASCII 约 4 字符，遵循最终计划的保守预算规则。
3. 标准 Ollama FactExtractor 走原生 `/api/chat` 并发送 `think: false`；诊断请求确认该模型实例不会产生隐藏思考内容。
4. 事实批次强制为至多 16 条、每条至多 4 个证据 span，并限制字符串字段长度；该限制同时存在于 Prompt、JSON Schema、Ollama `format` 和本地解析器。
5. 新增 `local_fact_extraction_batch` 父任务：逐单元复用严格 FactExtractor；每一单元后写持久化 checkpoint，子任务失败会计入父级处置而不会静默跳过。父任务摘要对象与 `succeeded` 状态通过 `complete_local_fact_extraction_batch` 的单一 Command 事务登记，避免对象引用悬空。
6. 批任务已经 CLI 与 MCP 的薄适配器公开；二者只接收领域 ID、模型路由与预算，不接收 SQL、对象路径或通用文件读取参数。CLI 是长时间实际执行的推荐宿主；MCP 仅在 companion 持续运行时异步接管。

## 当前结论与后续验证

- `qwen3.5:9b` 已证明可对预算内微型单元完成真实、受控的事实抽取；它尚未证明能稳定处理 4–8 KB 的当前结构化单元。
- 批任务的“启动 → 本地调用 → 单元提交 → checkpoint → 对象化摘要 → 父任务完成”链路已由真实本地模型验证；仍必须在第一册的完整 722 单元范围内完成宿主中断、另一宿主接管和全量 Coverage 验收。
- 第一册尚未完成，不应启动全量自动任务，也不能声称吞吐、事实准确率、跨单元线程正确性或恢复覆盖率已达标。
- 下一轮应使用 005 的小单元完成有限本地样本，记录模型的 JSON Schema 成功率、合法 span 引用率、耗时、重试和弃权；随后再决定本地默认路由。云端升级策略不在本轮范围内。
- 当前 R7 工作区的 `list-provider-profiles` 非秘密投影为空；不得把历史探索报告或未配置的 Key 当作“云端对比已完成”。按用户于 2026-08-09 的明确指示，云端模型对比不启动且不纳入 R7 退出条件。
- 仍需按最终计划完成中断恢复、全单元 Coverage、`qwen3:8b` 的本地对比以及人工准确性抽查；云端模型对比已按用户指示跳过。

## 当前全量探索任务（持续运行）

已在独立工作区 `data/r7-longzu-20260808` 启动全量探索任务 `batch_r7_longzu_001`，目标为 `analysis_r7_longzu_volume1_batch_001`（722 个计算单元）。它不是完成声明；任务会持续写入父级 checkpoint，达到计划规定的 30%–50% 区间后再执行宿主中断与另一宿主接管验证。当前状态通过领域 CLI 查询，不直接读取数据库：

```text
status: running
model: qwen3.5:9b
checkpoint (last recorded): nextOrdinal=83, succeeded=71, failed=11
```

截至 2026-08-08 23:10（Asia/Shanghai），同一领域 CLI 的最新可复查读取为
`nextOrdinal=146`、`succeeded=121`、`failed=24`。失败不会静默丢弃：Coverage
查询会为相应单元保存 `invalid_output`、`failed_request` 或合理弃权等处置。

截至 2026-08-09 的后续领域查询，任务已处理前 200 个单元（`nextOrdinal=201`）：
Coverage 投影包含 156 个 `complete`、43 个 `failed`、1 个 `no_pattern`，没有空状态；
200 条 Coverage 分别对应 200 个不同的 `analysisUnitId`，当前尚无重复处置。该证据只证明
中断前的连续处理；中段接管发生后仍须重新验证 checkpoint 连续性和全量 Coverage。

已配置两层受限守卫以执行计划要求的中段接管：第一层只会在 `nextOrdinal` 落入
217–361 时确认旧 CLI 命令行后终止原宿主；第二层只会在该宿主退出、任务仍为
`running` 且 lease 到期后启动一次新的 CLI `resume-local-fact-extraction-batch` 宿主。
守卫不读取原文、对象、SQLite 或 `settings.json`；接管后的新 leaseOwner、checkpoint
连续性、Coverage 与无重复正式产物仍须在任务恢复后实际复核，不能由本守卫代替。

## 实际中段中断与接管（2026-08-09）

在 `nextOrdinal=217` 时，第一层守卫实际终止旧宿主 `cli-fact-batch:4484`；旧 lease
自然到期后，父任务仍保持 `running`。首次恢复暴露缺陷：父任务无条件重新创建
`unit:00217`，而该子任务已存在，导致同一 `resource_key` 被拒绝。该失败被保留为
父任务 retry 记录，未产生重复 Coverage。

先以失败测试固定该场景，再修复批服务：已终态子任务直接计入 checkpoint，过期的
`running/queued` 子任务改为接管，只有不存在子任务才创建。定向测试通过后，恢复
`unit:00217` 并重试父任务；新宿主 `cli-fact-batch:6500` 已将 checkpoint 从 217
连续推进到 220（`succeeded=170`、`failed=49`）。这证明真实中断后的恢复路径可继续
执行；全量完成后仍须复核完整 Coverage 与无重复产物。

## qwen3:8b 对照样本（2026-08-09）

为补充本地路由对照，在同一已保存的 SourceEdition 上通过领域 CLI 为每个样本建立隔离的
单单元 AnalysisCorpus（各自只引用既有计算单元的字节范围，不读取或复制原文文件），并执行：

- 模型：`qwen3:8b`；地址：`http://127.0.0.1:11434/v1`。
- 单元 1：`analysis_r7_qwen3_compare_20260809` /
  `task_r7_qwen3_compare_extract_20260809`，Task `succeeded`，零重试，Coverage 为
  `no_pattern/analyzed_no_signal`；这是一条可审计弃权，不是缺失或失败。
- 单元 2：`analysis_r7_qwen3_compare_20260809_u02` /
  `task_r7_qwen3_compare_extract_20260809_u02`，Task `succeeded`，零重试，Coverage 为
  `complete/used`。
- 单元 3：`analysis_r7_qwen3_compare_20260809_u03` /
  `task_r7_qwen3_compare_extract_20260809_u03`，Task `succeeded`，零重试，Coverage 为
  `complete/used`。

三项均使用与完整批任务前三个计算单元相同的既有字节范围；`qwen3.5:9b` 对应单元的
Coverage 投影分别也是 `no_pattern/analyzed_no_signal`、`complete/used` 和 `complete/used`。
这只说明此有限样本的处置一致，尚未衡量事实准确率、吞吐或全册 JSON 成功率。

这只是单单元探索性对照，不能外推为全册成功率、吞吐或模型资格认证；完整 722 单元任务
随后已按用户指示在第 256 个处置单元后正常取消。当前配置的云端 Provider 投影为空，且云端比较已按用户指示跳过。

## 已提交 FactLedger 完整性抽查（2026-08-09）

在不读取原文、对象文件或 SQLite 的前提下，通过领域 CLI 从当时已完成的主任务 Coverage
投影抽取前 50 个 `complete` / `no_pattern` 单元，再逐项读取对应 FactLedger：

- 49 个 `complete/used` 单元均至少包含一条已提交事实；
- 1 个 `no_pattern/analyzed_no_signal` 单元的 FactLedger 为空；
- 未发现 Coverage 状态与已提交账本数量不一致的异常。

此检查证明已提交投影没有出现“完成但空账本”或“弃权却写入事实”的完整性问题；它不替代
最终全量核对，也不替代需要人工阅读原文的事实准确性抽查。

## 用户跳过全量批处理（2026-08-09）

用户明确要求跳过持续运行的 722 单元全量任务后，已通过领域 `cancel-task` 请求正常停止
`batch_r7_longzu_001`；没有强制终止进程或删除任何已提交结果。父任务在当前子单元边界
进入 `cancelled`，CLI 宿主已退出，最终保留：

- checkpoint：`nextOrdinal=257`，即前 256 个单元已有处置；
- 198 个成功、58 个明确 `invalid_output` 失败；
- 256 条 FactLedger Coverage，且 256 个 `analysisUnitId` 均不重复。

因此“第一册 722 单元全量完成、全量人工抽查和完整吞吐统计”已按用户指示跳过，不能作为
R7 完成或模型资格的证据；已完成的中段接管、局部对照、Coverage 和完整性证据仍保留。
