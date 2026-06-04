// ============================================
// IndexedDB 辅助 — 工作缓存（非主存储）
// ============================================

const DB_NAME = 'ainovr-sync';
const DB_VERSION = 4;
const NOVEL_STORE = 'novels';
const CACHE_STORE = 'cache';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 清理旧版 handles 存储
      if (db.objectStoreNames.contains('handles')) {
        db.deleteObjectStore('handles');
      }
      // 保留 novels store（兼容旧数据）
      if (!db.objectStoreNames.contains(NOVEL_STORE)) {
        const store = db.createObjectStore(NOVEL_STORE, { keyPath: 'id' });
        store.createIndex('title', 'title');
      }
      // 新增 cache store（临时工作数据）
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- 旧版小说持久化（保留兼容） ----

/** 保存一本小说到 IndexedDB */
export async function saveNovel(novel: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOVEL_STORE, 'readwrite');
    tx.objectStore(NOVEL_STORE).put(novel);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读取所有已保存的小说 */
export async function loadAllNovels(): Promise<unknown[]> {
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

// ---- 通用缓存 ----

/** 写入缓存 */
export async function setCache(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读取缓存 */
export async function getCache<T = unknown>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** 删除缓存 */
export async function deleteCache(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
