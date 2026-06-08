// ============================================
// 源小说卡片 — 简洁状态显示 + 改名
// ============================================

'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, CheckCircle, Loader2, AlertCircle, Pencil, Trash2 } from 'lucide-react';
import type { SourceNovel, SourceNovelStatus } from '@/types';

interface SourceNovelCardProps {
  novel: SourceNovel;
  onClick: () => void;
  onRename?: (id: string, newTitle: string) => void;
  onDelete?: (id: string) => void;
}

const STATUS_CONFIG: Record<SourceNovelStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
  raw: { label: '待处理', color: 'text-muted-foreground', icon: FileText },
  indexing: { label: '索引中', color: 'text-blue-500', icon: Loader2 },
  segmenting: { label: '分段中', color: 'text-blue-500', icon: Loader2 },
  slicing: { label: '切片中', color: 'text-blue-500', icon: Loader2 },
  extracting: { label: '分析中', color: 'text-blue-500', icon: Loader2 },
  character_dynamics: { label: '角色分析', color: 'text-blue-500', icon: Loader2 },
  deep_analyzing: { label: '深度分析', color: 'text-blue-500', icon: Loader2 },
  selecting: { label: '选取中', color: 'text-blue-500', icon: Loader2 },
  evolution_modeling: { label: '演化建模', color: 'text-blue-500', icon: Loader2 },
  compressing: { label: '压缩中', color: 'text-blue-500', icon: Loader2 },
  ready: { label: '已处理', color: 'text-green-500', icon: CheckCircle },
  error: { label: '出错', color: 'text-red-500', icon: AlertCircle },
};

function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千`;
  return `${n}`;
}

export function SourceNovelCard({ novel, onClick, onRename, onDelete }: SourceNovelCardProps) {
  const config = STATUS_CONFIG[novel.status];
  const Icon = config.icon;
  const processingStatuses: SourceNovelStatus[] = ['indexing', 'segmenting', 'slicing', 'extracting', 'character_dynamics', 'deep_analyzing', 'selecting', 'evolution_modeling', 'compressing'];
  const isProcessing = processingStatuses.includes(novel.status);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(novel.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const handleRenameSubmit = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== novel.title && onRename) {
      onRename(novel.id, trimmed);
    } else {
      setEditTitle(novel.title);
    }
    setIsEditing(false);
  };

  return (
    <div
      className="group p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
          onClick={onClick}
        >
          <FileText className="w-4 h-4 text-primary shrink-0" />
          {isEditing ? (
            <input
              ref={inputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') { setEditTitle(novel.title); setIsEditing(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-foreground bg-transparent border-b border-primary outline-none flex-1 min-w-0"
            />
          ) : (
            <span className="text-sm font-medium text-foreground truncate">
              《{novel.title}》
            </span>
          )}
        </div>

        {/* 操作按钮 — hover 时显示 */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditTitle(novel.title); }}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="重命名"
          >
            <Pencil className="w-3 h-3" />
          </button>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(novel.id); }}
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="删除"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2 cursor-pointer" onClick={onClick}>
        <span className="text-xs text-muted-foreground">{formatChars(novel.totalChars)}字</span>
        <div className={`flex items-center gap-1 text-xs ${config.color}`}>
          <Icon className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
          {config.label}
        </div>
      </div>

      {/* 处理完成：显示分析维度状态 */}
      {novel.status === 'ready' && (
        <div className="flex gap-2 mt-2 text-xs text-muted-foreground cursor-pointer flex-wrap" onClick={onClick}>
          <span className="text-green-600 dark:text-green-400">文风✓</span>
          <span className="text-green-600 dark:text-green-400">叙事✓</span>
          <span className="text-green-600 dark:text-green-400">角色✓</span>
          <span className="text-green-600 dark:text-green-400">体验✓</span>
          {novel.novelDna && <span className="text-primary font-medium">DNA✓</span>}
        </div>
      )}

      {/* 出错状态 */}
      {novel.status === 'error' && (
        <div className="mt-2 text-xs text-red-500 cursor-pointer" onClick={onClick}>
          处理失败，可重新处理
        </div>
      )}
    </div>
  );
}
