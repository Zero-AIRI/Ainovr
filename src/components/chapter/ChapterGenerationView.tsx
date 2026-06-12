// ============================================
// 章节生成视图 — 生成 + 审查 + 修正
// ============================================

'use client';

import { useState, useCallback, useMemo } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useSettingsStore } from '@/lib/store/settings';
import { useStreamingFetch } from '@/lib/hooks/use-streaming-fetch';
import { assembleLayerContext } from '@/lib/generation/context-assembler';
import { parseReviewOutput, isReviewPassed } from '@/lib/generation/chapter-reviewer';
import { StreamingText } from '@/components/StreamingText';
import { ReviewPanel } from './ReviewPanel';
import { FeedbackInput } from './FeedbackInput';
import type { GeneratedChapter, ChapterPlan } from '@/types';
import { nanoid } from 'nanoid';

export function ChapterGenerationView({ embedded = false }: { embedded?: boolean }) {
  const { projects, activeProjectId, addGeneratedChapter, updateGeneratedChapter } = useProjectStore();
  const { sourceNovels } = useSourceLibraryStore();
  const getAIConfig = useSettingsStore((s) => s.getAIConfig);

  // 用 useMemo 稳定派生值，避免 useCallback 依赖在每次渲染时变化
  const project = useMemo(() => projects.find((p) => p.id === activeProjectId), [projects, activeProjectId]);
  const projectSources = useMemo(
    () => sourceNovels.filter((s) => project?.sourceNovelIds.includes(s.id)),
    [sourceNovels, project],
  );
  const chapterPlans = useMemo(() => project?.chapterPlans ?? [], [project]);

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [currentChapter, setCurrentChapter] = useState<GeneratedChapter | null>(null);

  const generateStream = useStreamingFetch();
  const reviewStream = useStreamingFetch();
  const reviseStream = useStreamingFetch();

  const selectedPlan = useMemo(
    () => chapterPlans.find((p) => p.id === selectedPlanId) ?? null,
    [chapterPlans, selectedPlanId],
  );

  // 生成章节正文
  const handleGenerate = useCallback(async (plan: ChapterPlan) => {
    if (!project) return;

    const ai = getAIConfig();
    const ctx = assembleLayerContext(5, projectSources, project, plan.id);

    const result = await generateStream.startFetch('/api/chapter/generate', {
      styleGuide: ctx.styleGuide,
      hierarchyContext: ctx.hierarchyContext,
      chapterTask: ctx.chapterTask,
      previousState: ctx.previousState,
      daoContext: ctx.daoContext,
      rhythmPrescription: ctx.rhythmPrescription,
      apiKey: ai.apiKey,
      model: ai.model,
      baseURL: ai.baseURL,
    });

    if (result) {
      const chapter: GeneratedChapter = {
        id: nanoid(),
        chapterPlanId: plan.id,
        content: result,
        generatedAt: new Date().toISOString(),
        reviewStatus: 'pending_review',
        revisionCount: 0,
        reviews: [],
        humanFeedback: null,
      };
      setCurrentChapter(chapter);
      addGeneratedChapter(project.id, chapter);
    }
  }, [project, projectSources, getAIConfig, generateStream, addGeneratedChapter]);

  // 自动审查
  const handleReview = useCallback(async () => {
    if (!currentChapter || !project) return;
    const chapterId = currentChapter.id;

    const ai = getAIConfig();
    const ctx = assembleLayerContext(5, projectSources, project, currentChapter.chapterPlanId);

    const result = await reviewStream.startFetch('/api/chapter/review', {
      chapterContent: currentChapter.content,
      styleGuide: ctx.styleGuide,
      chapterTask: ctx.chapterTask,
      daoContext: ctx.daoContext,
      apiKey: ai.apiKey,
      model: ai.model,
      baseURL: ai.baseURL,
    });

    if (result) {
      const reviews = parseReviewOutput(result);
      const passed = isReviewPassed(reviews);
      const updated = {
        reviews,
        reviewStatus: passed ? 'approved' as const : 'needs_revision' as const,
      };
      setCurrentChapter((prev) => prev ? { ...prev, ...updated } : null);
      if (project) updateGeneratedChapter(project.id, chapterId, updated);
    }
  }, [currentChapter, project, projectSources, getAIConfig, reviewStream, updateGeneratedChapter]);

  // 修正
  const handleRevise = useCallback(async (feedback?: string) => {
    if (!currentChapter || !project || currentChapter.revisionCount >= 3) return;
    const chapterId = currentChapter.id;

    const ai = getAIConfig();
    const ctx = assembleLayerContext(5, projectSources, project, currentChapter.chapterPlanId);
    const reviewsText = currentChapter.reviews.map((r) =>
      `${r.dimension}: ${r.score}/10 - ${r.issues.join(', ')}`
    ).join('\n');

    const result = await reviseStream.startFetch('/api/chapter/revise', {
      chapterContent: currentChapter.content,
      reviews: reviewsText,
      humanFeedback: feedback ?? null,
      styleGuide: ctx.styleGuide,
      chapterTask: ctx.chapterTask,
      daoContext: ctx.daoContext,
      apiKey: ai.apiKey,
      model: ai.model,
      baseURL: ai.baseURL,
    });

    if (result) {
      const updated = {
        content: result,
        revisionCount: currentChapter.revisionCount + 1,
        reviewStatus: 'pending_review' as const,
        humanFeedback: feedback ?? null,
      };
      setCurrentChapter((prev) => prev ? { ...prev, ...updated } : null);
      updateGeneratedChapter(project.id, chapterId, updated);
    }
  }, [currentChapter, project, projectSources, getAIConfig, reviseStream, updateGeneratedChapter]);

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        未选择项目
      </div>
    );
  }

  if (chapterPlans.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6">
        <p className="text-sm">尚未生成章节计划</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧：章节列表 */}
      <div className="w-56 border-r border-border overflow-y-auto p-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">章节计划</h3>

        {chapterPlans.map((plan) => {
          const chapter = project.chapters.find((c) => c.chapterPlanId === plan.id);
          const isSelected = selectedPlanId === plan.id;

          return (
            <button
              key={plan.id}
              onClick={() => { setSelectedPlanId(plan.id); setCurrentChapter(chapter ?? null); }}
              className={`
                w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 transition-colors
                ${isSelected ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'}
              `}
            >
              <span>{plan.title}</span>
              {chapter && (
                <span className={`ml-1 ${chapter.reviewStatus === 'approved' ? 'text-green-500' : 'text-muted-foreground'}`}>
                  {chapter.reviewStatus === 'approved' ? '✓' : chapter.revisionCount > 0 ? `改${chapter.revisionCount}` : '○'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 右侧：章节内容 + 审查 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {selectedPlan && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">{selectedPlan.title}</h2>
              {!currentChapter && (
                <button
                  onClick={() => handleGenerate(selectedPlan)}
                  disabled={generateStream.isStreaming}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {generateStream.isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  生成章节
                </button>
              )}
            </div>

            {/* 计划内容 */}
            <div className="p-3 rounded bg-muted/50 text-xs text-muted-foreground">
              {selectedPlan.content}
            </div>

            {/* 生成结果 */}
            {(generateStream.streamContent || currentChapter) && (
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium text-foreground mb-2">章节正文</h3>
                {generateStream.isStreaming ? (
                  <StreamingText content={generateStream.streamContent} isStreaming={true} />
                ) : (
                  <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {currentChapter?.content}
                  </div>
                )}
              </div>
            )}

            {/* 审查按钮 */}
            {currentChapter && currentChapter.reviewStatus === 'pending_review' && !reviewStream.isStreaming && (
              <button
                onClick={handleReview}
                className="px-4 py-2 rounded-lg bg-accent text-foreground text-sm hover:bg-accent/80 transition-colors"
              >
                开始审查
              </button>
            )}

            {/* 审查中 */}
            {reviewStream.isStreaming && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                审查中...
              </div>
            )}

            {/* 审查结果 */}
            {currentChapter?.reviews && currentChapter.reviews.length > 0 && (
              <ReviewPanel
                reviews={currentChapter.reviews}
                onRevise={() => handleRevise()}
                canRevise={currentChapter.revisionCount < 3}
                revisionCount={currentChapter.revisionCount}
              />
            )}

            {/* 修正中 */}
            {reviseStream.isStreaming && (
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium text-foreground mb-2">修正中...</h3>
                <StreamingText content={reviseStream.streamContent} isStreaming={true} />
              </div>
            )}

            {/* 人工反馈 */}
            {currentChapter && currentChapter.reviewStatus === 'needs_revision' && currentChapter.revisionCount < 3 && (
              <FeedbackInput
                onSubmit={(feedback) => handleRevise(feedback)}
                disabled={reviseStream.isStreaming}
              />
            )}
          </>
        )}

        {!selectedPlan && (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
            选择左侧章节计划开始生成
          </div>
        )}
      </div>
    </div>
  );
}
