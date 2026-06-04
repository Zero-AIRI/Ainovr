// ============================================
// 源小说卡片
// ============================================

'use client';

import { FileText, CheckCircle, Loader2, AlertCircle, Plus } from 'lucide-react';
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
  ready: { label: '已就绪', color: 'text-green-500', icon: CheckCircle },
  error: { label: '出错', color: 'text-red-500', icon: AlertCircle },
};

function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千`;
  return `${n}`;
}

export function SourceNovelCard({ novel, onClick, onAddToProject }: SourceNovelCardProps) {
  const config = STATUS_CONFIG[novel.status];
  const Icon = config.icon;

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
        {novel.status === 'ready' && onAddToProject && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddToProject(); }}
            className="shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
            title="添加到写作项目"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 mt-2">
        <span className="text-xs text-muted-foreground">{formatChars(novel.totalChars)}字</span>

        <div className={`flex items-center gap-1 text-xs ${config.color}`}>
          <Icon className={`w-3 h-3 ${novel.status === 'slicing' || novel.status === 'extracting' || novel.status === 'selecting' ? 'animate-spin' : ''}`} />
          {config.label}
        </div>
      </div>

      {/* 产出摘要 */}
      {novel.status === 'ready' && (
        <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
          {novel.slices && <span>{novel.slices.length}切片</span>}
          {novel.styleProfile && <span>文风✓</span>}
          {novel.plotReport && <span>情节✓</span>}
          {novel.representativeSamples && <span>{novel.representativeSamples.length}样本</span>}
        </div>
      )}
    </div>
  );
}
