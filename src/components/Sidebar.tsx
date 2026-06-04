// ============================================
// 左侧边栏 — Notion/Typora 风格
// ============================================

'use client';

import { useState } from 'react';
import {
  Settings,
  Library,
  PenTool,
  Layers,
  BookOpen,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store/project';
import type { ActiveView } from '@/types';
import { SettingsDialog } from '@/components/SettingsDialog';

export function Sidebar() {
  const activeView = useProjectStore((s) => s.activeView);
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const navItems: { key: ActiveView; label: string; icon: typeof Library }[] = [
    { key: 'source-library', label: '素材库', icon: Library },
    { key: 'writing-project', label: '写作项目', icon: PenTool },
    { key: 'layer-generation', label: '层级规划', icon: Layers },
    { key: 'chapter-generation', label: '章节生成', icon: BookOpen },
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
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors
                ${activeView === key
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-foreground/70 hover:bg-sidebar-accent/60 hover:text-foreground'
                }
              `}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
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
