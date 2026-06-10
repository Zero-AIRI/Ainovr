// ============================================
// 源小说详情页 — 处理 + 结果查看（8步管线）
// ============================================

'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Play, Loader2, XCircle, AlertTriangle, RotateCcw, Dna } from 'lucide-react';
import { toast } from 'sonner';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useSourceProcessingStore } from '@/lib/store/source-processing';
import { useSettingsStore } from '@/lib/store/settings';
import { useNavigationStore } from '@/lib/store/navigation';
import { MarkdownViewer } from './MarkdownViewer';
import { StreamingText } from '@/components/StreamingText';

const STEPS = [
  { key: 'slice', label: '智能切片' },
  { key: 'style', label: '文风画像' },
  { key: 'narrative', label: '叙事动力学' },
  { key: 'character', label: '角色动力学' },
  { key: 'reader', label: '读者体验' },
  { key: 'constraints', label: '叙事约束' },
  { key: 'samples', label: '样本选取' },
  { key: 'dna', label: 'DNA 压缩' },
];

type AnalysisTab = 'dna' | 'style' | 'narrative' | 'character' | 'reader' | 'constraints';

const TABS: { key: AnalysisTab; label: string; field: string }[] = [
  { key: 'dna', label: '🧬 Novel DNA', field: 'novelDna' },
  { key: 'style', label: '文风画像', field: 'styleProfile' },
  { key: 'narrative', label: '叙事动力学', field: 'plotReport' },
  { key: 'character', label: '角色动力学', field: 'characterDynamics' },
  { key: 'reader', label: '读者体验', field: 'readerExperience' },
  { key: 'constraints', label: '叙事约束', field: 'narrativeConstraints' },
];

