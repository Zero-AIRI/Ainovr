// ============================================
// 左侧边栏 — Notion/Typora 风格
// ============================================

'use client';

import { useState, useCallback } from 'react';
import {
  Settings,
  Sparkles,
  PenTool,
  Upload,
  FileText,
  BookOpen,
  MessageCircle,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { parseTxtFile, formatCharCount } from '@/lib/file-parser';
import { useAppStore } from '@/lib/store';
import { saveNovelToServer } from '@/lib/utils';
import type { ActiveView } from '@/types';
import { SettingsDialog } from '@/components/SettingsDialog';
import { ImportSettingsDialog } from '@/components/ImportSettingsDialog';
import { Checkbox } from '@/components/ui/checkbox';

/** 文件大小限制：20 MB */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function Sidebar() {
  const novels = useAppStore((s) => s.novels);
  const addNovel = useAppStore((s) => s.addNovel);
  const removeNovel = useAppStore((s) => s.removeNovel);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const analysisReport = useAppStore((s) => s.analysisReport);
  const selectedBookIds = useAppStore((s) => s.selectedBookIds);
  const toggleSelectedBook = useAppStore((s) => s.toggleSelectedBook);

  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importSettingsOpen, setImportSettingsOpen] = useState(false);
  const [reprocessTarget, setReprocessTarget] = useState<string | undefined>(undefined);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsLoading(true);
      try {
        const fileArr = Array.from(files);
        const importConfig = useAppStore.getState().importConfig;
        for (const file of fileArr) {
          if (file.size > MAX_FILE_SIZE) {
            alert(`"${file.name}" 超过 20MB 限制，已跳过`);
            continue;
          }
          if (!file.name.endsWith('.txt')) {
            toast.error(`"${file.name}" 不是 TXT 文件，已跳过`);
            continue;
          }
          // 使用 getState() 获取最新状态，避免闭包过期导致批次内重复
          const currentNovels = useAppStore.getState().novels;
          if (currentNovels.some((n) => n.title === file.name.replace(/\.txt$/i, ''))) {
            toast.error(`"${file.name}" 已存在，跳过`);
            continue;
          }
          const novel = await parseTxtFile(file, importConfig);
          addNovel(novel);

          // 同时保存到本地 data/novels/
          await saveNovelToServer({
            id: novel.id,
            title: novel.title,
            fullText: novel.fullText,
            chunks: novel.chunks,
          });
        }
      } catch (err) {
        toast.error(`文件解析失败: ${err instanceof Error ? err.message : '未知错误'}`);
      } finally {
        setIsLoading(false);
      }
    },
    [addNovel],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleRemoveNovel = useCallback(
    async (id: string) => {
      removeNovel(id);
      try {
        const res = await fetch('/api/novels/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          console.error('Failed to delete novel from server:', res.status);
        }
      } catch (err) {
        console.error('Failed to delete novel from server:', err);
      }
    },
    [removeNovel],
  );

  const navItems: { key: ActiveView; label: string; icon: typeof Sparkles }[] = [
    { key: 'chat', label: '小说问答', icon: MessageCircle },
    { key: 'analyze', label: '风格分析', icon: Sparkles },
    { key: 'write', label: '风格仿写', icon: PenTool },
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

        {/* 导入区 */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              导入小说
            </p>
            <button
              onClick={() => {
                setReprocessTarget(undefined);
                setImportSettingsOpen(true);
              }}
              className="text-muted-foreground/50 hover:text-foreground transition-colors"
              title="导入设置"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 拖拽上传 */}
          <label
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            className={`
              flex flex-col items-center justify-center gap-2
              w-full h-20 rounded-lg border-2 border-dashed cursor-pointer
              transition-all duration-200
              ${isDragging
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50 bg-background/50'
              }
              ${isLoading ? 'pointer-events-none opacity-50' : ''}
            `}
          >
            <input
              type="file"
              accept=".txt"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <Upload className={`w-4 h-4 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="text-xs text-muted-foreground">
              {isLoading ? '解析中...' : '拖拽或点击上传 .txt'}
            </span>
          </label>
        </div>

        {/* 文件列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1 scrollbar-none">
          {novels.map((novel) => (
            <label
              key={novel.id}
              className="flex items-center gap-2 px-3 py-2 rounded-md group hover:bg-sidebar-accent transition-colors cursor-pointer"
            >
              <Checkbox
                checked={selectedBookIds.includes(novel.id)}
                onCheckedChange={() => toggleSelectedBook(novel.id)}
                className="shrink-0"
              />
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate leading-tight">
                  《{novel.title}》
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatCharCount(novel.totalChars)}
                  {novel.chunks?.length ? ` · ${novel.chunks.length}块` : ''}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setReprocessTarget(novel.id);
                  setImportSettingsOpen(true);
                }}
                className="text-muted-foreground/50 hover:text-primary transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                title="重新处理"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleRemoveNovel(novel.id);
                }}
                className="text-muted-foreground/50 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                title="移除"
              >
                ✕
              </button>
            </label>
          ))}

          {novels.length === 0 && (
            <p className="text-xs text-muted-foreground/60 text-center py-4">
              尚未导入小说
            </p>
          )}
        </div>

        {/* 分割线 */}
        <div className="border-t border-sidebar-border" />

        {/* 导航 */}
        <nav className="px-3 py-2 space-y-0.5">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              disabled={key === 'write' && !analysisReport}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors
                ${activeView === key
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-foreground/70 hover:bg-sidebar-accent/60 hover:text-foreground'
                }
                ${key === 'write' && !analysisReport ? 'opacity-40 cursor-not-allowed' : ''}
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
      <ImportSettingsDialog
        open={importSettingsOpen}
        onOpenChange={(open) => {
          setImportSettingsOpen(open);
          if (!open) setReprocessTarget(undefined);
        }}
        novelId={reprocessTarget}
      />
    </>
  );
}
