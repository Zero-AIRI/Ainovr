// ============================================
// 流式文本渲染组件
// ============================================

'use client';

import { useRef, useEffect } from 'react';

interface StreamingTextProps {
  content: string;
  isStreaming: boolean;
  className?: string;
}

export function StreamingText({ content, isStreaming, className = '' }: StreamingTextProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  if (!content) {
    return null;
  }

  return (
    <div
      ref={scrollRef}
      className={`prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed text-gray-200 ${className}`}
    >
      {content}
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-0.5 bg-gray-400 animate-pulse" />
      )}
    </div>
  );
}
