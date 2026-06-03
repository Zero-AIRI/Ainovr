// ============================================
// 分析视图 — 流式展示风格分析报告
// ============================================

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StreamingText } from '@/components/StreamingText';
import { useAppStore } from '@/lib/store';
import { useStreamingFetch } from '@/lib/use-streaming-fetch';
import { needsApiKey } from '@/types';

export function AnalyzeView() {
  const novels = useAppStore((s) => s.novels);
  const analysisReport = useAppStore((s) => s.analysisReport);
  const isAnalyzing = useAppStore((s) => s.isAnalyzing);
  const setAnalysisReport = useAppStore((s) => s.setAnalysisReport);
  const setIsAnalyzing = useAppStore((s) => s.setIsAnalyzing);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const providerType = useAppStore((s) => s.providerType);
  const apiKey = useAppStore((s) => s.apiKey);
  const model = useAppStore((s) => s.model);
  const baseURL = useAppStore((s) => s.baseURL);
  const thinkingMode = useAppStore((s) => s.thinkingMode);
  const thinkingEffort = useAppStore((s) => s.thinkingEffort);
  const customProviders = useAppStore((s) => s.customProviders);

  const [streamContent, setStreamContent] = useState(analysisReport || '');
  const { startStream, abort } = useStreamingFetch();

  // 同步 store 中 analysisReport 变化（解决返回时 stale 状态）
  useEffect(() => {
    if (!isAnalyzing) {
      setStreamContent(analysisReport || '');
    }
  }, [analysisReport, isAnalyzing]);

  // 组件卸载时取消请求
  useEffect(() => abort, [abort]);

  const selectedProvider = useMemo(() => {
    if (providerType.startsWith('custom:')) {
      const id = providerType.slice('custom:'.length);
      return customProviders.find((p) => p.id === id) || null;
    }
    return null;
  }, [providerType, customProviders]);

  const startAnalysis = useCallback(async () => {
    if (!novels.length || (needsApiKey(providerType) && !apiKey)) return;

    setIsAnalyzing(true);
    setStreamContent('');
    setAnalysisReport(null);

    const result = await startStream({
      url: '/api/analyze',
      body: {
        novelTexts: novels.map((n) => n.sampleText),
        provider: providerType,
        apiKey,
        model,
        baseURL: baseURL || undefined,
        thinkingMode,
        thinkingEffort,
        customProviders: selectedProvider ? [selectedProvider] : [],
      },
      onChunk: setStreamContent,
      onError: (msg) => alert(`分析失败: ${msg}`),
    });

    if (result !== undefined) {
      setAnalysisReport(result);
    }
    setIsAnalyzing(false);
  }, [novels, providerType, apiKey, model, baseURL, thinkingMode, thinkingEffort, selectedProvider, startStream, setAnalysisReport, setIsAnalyzing]);

  const hasReport = (analysisReport || '').trim().length > 0;
  const noApiKey = needsApiKey(providerType) && !apiKey.trim();
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

        {/* 报告内容 */}
        {(streamContent || isAnalyzing) ? (
          <div className="rounded-xl border border-border bg-card p-6 min-h-[400px] max-h-[65vh] overflow-y-auto">
            <StreamingText
              content={streamContent}
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
          <Button
            onClick={startAnalysis}
            disabled={isAnalyzing || noNovels || noApiKey}
            className="flex-1"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                分析中...
              </>
            ) : (
              hasReport ? '重新分析' : '开始分析'
            )}
          </Button>

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
