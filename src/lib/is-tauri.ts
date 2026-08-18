/**
 * 检测当前是否运行在 Tauri 桌面壳内。
 *
 * Tauri 在 WebView 的 window 上注入 `__TAURI_INTERNALS__`（IPC 桥）。
 * - Tauri 环境（npm run tauri dev / 打包后 exe）：true
 * - 纯浏览器 dev（npm run dev）/ Node 测试环境：false
 *
 * 全库唯一的检测真相源，避免各处重复内联字面量导致策略漂移。
 * 放 lib/（纯函数，零运行时依赖，各层都可 import）。
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
