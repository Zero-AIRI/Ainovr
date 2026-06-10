// ============================================
// 共享流式 fetch 工具 — 统一所有管线的 HTTP 流式请求
// dao-pipeline、source-processing store、layer-pipeline 均使用此模块
// ============================================

/** AI 配置（统一类型，替代各文件中重复定义的同名接口） */
export interface AIConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  maxContextTokens: number;
}

// ---- 流式状态 ----

export interface StreamState {
  content: string;
  isStreaming: boolean;
  error: string | null;
}

// ---- 流式 fetch 工具 ----

export function createStreamFetcher() {
  let abortController: AbortController | null = null;

  return {
    abort() {
      abortController?.abort();
      abortController = null;
    },

    async fetch(url: string, body: object): Promise<{ result: string | null; state: StreamState }> {
      const controller = new AbortController();
      abortController = controller;
      const state: StreamState = { content: '', isStreaming: true, error: null };

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
        const chunks: string[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value, { stream: true }));
          state.content = chunks.join('');
        }

        const fullText = chunks.join('');
        if (!fullText.trim()) throw new Error('模型返回了空响应');
        state.isStreaming = false;
        return { result: fullText, state };
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          state.isStreaming = false;
          return { result: null, state };
        }
        state.error = err instanceof Error ? err.message : '未知错误';
        state.isStreaming = false;
        return { result: null, state };
      } finally {
        if (abortController === controller) abortController = null;
      }
    },
  };
}
