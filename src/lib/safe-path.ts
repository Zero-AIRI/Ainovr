// ============================================
// 路径安全工具 — 防止路径遍历攻击
// ============================================

import path from 'path';

/**
 * 验证 id 不包含路径遍历字符，并确保解析后的路径在 baseDir 内。
 * 返回安全路径，或抛出错误。
 */
export function safeJoin(baseDir: string, id: string): string {
  // 拒绝包含遍历字符的 id
  if (id.includes('..') || path.isAbsolute(id) || id.includes('\0')) {
    throw new Error(`非法 id: ${id}`);
  }

  const resolved = path.resolve(baseDir, id);
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep) && resolved !== path.resolve(baseDir)) {
    throw new Error(`路径越界: ${id}`);
  }

  return resolved;
}
