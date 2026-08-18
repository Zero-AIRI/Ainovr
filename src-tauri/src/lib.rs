use serde_json::Value as JsonValue;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

struct DesktopMcpChild {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

/** Rust only owns the trusted sidecar lifecycle. All novel-domain rules remain in TypeScript. */
struct DesktopMcpSidecar {
    child: Mutex<Option<DesktopMcpChild>>,
}

#[tauri::command]
fn desktop_mcp_request(
    app: AppHandle,
    sidecar: State<'_, DesktopMcpSidecar>,
    request: JsonValue,
) -> Result<JsonValue, String> {
    assert_desktop_mcp_request(&request)?;
    let mut guard = sidecar
        .child
        .lock()
        .map_err(|_| "Ainovr desktop MCP sidecar lock is unavailable.".to_string())?;
    if guard.is_none() {
        *guard = Some(spawn_desktop_mcp_sidecar(&app)?);
    }
    let child = guard
        .as_mut()
        .ok_or_else(|| "Ainovr desktop MCP sidecar did not start.".to_string())?;
    let line = serde_json::to_string(&request)
        .map_err(|error| format!("Could not serialize desktop MCP request: {error}"))?;
    if child
        .stdin
        .write_all(line.as_bytes())
        .and_then(|_| child.stdin.write_all(b"\n"))
        .and_then(|_| child.stdin.flush())
        .is_err()
    {
        *guard = None;
        return Err(
            "Ainovr desktop MCP sidecar is unavailable. Please restart the desktop application."
                .to_string(),
        );
    }
    let mut response = String::new();
    if child
        .stdout
        .read_line(&mut response)
        .map_err(|error| format!("Could not read desktop MCP response: {error}"))?
        == 0
    {
        *guard = None;
        return Err("Ainovr desktop MCP sidecar exited unexpectedly. Please restart the desktop application.".to_string());
    }
    serde_json::from_str(response.trim())
        .map_err(|error| format!("Ainovr desktop MCP sidecar returned invalid JSON: {error}"))
}

fn assert_desktop_mcp_request(request: &JsonValue) -> Result<(), String> {
    let object = request
        .as_object()
        .ok_or_else(|| "Desktop request must be a JSON-RPC object.".to_string())?;
    if object.get("jsonrpc") != Some(&JsonValue::String("2.0".to_string())) {
        return Err("Desktop request must use JSON-RPC 2.0.".to_string());
    }
    let method = object
        .get("method")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| "Desktop request method is required.".to_string())?;
    if method != "initialize" && method != "ping" && method != "tools/call" {
        return Err(
            "Desktop sidecar only accepts MCP initialize, ping, and tools/call.".to_string(),
        );
    }
    if method == "tools/call" {
        let name = object
            .get("params")
            .and_then(JsonValue::as_object)
            .and_then(|params| params.get("name"))
            .and_then(JsonValue::as_str);
        if name.is_none() {
            return Err("Desktop tools/call request requires a domain tool name.".to_string());
        }
    }
    Ok(())
}

fn spawn_desktop_mcp_sidecar(app: &AppHandle) -> Result<DesktopMcpChild, String> {
    let script = if cfg!(debug_assertions) {
        workspace_root(app)?.join("dist-mcp").join("ainovr-mcp.mjs")
    } else {
        release_sidecar_directory(
            app.path()
                .resource_dir()
                .map_err(|error| format!("Could not resolve Ainovr resources: {error}"))?,
        )?
        .join("ainovr-mcp.mjs")
    };
    if !script.is_file() {
        return Err(format!(
            "Ainovr desktop MCP companion is missing: {}",
            script.display()
        ));
    }
    let script = node_process_path(script);
    let node = if cfg!(debug_assertions) {
        PathBuf::from(
            std::env::var("AINOVR_NODE_EXECUTABLE").unwrap_or_else(|_| "node".to_string()),
        )
    } else {
        node_process_path(
            release_sidecar_directory(
                app.path()
                    .resource_dir()
                    .map_err(|error| format!("Could not resolve Ainovr resources: {error}"))?,
            )?
            .join("node.exe"),
        )
    };
    let workspace = node_process_path(workspace_root(app)?);
    let mut command = Command::new(node);
    command
        .arg(script)
        .arg("--workspace")
        .arg(workspace)
        .arg("--desktop-ui")
        .env("AINOVR_DESKTOP_SIDECAR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_sidecar_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Ainovr desktop MCP companion: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Ainovr desktop MCP companion has no stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Ainovr desktop MCP companion has no stdout.".to_string())?;
    Ok(DesktopMcpChild {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

#[cfg(windows)]
fn configure_sidecar_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    // 运行时组装豁免：Node 是桌面端内部 sidecar，不应创建用户可见的控制台窗口。
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_sidecar_process(_command: &mut Command) {}

fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return std::env::current_dir()
            .map_err(|error| format!("Could not resolve development workspace: {error}"))
            .and_then(development_workspace_root);
    }
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve Ainovr application data directory: {error}"))
        .and_then(|app_data_dir| {
            release_workspace_root_with_override(
                app_data_dir,
                std::env::var("AINOVR_WORKSPACE").ok().as_deref(),
            )
        })
}

/// 发布态只允许一个显式工作区覆盖，便于 CLI、MCP 与桌面端对同一隔离目录验收。
/// 未设置时继续使用 Tauri 提供的用户可写应用数据目录。
fn release_workspace_root_with_override(
    app_data_dir: PathBuf,
    environment_workspace: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(workspace) = environment_workspace
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(workspace));
    }
    if app_data_dir.as_os_str().is_empty() {
        Err("Ainovr application data directory is empty.".to_string())
    } else {
        Ok(app_data_dir)
    }
}