export function SourceNovelDetailView() {
  const { sourceNovels, activeSourceId, setActiveSourceId } = useSourceLibraryStore();
  const setActiveView = useNavigationStore((s) => s.setActiveView);
  const getAIConfig = useSettingsStore((s) => s.getAIConfig);
  const processingStore = useSourceProcessingStore();

  const novel = sourceNovels.find((n) => n.id === activeSourceId);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('dna');
  const [rawText, setRawText] = useState<string | null>(null);

  // 判断当前小说是否正在处理
  const isThisProcessing = processingStore.processingNovelId === activeSourceId;
  const isAnyProcessing = processingStore.isRunningAll;

  // 加载完整数据
  useEffect(() => {
    if (!activeSourceId) return;
    fetch(`/api/library/get?id=${activeSourceId}`)
      .then((res) => res.json())
      .then((data) => {
        setRawText(data.rawText ?? null);
        const updates: Partial<import('@/types').SourceNovel> = {};
        if (data.styleProfile) updates.styleProfile = data.styleProfile;
        if (data.plotReport) updates.plotReport = data.plotReport;
        if (data.characterDynamics) updates.characterDynamics = data.characterDynamics;
        if (data.readerExperience) updates.readerExperience = data.readerExperience;
        if (data.narrativeConstraints) updates.narrativeConstraints = data.narrativeConstraints;
        if (data.novelDna) updates.novelDna = data.novelDna;
        if (data.status) updates.status = data.status;
        if (Object.keys(updates).length > 0) {
          useSourceLibraryStore.getState().updateSourceNovel(activeSourceId, updates);
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
    processingStore.startProcessing(novel.id, rawText, getAIConfig());
  };

  const handleCancel = () => {
    processingStore.cancelProcessing();
  };

  const handleReanalyze = async () => {
    if (!novel || isAnyProcessing) return;

    const confirmed = confirm('重新分析将覆盖现有分析结果，是否继续？');
    if (!confirmed) return;

    // 加载原始文本（如果尚未加载）
    let text = rawText;
    if (!text) {
      const res = await fetch(`/api/library/get?id=${novel.id}`);
      const data = await res.json();
      text = data.rawText ?? null;
    }

    if (!text) {
      toast.error('无法加载原始文本，请重新上传小说');
      return;
    }

    processingStore.startProcessing(novel.id, text, getAIConfig());
  };

  const isReady = novel.status === 'ready';
  const isRaw = novel.status === 'raw';
  const hasAnyResult = !!(novel.styleProfile || novel.plotReport || novel.characterDynamics || novel.readerExperience || novel.narrativeConstraints || novel.novelDna);

  // 获取当前步骤的流式内容
  const currentStep = processingStore.currentStep;
  const currentStreamContent = isThisProcessing && currentStep >= 0
    ? processingStore.streamContents[currentStep]
    : '';

  // 获取当前 tab 对应的字段内容
  const getTabContent = (tabKey: AnalysisTab): string | null => {
    switch (tabKey) {
      case 'dna': return novel.novelDna;
      case 'style': return novel.styleProfile;
      case 'narrative': return novel.plotReport;
      case 'character': return novel.characterDynamics;
      case 'reader': return novel.readerExperience;
      case 'constraints': return novel.narrativeConstraints;
    }
  };

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
          {isReady && novel.novelDna && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
              <Dna className="w-3 h-3" />
              DNA 已提取
            </span>
          )}
        </div>

        {/* 操作按钮 */}
        {isReady && (
          <button
            onClick={handleReanalyze}
            disabled={isAnyProcessing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            重新分析
          </button>
        )}
        {!isReady && (
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
                <Play className="w-4 h-4" />
                一键分析
              </button>
            )}
            {/* 断点恢复按钮：仅在有部分完成的步骤且当前未在处理时显示 */}
            {!isThisProcessing && processingStore.errorStep !== null && processingStore.completedSteps.length > 0 && (
              <button
                onClick={() => processingStore.resumeProcessing(novel.id)}
                disabled={isAnyProcessing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="w-4 h-4" />
                恢复处理（已完成 {processingStore.completedSteps.length}/{STEPS.length} 步）
              </button>
            )}
          </div>
        )}
      </div>

      {/* 进度指示器（处理中显示） */}
      {isThisProcessing && currentStep >= 0 && (
        <div className="mb-6 p-4 rounded-lg border border-border bg-card">
          {/* 总进度条 */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-foreground">
                正在分析 · 步骤 {currentStep + 1}/{STEPS.length} · {STEPS[currentStep]?.label}
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
          <div className="flex items-center gap-1 flex-wrap">
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
                    <div className={`w-4 h-px ${isCompleted ? 'bg-green-500' : 'bg-border'}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* 当前步骤流式输出 */}
          {currentStreamContent && (
            <div className="mt-2 p-3 rounded-md bg-muted/50 max-h-60 overflow-y-auto">
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

      {/* 结果标签页 */}
      {(isReady || hasAnyResult) && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 标签切换 */}
          <div className="flex gap-1 mb-4 border-b border-border pb-0 overflow-x-auto">
            {TABS.map((tab) => {
              const hasContent = !!((novel as unknown as Record<string, unknown>)[tab.field]);
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`
                    px-4 py-2 text-sm font-medium transition-colors relative whitespace-nowrap
                    ${activeTab === tab.key
                      ? 'text-primary'
                      : hasContent
                        ? 'text-muted-foreground hover:text-foreground'
                        : 'text-muted-foreground/50 hover:text-muted-foreground'
                    }
                  `}
                >
                  {tab.label}
                  {!hasContent && <span className="ml-1 text-xs opacity-40">—</span>}
                  {activeTab === tab.key && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                  )}
                </button>
              );
            })}
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto">
            {(() => {
              const content = getTabContent(activeTab);
              if (!content) {
                return (
                  <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                    尚未生成此分析报告
                  </div>
                );
              }

              // DNA tab 特殊处理：YAML 用代码块展示
              if (activeTab === 'dna') {
                return (
                  <div className="p-4 rounded-lg border border-border bg-card">
                    <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground leading-relaxed">
                      {content}
                    </pre>
                  </div>
                );
              }

              // 其他 tab 用 Markdown 渲染
              return (
                <div className="p-4 rounded-lg border border-border bg-card">
                  <MarkdownViewer content={content} />
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 未处理且未在处理中的空状态 */}
      {isRaw && !isThisProcessing && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <p className="text-sm mb-1">尚未处理此小说</p>
          <p className="text-xs opacity-60">点击右上角「一键分析」开始 8 步逆向工程分析</p>
        </div>
      )}
    </div>
  );
}
