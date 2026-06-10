// ============================================
// 左侧边栏 — 简洁导航 + 处理进度指示
// ============================================

'use client';

import { useState } from 'react';
import {
  Settings,
  Library,
  PenTool,
  BookOpen,
  Loader2,
  FileCode,
} from 'lucide-react';
import { useNavigationStore } from '@/lib/store/navigation';
import { useSourceProcessingStore } from '@/lib/store/source-processing';
import type { ActiveView } from '@/types';
import { SettingsDialog } from '@/components/SettingsDialog';

export function Sidebar() {
  const activeView = useNavigationStore((s) => s.activeView);
  const setActiveView = useNavigationStore((s) => s.setActiveView);
  const processingNovelId = useSourceProcessingStore((s) => s.processingNovelId);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isProcessing = !!processingNovelId;

  const navItems: { key: ActiveView; label: string; icon: typeof Library }[] = [
    { key: 'source-library', label: '素材库', icon: Library },
    { key: 'writing-project', label: '写作项目', icon: PenTool },
    { key: 'prompt-management', label: '提示词管理', icon: FileCode },
  ];

  return (
    <>
      <aside className="w-[280px] h-screen flex flex-col bg-sidebar border-r border-sidebar-border shrink-0">
        {/* 品牌 */}
        <div className="px-5 py-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <span className="text-lg font-bold text-foreground tracking-tight">Ainovr</span>
          </div>
        </div>

        {/* 导航 */}
        <nav className="px-3 py-4 space-y-0.5">
          {navItems.map(({ key, label, icon: Icon }) => {
            // 素材库高亮：包括 source-detail 视图
            const isActive = key === 'source-library'
              ? (activeView === 'source-library' || activeView === 'source-detail')
              : activeView === key;

            return (
              <button
                key={key}
                onClick={() => setActiveView(key)}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors
                  ${isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-foreground/70 hover:bg-sidebar-accent/60 hover:text-foreground'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {label}
                {/* 处理进度指示 */}
                {key === 'source-library' && isProcessing && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary ml-auto" />
                )}
              </button>
            );
          })}
        </nav>

        {/* 设置按钮 — 底部 */}
        <div className="px-3 py-3 border-t border-sidebar-border mt-auto">
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-foreground/60 hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"
          >
            <Settings className="w-4 h-4" />
            设置
          </button>
        </div>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
