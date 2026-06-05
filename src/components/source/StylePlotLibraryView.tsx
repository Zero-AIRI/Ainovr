// ============================================
// 文风/情节库 — 双列卡片网格，展示所有小说的提取结果
// ============================================

'use client';

import { FileText, CheckCircle, XCircle, Eye } from 'lucide-react';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useProjectStore } from '@/lib/store/project';
import type { SourceNovel } from '@/types';

function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千`;
  return `${n}`;
}

interface ResultCardProps {
  novel: SourceNovel;
  type: 'style' | 'plot';
  onViewDetail: (novelId: string) => void;
}

function ResultCard({ novel, type, onViewDetail }: ResultCardProps) {
  const hasContent = type === 'style' ? !!novel.styleProfile : !!novel.plotReport;
  const label = type === 'style' ? '文风档案' : '情节报告';

  return (
    <div
      className="p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">
          《{novel.title}》
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
        <span>{formatChars(novel.totalChars)}字</span>
        <div className="flex items-center gap-1">
          {hasContent ? (
            <>
              <CheckCircle className="w-3 h-3 text-green-500" />
              <span className="text-green-600 dark:text-green-400">{label}已提取</span>
            </>
          ) : (
            <>
              <XCircle className="w-3 h-3 text-muted-foreground" />
              <span>未提取</span>
            </>
          )}
        </div>
      </div>

      {hasContent && (
        <button
          onClick={() => onViewDetail(novel.id)}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          查看详情
        </button>
      )}
    </div>
  );
}

export function StylePlotLibraryView() {
  const { sourceNovels } = useSourceLibraryStore();
  const { setActiveSourceId, setActiveView } = {
    setActiveSourceId: useSourceLibraryStore((s) => s.setActiveSourceId),
    setActiveView: useProjectStore((s) => s.setActiveView),
  };

  // 只显示已处理或有部分结果的小说
  const processedNovels = sourceNovels.filter(
    (n) => n.status === 'ready' || n.status === 'extracting' || !!n.styleProfile || !!n.plotReport
  );

  const handleViewDetail = (novelId: string) => {
    setActiveSourceId(novelId);
    setActiveView('source-detail');
  };

  if (processedNovels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <FileText className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">还没有提取结果</p>
        <p className="text-xs mt-1 opacity-60">先在「小说管理」中处理小说，文风和情节会出现在这里</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid grid-cols-2 gap-4">
        {/* 文风档案列 */}
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-blue-500" />
            文风档案
          </h3>
          <div className="space-y-3">
            {processedNovels.map((novel) => (
              <ResultCard
                key={`style-${novel.id}`}
                novel={novel}
                type="style"
                onViewDetail={handleViewDetail}
              />
            ))}
          </div>
        </div>

        {/* 情节报告列 */}
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-purple-500" />
            情节报告
          </h3>
          <div className="space-y-3">
            {processedNovels.map((novel) => (
              <ResultCard
                key={`plot-${novel.id}`}
                novel={novel}
                type="plot"
                onViewDetail={handleViewDetail}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
