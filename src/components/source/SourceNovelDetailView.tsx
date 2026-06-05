// ============================================
// 源小说详情页 — 处理 + 结果查看
// ============================================

'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Play, Loader2, XCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useSourceProcessingStore } from '@/lib/store/source-processing';
import { useSettingsStore } from '@/lib/store/settings';
import { useProjectStore } from '@/lib/store/project';
import { MarkdownViewer } from './MarkdownViewer';
import { StreamingText } from '@/components/StreamingText';

const STEPS = [
  { key: 'slice', label: '智能切片' },
  { key: 'style', label: '文风提取' },
  { key: 'plot', label: '情节提取' },
  { key: 'samples', label: '样本选取' },
];

export function SourceNovelDetailView() {
  const { sourceNovels, activeSourceId, setActiveSourceId } = useSourceLibraryStore();
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const { getEffectiveApiKey, model, baseURL, maxContextTokens } = useSettingsStore();
  const processingStore = useSourceProcessingStore();

  const novel = sourceNovels.find((n) => n.id === activeSourceId);
  const [activeTab, setActiveTab] = useState<'style' | 'plot'>('style');
  const [rawText, setRawText] = useState<string | null>(null);

  // 判断当前小说是否正在处理
  const isThisProcessing = processingStore.processingNovelId === activeSourceId;
  const isAnyProcessing = processingStore.isRunningAll;

  // 加载完整数据（包含 styleProfile / plotReport）
  useEffect(() => {
    if (!activeSourceId) return;
    fetch(`/api/library/get?id=${activeSourceId}`)
      .then((res) => res.json())
      .then((data) => {
        setRawText(data.rawText ?? null);
        // 将完整数据更新到 store，确保 styleProfile / plotReport 可用
        if (data.styleProfile !== undefined || data.plotReport !== undefined) {
          useSourceLibraryStore.getState().updateSourceNovel(activeSourceId, {
            styleProfile: data.styleProfile ?? null,
            plotReport: data.plotReport ?? null,
            slices: data.slices ?? null,
            representativeSamples: data.representativeSamples ?? null,
            status: data.status ?? 'raw',
          });
        }
      })
      .catch(console.error);
  }, [activeSourceId]);

  if (!novel) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        未选择源小说
      </div>
    );
  }

  const handleBack = () => {
    setActiveSourceId(null);
    setActiveView('source-library');
  };

  const handleStartProcessing = () => {
    if (!rawText || isAnyProcessing) return;
    processingStore.startProcessing(novel.id, rawText, {
      apiKey: getEffectiveApiKey(),
      model,
      baseURL,
      maxContextTokens,
    });
  };

  const handleCancel = () => {
    processingStore.cancelProcessing();
  };

  const isReady = novel.status === 'ready';
  const isRaw = novel.status === 'raw';
  const hasStyle = !!novel.styleProfile;
  const hasPlot = !!novel.plotReport;

  // 获取当前步骤的流式内容
  const currentStep = processingStore.currentStep;
  const currentStreamContent = isThisProcessing && currentStep >= 0
    ? processingStore.streamContents[currentStep]
    : '';

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1.5 rounded hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-xl font-bold text-foreground">《{novel.title}》</h1>
          <span className="text-xs text-muted-foreground">{novel.totalChars.toLocaleString()} 字</span>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2">
          {isThisProcessing ? (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm hover:bg-destructive/20 transition-colors"
            >
              <XCircle className="w-4 h-4" />
              取消处理
            </button>
          ) : (
            <button
              onClick={handleStartProcessing}
              disabled={isAnyProcessing || !rawText}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isReady ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isReady ? '重新处理' : '一键处理'}
            </button>
          )}
        </div>
      </div>

      {/* 进度指示器（处理中显示） */}
      {isThisProcessing && currentStep >= 0 && (
        <div className="mb-6 p-4 rounded-lg border border-border bg-card">
          {/* 总进度条 */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-foreground">
                正在处理 · 步骤 {currentStep + 1}/4 · {STEPS[currentStep]?.label}
              </span>
              <span className="text-xs text-primary font-medium">
                {processingStore.progress}%
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${processingStore.progress}%` }}
              />
            </div>
          </div>

          {/* 步骤指示 */}
          <div className="flex items-center gap-1">
            {STEPS.map((step, i) => {
              const isCompleted = processingStore.completedSteps.includes(i);
              const isRunning = currentStep === i;

              return (
                <div key={step.key} className="flex items-center gap-1">
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors
                        ${isCompleted ? 'bg-green-500 text-white' : ''}
                        ${isRunning ? 'bg-primary text-primary-foreground animate-pulse' : ''}
                        ${!isCompleted && !isRunning ? 'bg-muted text-muted-foreground' : ''}
                      `}
                    >
                      {isCompleted ? '✓' : isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : i + 1}
                    </div>
                    <span className={`text-xs ${isRunning ? 'text-foreground font-medium' : isCompleted ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`w-8 h-px ${isCompleted ? 'bg-green-500' : 'bg-border'}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* 当前步骤流式输出 */}
          {currentStreamContent && (
            <div className="mt-2 p-3 rounded-md bg-muted/50">
              <StreamingText
                content={currentStreamContent}
                isStreaming={currentStep >= 0 && processingStore.isStreaming[currentStep]}
              />
            </div>
          )}
        </div>
      )}

      {/* 处理出错提示 */}
      {isThisProcessing && processingStore.errorStep !== null && processingStore.errorMessage && (
        <div className="mb-6 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-destructive mb-1">
                步骤 {processingStore.errorStep + 1}「{STEPS[processingStore.errorStep]?.label}」出错
              </h3>
              <p className="text-xs text-muted-foreground">{processingStore.errorMessage}</p>
              <button
                onClick={() => {
                  processingStore.resetProcessing();
                  handleStartProcessing();
                }}
                className="flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                重新处理
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 结果标签页（处理完成后显示） */}
      {(isReady || hasStyle || hasPlot) && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 标签切换 */}
          <div className="flex gap-1 mb-4 border-b border-border pb-0">
            <button
              onClick={() => setActiveTab('style')}
              className={`
                px-4 py-2 text-sm font-medium transition-colors relative
                ${activeTab === 'style'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              文风档案
              {activeTab === 'style' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('plot')}
              className={`
                px-4 py-2 text-sm font-medium transition-colors relative
                ${activeTab === 'plot'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              情节报告
              {activeTab === 'plot' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'style' && (
              hasStyle ? (
                <div className="p-4 rounded-lg border border-border bg-card">
                  <MarkdownViewer content={novel.styleProfile!} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  尚未提取文风档案
                </div>
              )
            )}
            {activeTab === 'plot' && (
              hasPlot ? (
                <div className="p-4 rounded-lg border border-border bg-card">
                  <MarkdownViewer content={novel.plotReport!} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  尚未提取情节报告
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* 未处理且未在处理中的空状态 */}
      {isRaw && !isThisProcessing && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <p className="text-sm mb-1">尚未处理此小说</p>
          <p className="text-xs opacity-60">点击右上角「一键处理」开始分析文风和情节</p>
        </div>
      )}
    </div>
  );
}
