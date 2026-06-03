// ============================================
// 同步控制 — 文件夹选择 + 状态指示
// ============================================

'use client';

import { FolderOpen, FolderSync } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export function SyncControls() {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const syncError = useAppStore((s) => s.syncError);
  const folderName = useAppStore((s) => s.folderName);
  const setSyncStatus = useAppStore((s) => s.setSyncStatus);
  const setSyncError = useAppStore((s) => s.setSyncError);
  const setFolderName = useAppStore((s) => s.setFolderName);

  // 不支持 File System Access API 的浏览器不显示
  if (typeof window !== 'undefined' && !('showDirectoryPicker' in window)) {
    return null;
  }

  const handlePickFolder = async () => {
    setSyncStatus('loading');
    setSyncError(null);

    const pickFolder = (window as unknown as Record<string, () => Promise<void>>).__ainovr_pickFolder;
    if (pickFolder) {
      await pickFolder();
    }
  };

  const handleReconnect = handlePickFolder;

  // 未连接 / 权限丢失
  if (syncStatus === 'no-folder') {
    return (
      <div className="px-4 pb-2">
        <button
          onClick={handlePickFolder}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          连接文件夹以保存数据
        </button>
      </div>
    );
  }

  // 加载中
  if (syncStatus === 'loading') {
    return (
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          正在加载...
        </div>
      </div>
    );
  }

  // 错误
  if (syncStatus === 'error') {
    return (
      <div className="px-4 pb-2">
        <button
          onClick={handleReconnect}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs text-destructive hover:bg-sidebar-accent/60 transition-colors"
          title={syncError || ''}
        >
          <span className="w-2 h-2 rounded-full bg-destructive" />
          同步出错 — 点击重试
        </button>
      </div>
    );
  }

  // 已连接
  return (
    <div className="px-4 pb-2">
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className={`w-2 h-2 rounded-full ${syncStatus === 'syncing' ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
        <FolderSync className="w-3.5 h-3.5" />
        <span className="truncate">{folderName}</span>
      </div>
    </div>
  );
}
