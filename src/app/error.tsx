// ============================================
// 全局错误边界 — 防止白屏
// ============================================

'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Ainovr 渲染错误:', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-screen p-8">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-xl font-bold text-foreground">出了点问题</h2>
        <p className="text-sm text-muted-foreground">
          {error.message || '发生了未知错误'}
        </p>
        <Button onClick={reset}>
          重试
        </Button>
      </div>
    </div>
  );
}
