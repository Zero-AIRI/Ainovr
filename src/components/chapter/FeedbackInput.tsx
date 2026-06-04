// ============================================
// 人工反馈输入
// ============================================

'use client';

import { useState } from 'react';

interface FeedbackInputProps {
  onSubmit: (feedback: string) => void;
  disabled?: boolean;
}

export function FeedbackInput({ onSubmit, disabled }: FeedbackInputProps) {
  const [feedback, setFeedback] = useState('');

  const handleSubmit = () => {
    if (!feedback.trim()) return;
    onSubmit(feedback.trim());
    setFeedback('');
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium text-foreground mb-2">人工反馈</h3>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="对当前章节的修改意见..."
        className="w-full h-20 px-3 py-2 rounded-md border border-border bg-background text-sm resize-none mb-2"
      />
      <button
        onClick={handleSubmit}
        disabled={!feedback.trim() || disabled}
        className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        提交反馈并修正
      </button>
    </div>
  );
}
