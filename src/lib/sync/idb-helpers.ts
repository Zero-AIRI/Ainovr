// ============================================
// IndexedDB 辅助 — 目录句柄 + 小说持久化
// ============================================

import type { ParsedNovel } from '@/types';

const DB_NAME = 'ainovr-sync';
const DB_VERSION = 2;
const HANDLE_STORE = 'handles';
const NOVEL_STORE = 'novels';
const HANDLE_KEY = 'root';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
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

/** 将目录句柄持久化到 IndexedDB */
export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 从 IndexedDB 读取目录句柄（可能为 null） */
export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly');
    const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** 删除存储的目录句柄 */
export async function removeDirectoryHandle(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
