// ============================================
// 原子写入工具 — 防止并发写入导致文件损坏
// 使用临时文件 + rename 实现写入原子性
// ============================================

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * 原子写入 JSON 文件
 * 先写临时文件，成功后再 rename（同一文件系统内 rename 是原子的）
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${Date.now()}.tmp`);

  try {
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(tempPath, json, 'utf-8');
    // Windows 上 rename 可能因文件锁定失败，重试 3 次
    await retryRename(tempPath, filePath, 3);
  } catch (err) {
    // 清理临时文件
    try { await fs.unlink(tempPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * 原子写入文本文件
 */
export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${Date.now()}.tmp`);

  try {
    await fs.writeFile(tempPath, content, 'utf-8');
    await retryRename(tempPath, filePath, 3);
  } catch (err) {
    try { await fs.unlink(tempPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * 带重试的 rename（处理 Windows 文件锁定）
 */
async function retryRename(from: string, to: string, retries: number): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err: unknown) {
      if (i === retries - 1) throw err;
      // Windows EBUSY: 等待 100ms 重试
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * 批量原子保存 — 一次保存多个文件，全部成功或全部回滚
 * 注意：这不是真正的分布式事务，仅提供尽力而为的批量操作
 */
export async function atomicWriteBatch(
  files: Array<{ filePath: string; content: string | object }>,
): Promise<void> {
  const tempPaths: string[] = [];

  try {
    // Phase 1: 全部写临时文件
    for (const file of files) {
      const dir = path.dirname(file.filePath);
      const tempPath = path.join(dir, `.${path.basename(file.filePath)}.${Date.now()}.tmp`);
      tempPaths.push(tempPath);

      const data = typeof file.content === 'string' ? file.content : JSON.stringify(file.content, null, 2);
      await fs.writeFile(tempPath, data, 'utf-8');
    }

    // Phase 2: 全部 rename
    for (let i = 0; i < files.length; i++) {
      await retryRename(tempPaths[i], files[i].filePath, 3);
    }
  } catch (err) {
    // 清理所有临时文件
    for (const tp of tempPaths) {
      try { await fs.unlink(tp); } catch { /* ignore */ }
    }
    throw err;
  }
}
