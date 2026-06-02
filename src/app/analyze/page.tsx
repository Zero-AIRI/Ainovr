// ============================================
// 分析页 — 流式展示风格分析报告
// ============================================

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/Navbar';
import { SettingsDialog } from '@/components/SettingsDialog';
import { StreamingText } from '@/components/StreamingText';
import { useAppStore } from '@/lib/store';

export default function AnalyzePage() {
  const router = useRouter();
  const novels = useAppStore((s) => s.novels);
  const analysisReport = useAppStore((s) => s.analysisReport);
  const isAnalyzing = useAppStore((s) => s.isAnalyzing);
  const setAnalysisReport = useAppStore((s) => s.setAnalysisReport);
  const setIsAnalyzing = useAppStore((s) => s.setIsAnalyzing);
  const apiKey = useAppStore((s) => s.apiKey);
  const model = useAppStore((s) => s.model);
  const providerType = useAppStore((s) => s.providerType);
  const baseURL = useAppStore((s) => s.baseURL);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streamContent, setStreamContent] = useState(analysisReport || '');

  const startAnalysis = useCallback(async () => {
    if (!novels.length || !apiKey) return;

    setIsAnalyzing(true);
    setStreamContent('');
    setAnalysisReport(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelTexts: novels.map((n) => n.sampleText),
          provider: providerType,
          apiKey,
          model,
          baseURL: baseURL || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || '分析请求失败');
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

      setAnalysisReport(fullText);
    } catch (err) {
      alert(`分析失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [novels, apiKey, providerType, model, baseURL, setAnalysisReport, setIsAnalyzing]);

  // 自动开始分析（如果还没有报告）
  const hasReport = (analysisReport || '').trim().length > 0;

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar onSettingsClick={() => setSettingsOpen(true)} />

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* 标题 */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-100">风格分析报告</h1>
              <p className="text-sm text-gray-500 mt-1">
                分析作品：{novels.map((n) => `《${n.title}》`).join('、')}
              </p>
            </div>
          </div>

          {/* 报告内容 */}
          {(streamContent || isAnalyzing) ? (
            <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-6 min-h-[400px] max-h-[65vh] overflow-y-auto">
              <StreamingText
                content={streamContent}
                isStreaming={isAnalyzing}
              />
            </div>
          ) : (
            <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-12 flex flex-col items-center justify-center min-h-[400px] text-center">
              <Sparkles className="w-12 h-12 text-violet-500/50 mb-4" />
              <p className="text-gray-400">点击下方按钮开始分析小说风格</p>
              <p className="text-gray-600 text-sm mt-1">AI 将从文风、剧情、人物、技巧等维度深入分析</p>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => router.push('/')}
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              返回
            </Button>

            <Button
              onClick={startAnalysis}
              disabled={isAnalyzing || !novels.length}
              className="bg-violet-600 hover:bg-violet-500 flex-1"
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
                onClick={() => router.push('/write')}
                className="bg-violet-600 hover:bg-violet-500"
              >
                确认，去仿写
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
