// ============================================
// 流式请求 Hook — AbortController + 统一模式
// ============================================

import { useRef, useCallback } from 'react';

interface StreamingFetchOptions {
  url: string;
  body: Record<string, unknown>;
  onChunk: (fullText: string) => void;
  onError: (message: string) => void;
}

/**
 * 提供一个 AbortController 管理的流式 fetch。
 * 返回 abort() 方法，可被 useEffect cleanup 调用。
 */
export function useStreamingFetch() {
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startStream = useCallback(async ({ url, body, onChunk, onError }: StreamingFetchOptions) => {
    // 取消上一次未完成的请求
    abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || '请求失败');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        onChunk(fullText);
      }

      return fullText;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return undefined;
      const msg = err instanceof Error ? err.message : '未知错误';
      onError(msg);
      return undefined;
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [abort]);

  return { startStream, abort };
}
