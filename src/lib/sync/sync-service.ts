// ============================================
// 文件同步服务 — File System Access API
// ============================================

import { storeDirectoryHandle, loadDirectoryHandle, removeDirectoryHandle } from './idb-helpers';
import type { ParsedNovel, ChatMessage } from '@/types';

/** 过滤文件名中的非法字符 */
function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

/** 写入文本文件 */
async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** 读取文本文件，不存在返回 null */
async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

class SyncService {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private novelsHandle: FileSystemDirectoryHandle | null = null;
  private dotAinovrHandle: FileSystemDirectoryHandle | null = null;

  /** 初始化：从 IndexedDB 恢复句柄并验证权限 */
  async init(): Promise<boolean> {
    if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
      return false;
    }

    try {
      const handle = await loadDirectoryHandle();
      if (!handle) return false;

      const granted = await this.verifyPermission(handle);
      if (!granted) return false;

      this.rootHandle = handle;
      await this.ensureStructure();
      return true;
    } catch {
      return false;
    }
  }

  /** 用户手动选择文件夹 */
  async pickFolder(): Promise<boolean> {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      this.rootHandle = handle;
      await storeDirectoryHandle(handle);
      await this.ensureStructure();
      return true;
    } catch {
      return false;
    }
  }

  /** 验证目录权限 */
  private async verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  /** 创建 novels/ 和 .ainovr/ 子目录 */
  private async ensureStructure(): Promise<void> {
    if (!this.rootHandle) return;
    this.novelsHandle = await this.rootHandle.getDirectoryHandle('novels', { create: true });
    this.dotAinovrHandle = await this.rootHandle.getDirectoryHandle('.ainovr', { create: true });
  }

  getFolderName(): string | null {
    return this.rootHandle?.name ?? null;
  }

  isInitialized(): boolean {
    return this.rootHandle !== null && this.dotAinovrHandle !== null;
  }

  // ---- 写入操作 ----

  async writeNovel(novel: ParsedNovel): Promise<void> {
    if (!this.novelsHandle) return;
    await writeTextFile(this.novelsHandle, `${safeFilename(novel.title)}.txt`, novel.fullText);
  }

  async removeNovel(title: string): Promise<void> {
    if (!this.novelsHandle) return;
    try {
      await this.novelsHandle.removeEntry(`${safeFilename(title)}.txt`);
    } catch {
      // 文件可能不存在
    }
  }

  async writeMeta(novels: ParsedNovel[]): Promise<void> {
    if (!this.dotAinovrHandle) return;
    const meta = novels.map(({ id, title, totalChars, sampleText }) => ({
      id,
      title,
      totalChars,
      sampleText,
    }));
    await writeTextFile(this.dotAinovrHandle, 'meta.json', JSON.stringify(meta, null, 2));
  }

  async writeAnalysisReport(report: string | null): Promise<void> {
    if (!this.dotAinovrHandle) return;
    if (report) {
      await writeTextFile(this.dotAinovrHandle, 'analysis.md', report);
    } else {
      try {
        await this.dotAinovrHandle.removeEntry('analysis.md');
      } catch {
        // 文件可能不存在
      }
    }
  }

  async writeWriteResult(result: string | null): Promise<void> {
    if (!this.dotAinovrHandle) return;
    if (result) {
      await writeTextFile(this.dotAinovrHandle, 'write-result.md', result);
    } else {
      try {
        await this.dotAinovrHandle.removeEntry('write-result.md');
      } catch {
        // 文件可能不存在
      }
    }
  }

  async writeChatMessages(messages: ChatMessage[]): Promise<void> {
    if (!this.dotAinovrHandle) return;
    await writeTextFile(this.dotAinovrHandle, 'chat.json', JSON.stringify(messages, null, 2));
  }

  // ---- 读取操作 ----

  async loadAll(): Promise<{
    novels: ParsedNovel[];
    analysisReport: string | null;
    writeResult: string | null;
    chatMessages: ChatMessage[];
  } | null> {
    if (!this.dotAinovrHandle || !this.novelsHandle) return null;

    try {
      // 读取 meta.json
      const metaText = await readTextFile(this.dotAinovrHandle, 'meta.json');
      if (!metaText) return null;

      const metaList: { id: string; title: string; totalChars: number; sampleText: string }[] =
        JSON.parse(metaText);

      // 为每个小说读取 fullText
      const novels: ParsedNovel[] = [];
      for (const item of metaList) {
        const fullText = await readTextFile(this.novelsHandle, `${safeFilename(item.title)}.txt`);
        if (fullText !== null) {
          novels.push({
            id: item.id,
            title: item.title,
            totalChars: item.totalChars,
            fullText,
            sampleText: item.sampleText,
          });
        }
      }

      const analysisReport = await readTextFile(this.dotAinovrHandle, 'analysis.md');
      const writeResult = await readTextFile(this.dotAinovrHandle, 'write-result.md');

      const chatText = await readTextFile(this.dotAinovrHandle, 'chat.json');
      let chatMessages: ChatMessage[] = [];
      if (chatText) {
        try {
          chatMessages = JSON.parse(chatText);
        } catch {
          chatMessages = [];
        }
      }

      return { novels, analysisReport, writeResult, chatMessages };
    } catch {
      return null;
    }
  }

  /** 断开文件夹连接 */
  async disconnect(): Promise<void> {
    this.rootHandle = null;
    this.novelsHandle = null;
    this.dotAinovrHandle = null;
    await removeDirectoryHandle();
  }
}

export const syncService = new SyncService();
