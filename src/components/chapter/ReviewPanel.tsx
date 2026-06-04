// ============================================
// 审查面板 — 5维度评分展示
// ============================================

'use client';

import type { ChapterReview, ReviewDimension } from '@/types';

interface ReviewPanelProps {
  reviews: ChapterReview[];
  onRevise: () => void;
  canRevise: boolean;
  revisionCount: number;
}

const DIMENSION_LABELS: Record<ReviewDimension, string> = {
  style_consistency: '文风一致性',
  plot_coherence: '情节逻辑',
  pacing: '节奏',
  pattern_execution: '模式执行',
  foreshadow_execution: '伏笔执行',
};

export function ReviewPanel({ reviews, onRevise, canRevise, revisionCount }: ReviewPanelProps) {
  if (reviews.length === 0) return null;

  const allPassed = reviews.every((r) => r.score >= 7);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">
          自动审查
          {allPassed && <span className="ml-2 text-green-500 text-xs">全部通过 ✓</span>}
        </h3>

        {!allPassed && (
          <button
            onClick={onRevise}
            disabled={!canRevise}
            className="px-3 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            修正（{revisionCount}/3）
          </button>
        )}
      </div>

      <div className="space-y-2">
        {reviews.map((review) => {
          const isLow = review.score < 7;
          return (
            <div key={review.dimension} className="flex items-start gap-3">
              <div className={`
                w-7 h-7 rounded flex items-center justify-center text-xs font-bold
                ${isLow ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'}
              `}>
                {review.score}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">
                  {DIMENSION_LABELS[review.dimension]}
                </p>
                {review.issues.length > 0 && (
                  <p className="text-xs text-red-500 mt-0.5">{review.issues.join('; ')}</p>
                )}
                {review.suggestions.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">{review.suggestions.join('; ')}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
