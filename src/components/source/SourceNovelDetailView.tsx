// ============================================
// 源小说详情页 — 处理 + 结果查看（统一 7 步管线）
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
import { AnalysisResultViewer } from './AnalysisResultViewer';
import { StreamingText } from '@/components/StreamingText';

const STEPS = [
  { key: 'small-slice', label: '小切片' },
  { key: 'event-extract', label: '事件提取' },
  { key: 'event-align', label: '图谱对齐' },
  { key: 'large-slice', label: '大切片' },
  { key: 'deep-analysis', label: '深度分析' },
  { key: 'summary', label: '汇总报告' },
  { key: 'dna', label: 'DNA 压缩' },
];

// 新管线结果标签
type AnalysisTab = 'generation-rules-dna' | 'summary-report' | 'event-graph' | 'slice-analyses' | 'legacy-dna' | 'legacy-style' | 'legacy-narrative' | 'legacy-character' | 'legacy-reader' | 'legacy-constraints';

const TABS_NEW: { key: AnalysisTab; label: string; icon?: string }[] = [
  { key: 'generation-rules-dna', label: '🧬 生成规则 DNA', icon: '🧬' },
  { key: 'summary-report', label: '📊 汇总报告' },
  { key: 'event-graph', label: '🔗 事件图谱' },
  { key: 'slice-analyses', label: '🔬 切片分析' },
];

const TABS_LEGACY: { key: AnalysisTab; label: string }[] = [
  { key: 'legacy-dna', label: '旧 DNA' },
  { key: 'legacy-style', label: '旧文风' },
  { key: 'legacy-narrative', label: '旧叙事' },
  { key: 'legacy-character', label: '旧角色' },
  { key: 'legacy-reader', label: '旧体验' },
  { key: 'legacy-constraints', label: '旧约束' },
];

