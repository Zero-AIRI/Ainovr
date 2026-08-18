# Ainovr stdio MCP companion 配置

本文只描述领域 MCP companion 的启动方式。MCP 通过 `Application Service` 访问工作区；它不提供 SQL、Secret 或任意路径文件读写工具。

云端 Provider 的密钥不写入工作区。启动 MCP 的进程如需云端调用，应设置由 Provider ID 编码得到的 `AINOVR_PROVIDER_<PROFILE_ID_CODE>_API_KEY` 环境变量；本地 Ollama 不需要密钥。编码规则是每个 Unicode 字符使用 6 位十六进制码并转为大写，例如 `zeus` 对应 `00007A000065000075000073`。

## 构建与手动启动

在工作区根目录执行：

```powershell
npm run build:mcp
node dist-mcp/ainovr-mcp.mjs --workspace .
```

进程使用 stdin/stdout 的 JSON Lines 通信。不要把 stdout 重定向到日志文件；宿主应把 stderr 作为诊断流。Ainovr UI 关闭时，companion 仍可独立执行查询、命令、确认和长任务。

工作区解析优先级固定为 `--workspace` → `AINOVR_WORKSPACE` → Windows `%APPDATA%\com.ainovr.app`。因此发布版外部 companion 不传路径时会与桌面端使用同一 AppData 工作区；开发、便携目录、测试夹具和恢复目录应显式传入 `--workspace <目录>`。空的 `--workspace` 会拒绝启动，不会悄悄切换工作区。

## 外部 Agent 配置

所有宿主都应调用同一个构建产物。下面的发布配置使用桌面端同一默认 AppData 工作区，且不包含 API Key：

### 通用 JSON 配置

```json
{
  "mcpServers": {
    "ainovr": {
      "command": "node",
      "args": [
        "<Ainovr 安装目录>\\resources\\desktop-sidecar\\ainovr-mcp.mjs"
      ]
    }
  }
}
```

### Claude Code

```powershell
claude mcp add ainovr -- node "<Ainovr 安装目录>\resources\desktop-sidecar\ainovr-mcp.mjs"
```

Codex、OpenCode 或其他 stdio MCP 宿主使用同样的 `command` 与 `args`。若需要便携工作区，在 MCP 命令末尾显式加入 `--workspace <目录>`。宿主的配置文件格式可能不同，但不应改为 HTTP/WebSocket，也不应传入数据库、对象库或任意文件路径。

## 最小连通性检查

向 stdin 发送以下请求，应该返回协议版本与工具列表：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

发布前必须重新运行 `npm run build:mcp`，并确认工具列表不包含 `read_data_file`、`write_data_file`、SQL 或通用文件工具。
