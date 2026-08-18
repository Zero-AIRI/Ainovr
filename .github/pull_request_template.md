## 变更内容

-

## 原因与影响

-

## 验证

- [ ] 相关失败测试先行，随后最小实现
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run build:cli`
- [ ] `npm run build:mcp`
- [ ] `npm run prepare:desktop-sidecar`
- [ ] `cargo test`（涉及桌面端时）
- [ ] MCP `initialize` / `tools/list`（涉及 MCP/CLI 时）
- [ ] `npm run tauri build`（发布或桌面端变更时）
- [ ] `git diff --check` 与候选内容 Secret 扫描

## 风险与回滚

-