/** 将 JSON 对象格式化为可读的缩进文本 */
function formatJson(obj: unknown): string {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function SourceNovelDetailView() {
  const { sourceNovels, activeSourceId, setActiveSourceId } = useSourceLibraryStore();
  const setActiveView = useNavigationStore((s) => s.setActiveView);
  const getAIConfig = useSettingsStore((s) => s.getAIConfig);
  const processingStore = useSourceProcessingStore();

  const novel = sourceNovels.find((n) => n.id === activeSourceId);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('generation-rules-dna');
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
        const updates: Record<string, unknown> = {};
        // 旧管线数据（兼容）
        if (data.styleProfile) updates.styleProfile = data.styleProfile;
        if (data.plotReport) updates.plotReport = data.plotReport;
        if (data.characterDynamics) updates.characterDynamics = data.characterDynamics;
        if (data.readerExperience) updates.readerExperience = data.readerExperience;
        if (data.narrativeConstraints) updates.narrativeConstraints = data.narrativeConstraints;
        if (data.novelDna) updates.novelDna = data.novelDna;
        // 新管线数据
        if (data.generationRulesDna) updates.generationRulesDna = data.generationRulesDna;
        if (data.summaryReport) updates.unifiedSummaryReport = data.summaryReport;
        if (data.eventGraph) updates.eventGraph = data.eventGraph;
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

  // 检查是否有新管线数据
  const hasNewDna = !!novel.generationRulesDna;
  const hasSummaryReport = !!novel.unifiedSummaryReport;
  const hasEventGraph = !!novel.eventGraph;
  const hasNewResults = hasNewDna || hasSummaryReport || hasEventGraph;

  // 检查是否有旧管线数据
  const hasLegacy = !!(novel.styleProfile || novel.plotReport || novel.characterDynamics || novel.readerExperience || novel.narrativeConstraints || novel.novelDna);
  const hasAnyResult = hasNewResults || hasLegacy;

  // 获取当前步骤的流式内容
  const currentStep = processingStore.currentStep;
  const currentStreamContent = isThisProcessing && currentStep >= 0
    ? processingStore.streamContents[currentStep]
    : '';

  // 获取当前 tab 对应的内容
  const getTabContent = (tabKey: AnalysisTab): string | null => {
    switch (tabKey) {
      // 新管线
      case 'generation-rules-dna': return novel.generationRulesDna ? formatJson(novel.generationRulesDna) : null;
      case 'summary-report': return novel.unifiedSummaryReport ? formatJson(novel.unifiedSummaryReport) : null;
      case 'event-graph': return novel.eventGraph ? formatJson(novel.eventGraph) : null;
      case 'slice-analyses': return null; // sliceAnalyses 在文件中，不在 novel 对象上
      // 旧管线
      case 'legacy-dna': return novel.novelDna;
      case 'legacy-style': return novel.styleProfile;
      case 'legacy-narrative': return novel.plotReport;
      case 'legacy-character': return novel.characterDynamics;
      case 'legacy-reader': return novel.readerExperience;
      case 'legacy-constraints': return novel.narrativeConstraints;
    }
  };

  // 判断 tab 是否有内容
  const hasTabContent = (tabKey: AnalysisTab): boolean => {
    switch (tabKey) {
      case 'generation-rules-dna': return hasNewDna;
      case 'summary-report': return hasSummaryReport;
      case 'event-graph': return hasEventGraph;
      case 'slice-analyses': return false;
      case 'legacy-dna': return !!novel.novelDna;
      case 'legacy-style': return !!novel.styleProfile;
      case 'legacy-narrative': return !!novel.plotReport;
      case 'legacy-character': return !!novel.characterDynamics;
      case 'legacy-reader': return !!novel.readerExperience;
      case 'legacy-constraints': return !!novel.narrativeConstraints;
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
          {(novel.novelDna || novel.generationRulesDna) && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
              <Dna className="w-3 h-3" />
              {hasNewDna ? 'DNA 已提取' : '旧 DNA'}
            </span>
          )}
        </div>

        {/* 操作按钮 */}
        {(isReady || hasAnyResult) && (
          <button
            onClick={handleReanalyze}
            disabled={isAnyProcessing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            重新分析
          </button>
        )}
        {!isReady && !hasAnyResult && (
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
      {hasAnyResult && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 标签切换 */}
          <div className="flex gap-1 mb-4 border-b border-border pb-0 overflow-x-auto">
            {TABS_NEW.map((tab) => {
              const hasContent = hasTabContent(tab.key);
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
            {hasLegacy && (
              <>
                <div className="w-px h-6 bg-border self-center mx-1" />
                {TABS_LEGACY.map((tab) => {
                  const hasContent = hasTabContent(tab.key);
                  if (!hasContent) return null;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`
                        px-3 py-2 text-xs transition-colors relative whitespace-nowrap opacity-60 hover:opacity-100
                        ${activeTab === tab.key ? 'text-primary opacity-100' : 'text-muted-foreground'}
                      `}
                    >
                      {tab.label}
                      {activeTab === tab.key && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                      )}
                    </button>
                  );
                })}
              </>
            )}
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

              // 新管线 JSON 结构化展示 — 用中文可视化组件
              if (activeTab === 'generation-rules-dna') {
                return <AnalysisResultViewer type="dna" data={novel.generationRulesDna} />;
              }
              if (activeTab === 'summary-report') {
                return <AnalysisResultViewer type="summary" data={novel.unifiedSummaryReport} />;
              }
              if (activeTab === 'event-graph') {
                return <AnalysisResultViewer type="event-graph" data={novel.eventGraph} />;
              }

              // 旧管线 Markdown 渲染
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
      {isRaw && !isThisProcessing && !hasAnyResult && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <p className="text-sm mb-1">尚未处理此小说</p>
          <p className="text-xs opacity-60">点击右上角「一键分析」开始 7 步逆向工程分析</p>
        </div>
      )}
    </div>
  );
}
