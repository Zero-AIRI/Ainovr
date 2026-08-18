# Ainovr stdio MCP companion 配置

本文只描述领域 MCP companion 的启动方式。MCP 通过 `Application Service` 访问工作区；它不提供 SQL、`settings.json` 或任意路径文件读写工具。

## 构建与手动启动

在工作区根目录执行：

```powershell
npm run build:mcp
node dist-mcp/ainovr-mcp.mjs --workspace S:\Ainovr
```

进程使用 stdin/stdout 的 JSON Lines 通信。不要把 stdout 重定向到日志文件；宿主应把 stderr 作为诊断流。Ainovr UI 关闭时，companion 仍可独立执行查询、命令、确认和长任务。

## 外部 Agent 配置

所有宿主都应调用同一个构建产物，并显式传入固定工作区路径。下面的命令不包含 API Key：

### 通用 JSON 配置

```json
{
  "mcpServers": {
    "ainovr": {
      "command": "node",
      "args": [
        "S:\\Ainovr\\dist-mcp\\ainovr-mcp.mjs",
        "--workspace",
        "S:\\Ainovr"
      ]
    }
  }
}
```

### Claude Code

```powershell
claude mcp add ainovr -- node S:\Ainovr\dist-mcp\ainovr-mcp.mjs --workspace S:\Ainovr
```

Codex、OpenCode 或其他 stdio MCP 宿主使用同样的 `command` 与 `args`。宿主的配置文件格式可能不同，但不应改为 HTTP/WebSocket，也不应传入数据库、对象库或任意文件路径。

## 最小连通性检查

向 stdin 发送以下请求，应该返回协议版本与工具列表：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

发布前必须重新运行 `npm run build:mcp`，并确认工具列表不包含 `read_data_file`、`write_data_file`、SQL 或通用文件工具。
