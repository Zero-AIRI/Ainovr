// ============================================
// 层级卡片 — 单层状态和操作
// ============================================

'use client';

import { Lock, Loader2 } from 'lucide-react';
import { StreamingText } from '@/components/StreamingText';

interface LayerCardProps {
  layerNumber: number;
  title: string;
  description: string;
  status: 'pending' | 'generating' | 'framework_done' | 'done';
  content: string | null;
  streamContent: string;
  isStreaming: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}

export function LayerCard({
  layerNumber,
  title,
  description,
  status,
  content,
  streamContent,
  isStreaming,
  canGenerate,
  onGenerate,
}: LayerCardProps) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">
            L{layerNumber}
          </span>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {status === 'done' && <span className="text-xs text-green-500">✓</span>}
          {status === 'generating' && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
        </div>

        <button
          onClick={onGenerate}
          disabled={!canGenerate || isStreaming}
          className={`
            px-3 py-1 rounded text-xs transition-colors
            ${status === 'done'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : canGenerate
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            }
          `}
        >
          {status === 'generating' ? '生成中...' : status === 'done' ? '已完成' : '生成'}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-2">{description}</p>

      {/* 流式输出 */}
      {(streamContent || isStreaming) && (
        <div className="mt-2 p-3 rounded bg-muted/50">
          <StreamingText content={streamContent} isStreaming={isStreaming} />
        </div>
      )}

      {/* 已完成的内容 */}
      {content && !streamContent && (
        <div className="mt-2 p-3 rounded bg-muted/50">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">{content}</pre>
        </div>
      )}
    </div>
  );
}
