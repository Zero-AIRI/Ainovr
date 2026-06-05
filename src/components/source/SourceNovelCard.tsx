// ============================================
// 源小说卡片 — 简洁状态显示
// ============================================

'use client';

import { FileText, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import type { SourceNovel, SourceNovelStatus } from '@/types';

interface SourceNovelCardProps {
  novel: SourceNovel;
  onClick: () => void;
  onAddToProject?: () => void;
}

const STATUS_CONFIG: Record<SourceNovelStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
  raw: { label: '待处理', color: 'text-muted-foreground', icon: FileText },
  slicing: { label: '切片中', color: 'text-blue-500', icon: Loader2 },
  extracting: { label: '提取中', color: 'text-blue-500', icon: Loader2 },
  selecting: { label: '选取中', color: 'text-blue-500', icon: Loader2 },
  ready: { label: '已处理', color: 'text-green-500', icon: CheckCircle },
  error: { label: '出错', color: 'text-red-500', icon: AlertCircle },
};

function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千`;
  return `${n}`;
}

export function SourceNovelCard({ novel, onClick }: SourceNovelCardProps) {
  const config = STATUS_CONFIG[novel.status];
  const Icon = config.icon;
  const isProcessing = novel.status === 'slicing' || novel.status === 'extracting' || novel.status === 'selecting';

  return (
    <div
      onClick={onClick}
      className="group p-4 rounded-lg border border-border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">
            《{novel.title}》
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2">
        <span className="text-xs text-muted-foreground">{formatChars(novel.totalChars)}字</span>
        <div className={`flex items-center gap-1 text-xs ${config.color}`}>
          <Icon className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
          {config.label}
        </div>
      </div>

      {/* 处理完成：显示文风/情节状态 */}
      {novel.status === 'ready' && (
        <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
          <span className="text-green-600 dark:text-green-400">文风✓</span>
          <span className="text-green-600 dark:text-green-400">情节✓</span>
        </div>
      )}

      {/* 出错状态 */}
      {novel.status === 'error' && (
        <div className="mt-2 text-xs text-red-500">
          处理失败，可重新处理
        </div>
      )}
    </div>
  );
}
