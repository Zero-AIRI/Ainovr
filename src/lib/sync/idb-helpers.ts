// ============================================
// IndexedDB 辅助 — 小说持久化
// ============================================

import type { ParsedNovel } from '@/types';

const DB_NAME = 'ainovr-sync';
const DB_VERSION = 3;
const NOVEL_STORE = 'novels';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 清理旧版 handles 存储
      if (db.objectStoreNames.contains('handles')) {
        db.deleteObjectStore('handles');
      }
      if (!db.objectStoreNames.contains(NOVEL_STORE)) {
        const store = db.createObjectStore(NOVEL_STORE, { keyPath: 'id' });
        store.createIndex('title', 'title');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- 小说持久化 ----

/** 保存一本小说到 IndexedDB */
export async function saveNovel(novel: ParsedNovel): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOVEL_STORE, 'readwrite');
    tx.objectStore(NOVEL_STORE).put(novel);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读取所有已保存的小说 */
export async function loadAllNovels(): Promise<ParsedNovel[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOVEL_STORE, 'readonly');
    const req = tx.objectStore(NOVEL_STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

/** 删除一本小说 */
export async function removeNovel(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOVEL_STORE, 'readwrite');
    tx.objectStore(NOVEL_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 清空所有小说 */
export async function clearAllNovels(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOVEL_STORE, 'readwrite');
    tx.objectStore(NOVEL_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
