// ============================================
// 源小说处理视图 — 4步管线
// ============================================

'use client';

import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Play, Loader2 } from 'lucide-react';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useSettingsStore } from '@/lib/store/settings';
import { useProjectStore } from '@/lib/store/project';
import { useStreamingFetch } from '@/lib/hooks/use-streaming-fetch';
import { ProcessStepIndicator } from './ProcessStepIndicator';
import { parseSliceOutput, fallbackSlice, getSlicingRequestBody } from '@/lib/source-processing/smart-slicer';
import { getStyleExtractionRequestBody, computeStyleBatches, getStyleSupplementRequestBody } from '@/lib/source-processing/style-extractor';
import { getPlotExtractionRequestBody, computePlotBatches, getPlotSupplementRequestBody } from '@/lib/source-processing/plot-extractor';
import { getSampleSelectionRequestBody, parseSampleOutput } from '@/lib/source-processing/sample-selector';
import { StreamingText } from '@/components/StreamingText';
import type { SemanticSlice } from '@/types';

const STEPS = [
  { key: 'slice', label: '智能切片' },
  { key: 'style', label: '文风提取' },
  { key: 'plot', label: '情节提取' },
  { key: 'samples', label: '样本选取' },
];

export function SourceProcessView() {
  const { sourceNovels, activeSourceId, updateSourceNovel, setActiveSourceId } = useSourceLibraryStore();
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const { getEffectiveApiKey, model, baseURL, maxContextTokens } = useSettingsStore();

  const novel = sourceNovels.find((n) => n.id === activeSourceId);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [currentStep, setCurrentStep] = useState(-1);
  const [errorStep, setErrorStep] = useState<number | undefined>();
  const [rawText, setRawText] = useState<string | null>(null);

  // 流式输出 hook
  const sliceStream = useStreamingFetch();
  const styleStream = useStreamingFetch();
  const plotStream = useStreamingFetch();
  const sampleStream = useStreamingFetch();

  const streams = [sliceStream, styleStream, plotStream, sampleStream];

  // 加载原文
  useEffect(() => {
    if (!activeSourceId) return;
    fetch(`/api/library/get?id=${activeSourceId}`)
      .then((res) => res.json())
      .then((data) => {
        setRawText(data.rawText ?? null);
        // 恢复已完成的步骤
        const completed = new Set<number>();
        if (data.slices?.length) completed.add(0);
        if (data.styleProfile) completed.add(1);
        if (data.plotReport) completed.add(2);
        if (data.representativeSamples?.length) completed.add(3);
        setCompletedSteps(completed);
      })
      .catch(console.error);
  }, [activeSourceId]);

  const getAI = useCallback(() => ({
    apiKey: getEffectiveApiKey(),
    model,
    baseURL,
    maxContextTokens,
  }), [getEffectiveApiKey, model, baseURL, maxContextTokens]);

  // Step 1: 智能切片
  const runSlicing = useCallback(async () => {
    if (!rawText || !activeSourceId) return;
    setCurrentStep(0);
    setErrorStep(undefined);
    updateSourceNovel(activeSourceId, { status: 'slicing' });

    const ai = getAI();
    const body = getSlicingRequestBody(rawText, ai.apiKey, ai.model, ai.baseURL);
    const result = await sliceStream.startFetch('/api/source/process/slice', body);

    if (result) {
      let slices = parseSliceOutput(result, activeSourceId);
      // fallback
      if (slices.length === 0) {
        slices = fallbackSlice(activeSourceId, rawText);
      }
      updateSourceNovel(activeSourceId, { slices });
      setCompletedSteps((prev) => new Set([...prev, 0]));
      return slices;
    } else {
      setErrorStep(0);
      updateSourceNovel(activeSourceId, { status: 'error' });
      return null;
    }
  }, [rawText, activeSourceId, getAI, sliceStream, updateSourceNovel]);

  // Step 2: 文风提取
  const runStyleExtraction = useCallback(async (slices: SemanticSlice[]) => {
    if (!activeSourceId) return;
    setCurrentStep(1);
    updateSourceNovel(activeSourceId, { status: 'extracting' });

    const ai = getAI();
    const batchInfo = computeStyleBatches(slices, ai.maxContextTokens);
    let profile = '';

    if (!batchInfo.needsBatch) {
      // 单批
      const body = getStyleExtractionRequestBody(slices, ai.apiKey, ai.model, ai.baseURL);
      const result = await styleStream.startFetch('/api/source/process/style', body);
      if (result) {
        profile = result;
      }
    } else {
      // 多批
      for (let i = 0; i < batchInfo.batches.length; i++) {
        const body = i === 0
          ? getStyleExtractionRequestBody(slices, ai.apiKey, ai.model, ai.baseURL)
          : getStyleSupplementRequestBody(batchInfo.batches[i], profile, ai.apiKey, ai.model, ai.baseURL);
        const result = await styleStream.startFetch('/api/source/process/style', body);
        if (result) profile = result;
        else break;
      }
    }

    if (profile) {
      updateSourceNovel(activeSourceId, { styleProfile: profile });
      setCompletedSteps((prev) => new Set([...prev, 1]));
      return profile;
    } else {
      setErrorStep(1);
      updateSourceNovel(activeSourceId, { status: 'error' });
      return null;
    }
  }, [activeSourceId, getAI, styleStream, updateSourceNovel]);

  // Step 3: 情节提取
  const runPlotExtraction = useCallback(async (slices: SemanticSlice[], styleProfile: string) => {
    if (!activeSourceId) return;
    setCurrentStep(2);

    const ai = getAI();
    const batchInfo = computePlotBatches(slices, ai.maxContextTokens);
    let report = '';

    if (!batchInfo.needsBatch) {
      const body = getPlotExtractionRequestBody(slices, styleProfile, ai.apiKey, ai.model, ai.baseURL);
      const result = await plotStream.startFetch('/api/source/process/plot', body);
      if (result) report = result;
    } else {
      for (let i = 0; i < batchInfo.batches.length; i++) {
        const body = i === 0
          ? getPlotExtractionRequestBody(slices, styleProfile, ai.apiKey, ai.model, ai.baseURL)
          : getPlotSupplementRequestBody(batchInfo.batches[i], report, styleProfile, ai.apiKey, ai.model, ai.baseURL);
        const result = await plotStream.startFetch('/api/source/process/plot', body);
        if (result) report = result;
        else break;
      }
    }

    if (report) {
      updateSourceNovel(activeSourceId, { plotReport: report });
      setCompletedSteps((prev) => new Set([...prev, 2]));
      return report;
    } else {
      setErrorStep(2);
      updateSourceNovel(activeSourceId, { status: 'error' });
      return null;
    }
  }, [activeSourceId, getAI, plotStream, updateSourceNovel]);

  // Step 4: 样本选取
  const runSampleSelection = useCallback(async (slices: SemanticSlice[], styleProfile: string, plotReport: string) => {
    if (!activeSourceId) return;
    setCurrentStep(3);
    updateSourceNovel(activeSourceId, { status: 'selecting' });

    const ai = getAI();
    const body = getSampleSelectionRequestBody(slices, styleProfile, plotReport, ai.apiKey, ai.model, ai.baseURL);
    const result = await sampleStream.startFetch('/api/source/process/samples', body);

    if (result) {
      const samples = parseSampleOutput(result);
      updateSourceNovel(activeSourceId, { representativeSamples: samples, status: 'ready', processedAt: new Date().toISOString() });
      setCompletedSteps((prev) => new Set([...prev, 3]));

      // 保存到服务端
      const updated = useSourceLibraryStore.getState().sourceNovels.find((n) => n.id === activeSourceId);
      if (updated) {
        await fetch('/api/library/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
      }
    } else {
      setErrorStep(3);
      updateSourceNovel(activeSourceId, { status: 'error' });
    }
  }, [activeSourceId, getAI, sampleStream, updateSourceNovel]);

  // 一键处理
  const runAll = useCallback(async () => {
    const slices = await runSlicing();
    if (!slices) return;
    const style = await runStyleExtraction(slices);
    if (!style) return;
    const plot = await runPlotExtraction(slices, style);
    if (!plot) return;
    await runSampleSelection(slices, style, plot);
    setCurrentStep(-1);
  }, [runSlicing, runStyleExtraction, runPlotExtraction, runSampleSelection]);

  // 分步执行
  const runStep = useCallback(async (stepIndex: number) => {
    const n = useSourceLibraryStore.getState().sourceNovels.find((s) => s.id === activeSourceId);
    if (!n) return;

    if (stepIndex === 0) {
      await runSlicing();
    } else if (stepIndex === 1) {
      if (!n.slices) return;
      await runStyleExtraction(n.slices);
    } else if (stepIndex === 2) {
      if (!n.slices || !n.styleProfile) return;
      await runPlotExtraction(n.slices, n.styleProfile);
    } else if (stepIndex === 3) {
      if (!n.slices || !n.styleProfile || !n.plotReport) return;
      await runSampleSelection(n.slices, n.styleProfile, n.plotReport);
    }
  }, [activeSourceId, runSlicing, runStyleExtraction, runPlotExtraction, runSampleSelection]);

  if (!novel) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        未选择源小说
      </div>
    );
  }

  const isRunning = streams.some((s) => s.isStreaming);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      {/* 头部 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => { setActiveSourceId(null); setActiveView('source-library'); }}
          className="p-1.5 rounded hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-xl font-bold text-foreground">处理《{novel.title}》</h1>
      </div>

      {/* 进度条 */}
      <div className="mb-6">
        <ProcessStepIndicator
          steps={STEPS}
          currentStep={currentStep}
          completedSteps={completedSteps}
          errorStep={errorStep}
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={runAll}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          一键处理
        </button>

        {/* 分步按钮 */}
        {STEPS.map((step, i) => {
          const canRun = !isRunning && (
            i === 0 ||
            completedSteps.has(i - 1)
          );
          const isDone = completedSteps.has(i);

          return (
            <button
              key={step.key}
              onClick={() => runStep(i)}
              disabled={!canRun || isDone}
              className={`
                px-3 py-1.5 rounded text-xs transition-colors
                ${isDone ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                ${!isDone && canRun ? 'bg-accent text-foreground hover:bg-accent/80' : ''}
                ${!canRun && !isDone ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}
              `}
            >
              {isDone ? `✓ ${step.label}` : step.label}
            </button>
          );
        })}
      </div>

      {/* 流式输出区域 */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {streams.map((stream, i) => (
          stream.streamContent ? (
            <div key={i} className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium text-foreground mb-2">{STEPS[i].label}结果</h3>
              <StreamingText content={stream.streamContent} isStreaming={stream.isStreaming} />
            </div>
          ) : null
        ))}

        {/* 已完成步骤的结果 */}
        {novel.styleProfile && !styleStream.streamContent && (
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium text-foreground mb-2">文风档案</h3>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{novel.styleProfile}</pre>
          </div>
        )}
        {novel.plotReport && !plotStream.streamContent && (
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium text-foreground mb-2">情节规律报告</h3>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{novel.plotReport}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
