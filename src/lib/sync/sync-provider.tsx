// ============================================
// 文件同步 Provider — 初始化 + 订阅变更 + 自动写入
// ============================================

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { syncService } from '@/lib/sync/sync-service';

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNovelIds = useRef<Set<string>>(new Set());

  const setSyncStatus = useAppStore((s) => s.setSyncStatus);
  const setSyncError = useAppStore((s) => s.setSyncError);
  const setFolderName = useAppStore((s) => s.setFolderName);

  // 用户手动选择文件夹
  const pickFolder = useCallback(async () => {
    const ok = await syncService.pickFolder();
    if (ok) {
      setFolderName(syncService.getFolderName());
      setSyncStatus('idle');
      setSyncError(null);
    }
  }, [setFolderName, setSyncStatus, setSyncError]);

  // 初始化 + 订阅
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 检查浏览器支持
    if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
      setSyncStatus('no-folder');
      return;
    }

    // 将 pickFolder 暴露到 window 上，供 SyncControls 调用
    (window as unknown as Record<string, unknown>).__ainovr_pickFolder = pickFolder;

    setSyncStatus('loading');

    (async () => {
      try {
        const ok = await syncService.init();
        if (!ok) {
          setSyncStatus('no-folder');
          return;
        }

        setFolderName(syncService.getFolderName());

        const data = await syncService.loadAll();
        if (data) {
          // 一次性注入 store，避免逐字段触发订阅
          useAppStore.setState({
            novels: data.novels,
            analysisReport: data.analysisReport,
            writeResult: data.writeResult,
            chatMessages: data.chatMessages,
          });

          // 记录初始 novel IDs
          prevNovelIds.current = new Set(data.novels.map((n) => n.id));
        }

        setSyncStatus('idle');
      } catch (err) {
        console.error('同步初始化失败:', err);
        setSyncStatus('no-folder');
      }
    })();
  }, [setSyncStatus, setFolderName, setSyncError, pickFolder]);

  // 订阅 store 变更，防抖写入文件
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prevState) => {
      if (state.syncStatus === 'no-folder' || state.syncStatus === 'loading') return;
      if (!syncService.isInitialized()) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          // 小说变更
          if (state.novels !== prevState.novels) {
            const currentIds = new Set(state.novels.map((n) => n.id));

            // 新增的小说
            for (const novel of state.novels) {
              if (!prevNovelIds.current.has(novel.id)) {
                await syncService.writeNovel(novel);
              }
            }

            // 删除的小说
            for (const prev of prevState.novels) {
              if (!currentIds.has(prev.id)) {
                await syncService.removeNovel(prev.title);
              }
            }

            await syncService.writeMeta(state.novels);
            prevNovelIds.current = currentIds;
          }

          // 分析报告变更
          if (state.analysisReport !== prevState.analysisReport) {
            await syncService.writeAnalysisReport(state.analysisReport);
          }

          // 仿写结果变更
          if (state.writeResult !== prevState.writeResult) {
            await syncService.writeWriteResult(state.writeResult);
          }

          // 聊天记录变更
          if (state.chatMessages !== prevState.chatMessages) {
            await syncService.writeChatMessages(state.chatMessages);
          }
        } catch (err) {
          console.error('同步写入失败:', err);
          setSyncError(err instanceof Error ? err.message : '同步失败');
          setSyncStatus('error');
        }
      }, 500);
    });

    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [setSyncStatus, setSyncError]);

  return <>{children}</>;
}