fn release_sidecar_directory(resource_dir: PathBuf) -> Result<PathBuf, String> {
    if resource_dir.as_os_str().is_empty() {
        Err("Ainovr resource directory is empty.".to_string())
    } else {
        Ok(resource_dir.join("resources").join("desktop-sidecar"))
    }
}

fn node_process_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

fn development_workspace_root(current: PathBuf) -> Result<PathBuf, String> {
    if current.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        return current
            .parent()
            .map(PathBuf::from)
            .ok_or_else(|| "Could not resolve development workspace root.".to_string());
    }
    Ok(current)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopMcpSidecar {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![desktop_mcp_request])
        .run(tauri::generate_context!())
        .expect("error while running Ainovr application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_workspace_root_uses_parent_of_src_tauri() {
        assert_eq!(
            development_workspace_root(PathBuf::from(r"C:\work\Ainovr\src-tauri"))
                .expect("resolve workspace root"),
            PathBuf::from(r"C:\work\Ainovr")
        );
    }

    #[test]
    fn development_workspace_root_preserves_an_existing_workspace_directory() {
        let current = PathBuf::from(r"C:\work\Ainovr");
        assert_eq!(
            development_workspace_root(current.clone()).expect("resolve workspace root"),
            current
        );
    }

    #[test]
    fn release_workspace_root_uses_user_writable_application_data() {
        assert_eq!(
            release_workspace_root_with_override(
                PathBuf::from(r"C:\Users\user\AppData\Local\com.ainovr.app"),
                None
            )
            .expect("resolve app data"),
            PathBuf::from(r"C:\Users\user\AppData\Local\com.ainovr.app")
        );
        assert!(release_workspace_root_with_override(PathBuf::new(), None).is_err());
    }

    #[test]
    fn release_workspace_root_prefers_explicit_ainovr_workspace() {
        assert_eq!(
            release_workspace_root_with_override(
                PathBuf::from(r"C:\Users\user\AppData\Local\com.ainovr.app"),
                Some(r"C:\fixture\com.ainovr.app"),
            )
            .expect("resolve explicit workspace"),
            PathBuf::from(r"C:\fixture\com.ainovr.app"),
        );
    }

    #[test]
    fn release_sidecar_directory_matches_the_bundled_resource_layout() {
        assert_eq!(
            release_sidecar_directory(PathBuf::from(r"C:\Program Files\Ainovr"))
                .expect("resolve release sidecar directory"),
            PathBuf::from(r"C:\Program Files\Ainovr\resources\desktop-sidecar")
        );
        assert!(release_sidecar_directory(PathBuf::new()).is_err());
    }

    #[test]
    fn node_process_paths_remove_windows_verbatim_prefixes() {
        assert_eq!(
            node_process_path(PathBuf::from(
                r"\\?\S:\Ainovr\resources\desktop-sidecar\ainovr-mcp.mjs"
            )),
            PathBuf::from(r"S:\Ainovr\resources\desktop-sidecar\ainovr-mcp.mjs")
        );
        assert_eq!(
            node_process_path(PathBuf::from(r"\\?\UNC\server\share\ainovr-mcp.mjs")),
            PathBuf::from(r"\\server\share\ainovr-mcp.mjs")
        );
        assert_eq!(
            node_process_path(PathBuf::from(r"C:\Ainovr\ainovr-mcp.mjs")),
            PathBuf::from(r"C:\Ainovr\ainovr-mcp.mjs")
        );
    }

    #[test]
    fn desktop_sidecar_rejects_non_mcp_and_unnamed_tool_requests() {
        assert!(assert_desktop_mcp_request(
            &serde_json::json!({ "jsonrpc": "2.0", "method": "sql_query" })
        )
        .is_err());
        assert!(assert_desktop_mcp_request(
            &serde_json::json!({ "jsonrpc": "2.0", "method": "tools/call", "params": {} })
        )
        .is_err());
        assert!(assert_desktop_mcp_request(&serde_json::json!({ "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_workspace_status" } })).is_ok());
    }
}
