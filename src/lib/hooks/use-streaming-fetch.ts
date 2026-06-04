// ============================================
// 统一流式请求 hook — 自动 abort + 卸载清理
// ============================================

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export function useStreamingFetch() {
  const abortRef = useRef<AbortController | null>(null);
  const [streamContent, setStreamContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // 组件卸载时自动取消进行中的请求
  useEffect(() => abort, [abort]);

  const startFetch = useCallback(async (url: string, body: object): Promise<string | null> => {
    // 取消上一次请求
    abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setStreamContent('');
    setError(null);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || `${response.status} 请求失败`);
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
        setStreamContent(fullText);
      }

      // 空响应处理：如果流结束但没有内容，可能是 API 调用失败
      if (!fullText.trim()) {
        throw new Error('模型返回了空响应，请检查 API Key 或模型配置');
      }

      return fullText;
    } catch (err: unknown) {
      // 主动 abort 不算错误
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
      const message = err instanceof Error ? err.message : '未知错误';
      setError(message);
      return null;
    } finally {
      // 只有当前 controller 仍然是活跃的才重置状态
      // 避免被 abort 的旧请求覆盖新请求的 isStreaming 状态
      if (abortRef.current === controller) {
        setIsStreaming(false);
      }
    }
  }, [abort]);

  return { streamContent, isStreaming, error, startFetch, abort, setStreamContent, abortRef };
}
