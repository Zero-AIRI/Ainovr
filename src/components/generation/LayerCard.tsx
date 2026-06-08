// ============================================
// 层级卡片 — 单层状态和操作（展开 + 编辑 + 重新规划）
// ============================================

'use client';

import { useState, useRef, useEffect } from 'react';
import { Loader2, ChevronDown, ChevronUp, Pencil, RefreshCw } from 'lucide-react';
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
  onEdit?: (newContent: string) => void;
  onRegenWithPrompt?: (customPrompt: string) => void;
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
  onEdit,
  onRegenWithPrompt,
}: LayerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [showRegenInput, setShowRegenInput] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && editRef.current) editRef.current.focus();
  }, [isEditing]);

  const startEdit = () => {
    setEditText(content ?? '');
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (editText.trim() !== content) {
      onEdit?.(editText.trim());
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditText('');
  };

  const submitRegen = () => {
    if (regenPrompt.trim()) {
      onRegenWithPrompt?.(regenPrompt.trim());
      setRegenPrompt('');
      setShowRegenInput(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">
            L{layerNumber}
          </span>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {status === 'done' && <span className="text-xs text-green-500">✓</span>}
          {status === 'generating' && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
        </div>

        <div className="flex items-center gap-1">
          {/* 编辑按钮（已完成时显示） */}
          {status === 'done' && onEdit && !isEditing && (
            <button
              onClick={startEdit}
              className="p-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              title="手动编辑"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}

          {/* 重新规划按钮（已完成或当前层时显示） */}
          {(status === 'done' || canGenerate) && onRegenWithPrompt && (
            <button
              onClick={() => setShowRegenInput((v) => !v)}
              className="p-1 rounded text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title="自定义提示词重新规划"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}

          {/* 展开/收起 */}
          {content && !streamContent && !isEditing && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? '收起' : '展开'}
            </button>
          )}

          {/* 生成按钮 */}
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
            {status === 'generating' ? '生成中...' : status === 'done' ? '重新生成' : '生成'}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-2">{description}</p>

      {/* 自定义提示词输入框 */}
      {showRegenInput && (
        <div className="mb-2 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
          <label className="text-xs font-medium text-foreground">自定义提示词重新规划</label>
          <textarea
            value={regenPrompt}
            onChange={(e) => setRegenPrompt(e.target.value)}
            placeholder="输入你的额外要求或修改方向..."
            className="w-full h-20 px-3 py-2 rounded-md border border-border bg-background text-xs resize-none"
            onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) submitRegen(); }}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowRegenInput(false)} className="px-2 py-1 rounded text-xs text-muted-foreground hover:bg-accent">取消</button>
            <button
              onClick={submitRegen}
              disabled={!regenPrompt.trim()}
              className="px-3 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              开始重新规划
            </button>
          </div>
        </div>
      )}

      {/* 编辑模式 */}
      {isEditing && (
        <div className="mt-2 space-y-2">
          <textarea
            ref={editRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full h-64 px-3 py-2 rounded-md border border-border bg-background text-xs font-mono resize-y"
          />
          <div className="flex justify-end gap-2">
            <button onClick={cancelEdit} className="px-3 py-1.5 rounded text-xs border border-border text-muted-foreground hover:bg-accent">取消</button>
            <button onClick={saveEdit} className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90">保存</button>
          </div>
        </div>
      )}

      {/* 流式输出 */}
      {(streamContent || isStreaming) && !isEditing && (
        <div className="mt-2 p-3 rounded bg-muted/50 max-h-64 overflow-y-auto">
          <StreamingText content={streamContent} isStreaming={isStreaming} />
        </div>
      )}

      {/* 已完成的内容（非编辑、非流式时显示） */}
      {content && !streamContent && !isEditing && (
        <div className="mt-2 p-3 rounded bg-muted/50">
          <pre className={`text-xs text-muted-foreground whitespace-pre-wrap ${expanded ? '' : 'line-clamp-6'}`}>{content}</pre>
        </div>
      )}
    </div>
  );
}
