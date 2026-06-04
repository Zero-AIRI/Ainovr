// ============================================
// 分析视图 — 流式展示风格分析报告（支持分批分析）
// ============================================

'use client';

import { useRef, useEffect, useCallback, useReducer } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StreamingText } from '@/components/StreamingText';
import { useAppStore } from '@/lib/store';
import { computeMaxCharsPerBatch, splitIntoBatches } from '@/lib/analysis-chunker';

export function AnalyzeView() {
  const novels = useAppStore((s) => s.novels);
  const analysisReport = useAppStore((s) => s.analysisReport);
  const isAnalyzing = useAppStore((s) => s.isAnalyzing);
  const maxContextTokens = useAppStore((s) => s.maxContextTokens);
  const setAnalysisReport = useAppStore((s) => s.setAnalysisReport);
  const setIsAnalyzing = useAppStore((s) => s.setIsAnalyzing);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const getEffectiveApiKey = useAppStore((s) => s.getEffectiveApiKey);
  const model = useAppStore((s) => s.model);
  const baseURL = useAppStore((s) => s.baseURL);

  // 用 ref 管理流式显示内容（避免闭包问题），用 reducer 触发重渲染
  const displayRef = useRef('');
  const progressRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initializedRef = useRef(false);
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);

  // 组件挂载时恢复已有报告
  useEffect(() => {
    if (!initializedRef.current && analysisReport) {
      displayRef.current = analysisReport;
      forceUpdate();
    }
    initializedRef.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 单次流式请求，返回完整文本 */
  const streamOnce = useCallback(async (
    url: string,
    body: object,
    controller: AbortController,
    onChunk: (text: string) => void,
  ): Promise<string | null> => {
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
        onChunk(fullText);
      }

      if (!fullText.trim()) {
        throw new Error('模型返回了空响应，请检查 API Key 或模型配置');
      }

      return fullText;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }, []);

  const startAnalysis = useCallback(async () => {
    const apiKey = getEffectiveApiKey();
    if (!novels.length || !apiKey) return;

    // 取消上一次请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAnalysisReport(null);
    setIsAnalyzing(true);
    displayRef.current = '';
    progressRef.current = null;
    forceUpdate();

    const fullText = novels.map((n) => n.fullText).join('\n\n--- 另一部作品 ---\n\n');
    const maxChars = computeMaxCharsPerBatch(maxContextTokens);

    try {
      if (fullText.length <= maxChars) {
        // 单次分析
        progressRef.current = '分析中...';
        forceUpdate();

        const result = await streamOnce(
          '/api/analyze',
          {
            novelTexts: novels.map((n) => n.fullText),
            apiKey,
            model,
            baseURL,
          },
          controller,
          (text) => {
            displayRef.current = text;
            forceUpdate();
          },
        );

        if (result) setAnalysisReport(result);
      } else {
        // 分批分析
        const batches = splitIntoBatches(fullText, maxChars);
        let accumulatedReport = '';

        for (let i = 0; i < batches.length; i++) {
          if (controller.signal.aborted) break;

          progressRef.current = `分析中... 第 ${i + 1}/${batches.length} 批`;
          displayRef.current = accumulatedReport;
          forceUpdate();

          const isFirst = i === 0;
          const body: Record<string, unknown> = {
            novelTexts: [batches[i]],
            apiKey,
            model,
            baseURL,
          };

          if (!isFirst) {
            body.previousReport = accumulatedReport;
          }

          const result = await streamOnce(
            '/api/analyze',
            body,
            controller,
            (text) => {
              displayRef.current = text;
              forceUpdate();
            },
          );

          if (result) {
            accumulatedReport = result;
          } else {
            // 被中断或出错
            break;
          }
        }

        if (accumulatedReport) {
          setAnalysisReport(accumulatedReport);
          displayRef.current = accumulatedReport;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知错误';
      toast.error(`分析失败: ${message}`);
    } finally {
      progressRef.current = null;
      setIsAnalyzing(false);
      forceUpdate();
    }
  }, [novels, maxContextTokens, getEffectiveApiKey, model, baseURL, setAnalysisReport, setIsAnalyzing, streamOnce]);

  const stopAnalysis = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const hasReport = (displayRef.current || analysisReport || '').trim().length > 0;
  const noApiKey = !getEffectiveApiKey().trim();
  const noNovels = novels.length === 0;

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 标题 */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">风格分析报告</h1>
          {novels.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              分析作品：{novels.map((n) => `《${n.title}》`).join('、')}
            </p>
          )}
        </div>

        {/* 提示：缺少条件 */}
        {(noNovels || noApiKey) && (
          <div className="rounded-xl border border-border bg-card p-6 text-center space-y-2">
            <Sparkles className="w-10 h-10 text-primary/40 mx-auto" />
            <p className="text-muted-foreground">
              {noNovels ? '请在左侧导入小说文件' : '请在设置中配置 API Key'}
            </p>
          </div>
        )}

        {/* 进度指示 */}
        {progressRef.current && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            {progressRef.current}
          </div>
        )}

        {/* 报告内容 */}
        {(displayRef.current || isAnalyzing) ? (
          <div className="rounded-xl border border-border bg-card p-6 min-h-[400px] max-h-[65vh] overflow-y-auto">
            <StreamingText
              content={displayRef.current}
              isStreaming={isAnalyzing}
            />
          </div>
        ) : !noNovels && !noApiKey ? (
          <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center min-h-[400px] text-center">
            <Sparkles className="w-12 h-12 text-primary/40 mb-4" />
            <p className="text-muted-foreground">点击下方按钮开始分析小说风格</p>
            <p className="text-muted-foreground/60 text-sm mt-1">AI 将从文风、剧情、人物、技巧等维度深入分析</p>
          </div>
        ) : null}

        {/* 操作按钮 */}
        <div className="flex items-center gap-3">
          {isAnalyzing ? (
            <Button
              onClick={stopAnalysis}
              variant="destructive"
              className="flex-1"
            >
              停止分析
            </Button>
          ) : (
            <Button
              onClick={startAnalysis}
              disabled={noNovels || noApiKey}
              className="flex-1"
            >
              {hasReport ? '重新分析' : '开始分析'}
            </Button>
          )}

          {hasReport && !isAnalyzing && (
            <Button
              variant="outline"
              onClick={() => setActiveView('write')}
            >
              确认，去仿写 →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
