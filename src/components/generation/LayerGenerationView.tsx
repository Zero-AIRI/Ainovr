// ============================================
// 五层管线视图 — 逐层生成
// ============================================

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { useProjectStore } from '@/lib/store/project';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useSettingsStore } from '@/lib/store/settings';
import { useStreamingFetch } from '@/lib/hooks/use-streaming-fetch';
import { LayerCard } from './LayerCard';
import { HierarchyTree } from './HierarchyTree';
import type { Phase, Volume, ChapterSet, ChapterPlan } from '@/types';

const LAYER_INFO = [
  { title: '全书大纲', description: '基于大情节框架和创作想法，约200字，确定后不可变' },
  { title: '阶段规划', description: '4-6个阶段，每阶段约500字，分配节奏和伏笔' },
  { title: '分卷', description: '每阶段1-2卷，每卷约300字，匹配小情节模式' },
  { title: '章节集合', description: '每卷3-5个集合，每个约200字，安排小情节出场' },
  { title: '每章计划', description: '每章约100字，场景节拍+关键词+伏笔操作' },
];

/** 从框架文本中解析编号/标题列表项 */
function parseFrameworkItems(text: string): { title: string }[] {
  const items: { title: string }[] = [];
  for (const line of text.split('\n')) {
    const numbered = line.match(/^\s*(\d+)\.\s*(.+)/);
    if (numbered) { items.push({ title: numbered[2].trim() }); continue; }
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) items.push({ title: heading[1].trim() });
  }
  return items;
}

/** 按 ## 标题拆分编辑后的文本 → 带索引的段落 */
function splitSections(text: string): { title: string; content: string }[] {
  return text.split(/^## /m).filter(Boolean).map((sec) => {
    const lines = sec.split('\n');
    return { title: lines[0].trim(), content: lines.slice(1).join('\n').trim() };
  });
}

// ---- 多步流式 hook ----

function useMultiStepStream() {
  const stream = useStreamingFetch();
  const [accumulated, setAccumulated] = useState('');
  const [step, setStep] = useState(0);
  const [total, setTotal] = useState(0);

  const reset = useCallback(() => {
    setAccumulated('');
    setStep(0);
    setTotal(0);
    stream.abort();
  }, [stream]);

  const appendDone = useCallback((text: string) => {
    setAccumulated((prev) => prev + (prev ? '\n\n' : '') + text);
  }, []);

  const setProgress = useCallback((s: number, t: number) => {
    setStep(s);
    setTotal(t);
  }, []);

  const displayText = accumulated + (stream.streamContent ? (accumulated ? '\n\n' : '') + stream.streamContent : '');
  const progress = total > 0 ? Math.round((step / total) * 100) : 0;

  return { ...stream, displayText, progress, step, total, reset, appendDone, setProgress };
}

// ---- 组件 ----

export function LayerGenerationView({ embedded = false }: { embedded?: boolean }) {
  const { projects, activeProjectId, setActiveProjectId, setOutline, setPhases, setVolumes, setChapterSets, setChapterPlans, updateProject } = useProjectStore();
  const { sourceNovels } = useSourceLibraryStore();
  const getAIConfig = useSettingsStore((s) => s.getAIConfig);

  const project = projects.find((p) => p.id === activeProjectId);
  const projectSources = sourceNovels.filter((s) => project?.sourceNovelIds.includes(s.id));

  const genStream = useMultiStepStream();
  const [userConcept, setUserConcept] = useState('');
  const [generatingLayer, setGeneratingLayer] = useState<number | null>(null);
  const [generationLabel, setGenerationLabel] = useState('');
  const cancelledRef = useRef(false);

  // 加载项目完整数据
  useEffect(() => {
    if (!activeProjectId) return;
    fetch(`/api/project/load?id=${activeProjectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.project) useProjectStore.getState().updateProject(activeProjectId, data.project);
      })
      .catch(console.error);
  }, [activeProjectId]);

  const saveProject = useCallback(async () => {
    if (!activeProjectId) return;
    const current = useProjectStore.getState().projects.find((p) => p.id === activeProjectId);
    if (!current) return;
    await fetch('/api/project/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(current),
    });
  }, [activeProjectId]);

  const getAI = useCallback(() => getAIConfig(), [getAIConfig]);

  const getPlotGuide = useCallback(() =>
    projectSources.map((s) => s.plotReport).filter(Boolean).join('\n\n'),
    [projectSources]
  );

  // ── 通用框架→详情生成器（L3/L4/L5 共用） ──
  const runFrameworkDetail = useCallback(async <T,>(
    layerNum: number,
    layerLabel: string,
    parents: { id: string; title: string; content: string }[],
    frameworkUrl: string,
    detailUrl: string,
    buildFrameworkBody: (parent: { id: string; title: string; content: string }, ai: ReturnType<typeof getAI>) => object,
    buildDetailBody: (parent: { id: string; title: string; content: string }, framework: string, idx: number, ai: ReturnType<typeof getAI>) => object,
    buildItem: (parent: { id: string; title: string; content: string }, parsed: { title: string }, idx: number, detail: string) => T,
    onSave: (items: T[]) => void,
  ) => {
    setGeneratingLayer(layerNum);
    setGenerationLabel(layerLabel);
    cancelledRef.current = false;
    genStream.reset();
    const ai = getAI();

    const allItems: T[] = [];
    let stepCount = 0;
    const estimatedTotal = parents.length * 2;

    for (const parent of parents) {
      if (cancelledRef.current) break;

      setGenerationLabel(`${layerLabel} · ${parent.title} · 框架`);
      stepCount++;
      genStream.setProgress(stepCount, estimatedTotal);

      const framework = await genStream.startFetch(frameworkUrl, buildFrameworkBody(parent, ai));
      if (!framework || cancelledRef.current) continue;

      genStream.appendDone(`### ${parent.title} — ${layerLabel}框架\n${framework}`);

      const parsed = parseFrameworkItems(framework);
      if (parsed.length === 0) parsed.push({ title: `${parent.title} · ${layerLabel}一` });

      for (let i = 0; i < parsed.length; i++) {
        if (cancelledRef.current) break;
        setGenerationLabel(`${layerLabel} · ${parsed[i].title}`);
        stepCount++;
        genStream.setProgress(stepCount, estimatedTotal + parsed.length - 1);

        const detail = await genStream.startFetch(detailUrl, buildDetailBody(parent, framework, i, ai));
        if (detail) genStream.appendDone(`## ${parsed[i].title}\n${detail}`);
        allItems.push(buildItem(parent, parsed[i], i, detail ?? ''));
      }
    }

    if (allItems.length > 0 && !cancelledRef.current) {
      onSave(allItems);
      await saveProject();
    }
    setGeneratingLayer(null);
    setGenerationLabel('');
  }, [genStream, getAI, saveProject]);

  // ── L1: 生成大纲 ──
  const handleGenerateOutline = useCallback(async () => {
    if (!project || !userConcept.trim()) return;
    setGeneratingLayer(1);
    setGenerationLabel('生成全书大纲');
    cancelledRef.current = false;
    genStream.reset();
    genStream.setProgress(0, 1);

    const ai = getAI();
    const styleGuide = projectSources.map((s) => s.styleProfile).filter(Boolean).join('\n\n');
    const plotGuide = getPlotGuide();

    const result = await genStream.startFetch('/api/generation/outline', {
      styleGuide, plotGuide, userConcept: userConcept.trim(), ...ai,
    });

    if (result && !cancelledRef.current) {
      genStream.setProgress(1, 1);
      setOutline(project.id, {
        content: result, generatedAt: new Date().toISOString(), isLocked: true, majorPlotFrameworkRef: '',
      });
      await saveProject();
    }
    setGeneratingLayer(null);
    setGenerationLabel('');
  }, [project, projectSources, userConcept, getAI, getPlotGuide, genStream, setOutline, saveProject]);

  // ── L2: 生成阶段规划 ──
  const handleGeneratePhases = useCallback(async () => {
    if (!project?.outline) return;
    setGeneratingLayer(2);
    setGenerationLabel('阶段规划');
    cancelledRef.current = false;
    genStream.reset();
    const ai = getAI();
    const plotGuide = getPlotGuide();

    // 单次框架
    setGenerationLabel('阶段规划 · 生成框架');
    genStream.setProgress(0, 2);
    const framework = await genStream.startFetch('/api/generation/phase-framework', {
      outline: project.outline.content, plotGuide, ...ai,
    });
    if (!framework || cancelledRef.current) { setGeneratingLayer(null); setGenerationLabel(''); return; }
    genStream.appendDone(framework);

    const parsed = parseFrameworkItems(framework);
    if (parsed.length === 0) parsed.push({ title: '阶段一' });

    genStream.setProgress(1, parsed.length);

    // 逐阶段详情
    const phases: Phase[] = [];
    for (let i = 0; i < parsed.length; i++) {
      if (cancelledRef.current) break;
      setGenerationLabel(`阶段规划 · 详细 ${i + 1}/${parsed.length}`);
      genStream.setProgress(i + 1, parsed.length);
      const detail = await genStream.startFetch('/api/generation/phase-detail', {
        outline: project.outline.content, phaseFramework: framework, phaseIndex: i, plotGuide, ...ai,
      });
      if (detail) genStream.appendDone(`## ${parsed[i].title}\n${detail}`);
      phases.push({ id: nanoid(), index: i, title: parsed[i].title, content: detail ?? '', volumeCount: 2, generatedAt: new Date().toISOString() });
    }

    if (phases.length > 0 && !cancelledRef.current) {
      setPhases(project.id, phases);
      await saveProject();
    }
    setGeneratingLayer(null);
    setGenerationLabel('');
  }, [project, getAI, getPlotGuide, genStream, setPhases, saveProject]);

  // ── L3: 分卷（通用框架→详情） ──
  const handleGenerateVolumes = useCallback(async () => {
    if (!project?.outline || !project.phases) return;
    await runFrameworkDetail<Volume>(
      3, '分卷',
      project.phases.map((p) => ({ id: p.id, title: p.title, content: p.content })),
      '/api/generation/volume-framework',
      '/api/generation/volume-detail',
      (phase, ai) => ({ outline: project.outline!.content, phaseContent: `${phase.title}\n${phase.content}`, minorPlotPatterns: getPlotGuide(), ...ai }),
      (phase, fw, idx, ai) => ({ outline: project.outline!.content, phaseContent: `${phase.title}\n${phase.content}`, volumeFramework: fw, volumeIndex: idx, minorPlotPatterns: getPlotGuide(), ...ai }),
      (phase, p, idx, detail) => ({ id: nanoid(), phaseId: phase.id, index: idx, title: p.title, content: detail, chapterSetCount: 3, generatedAt: new Date().toISOString() }),
      (items) => setVolumes(project.id, items),
    );
  }, [project, getAI, getPlotGuide, runFrameworkDetail, setVolumes]);

  // ── L4: 章节集合 ──
  const handleGenerateChapterSets = useCallback(async () => {
    if (!project?.volumes) return;
    await runFrameworkDetail<ChapterSet>(
      4, '章节集合',
      project.volumes.map((v) => ({ id: v.id, title: v.title, content: v.content })),
      '/api/generation/chapter-set-framework',
      '/api/generation/chapter-set-detail',
      (vol, ai) => ({ volumeContent: `${vol.title}\n${vol.content}`, minorPlotPatterns: getPlotGuide(), ...ai }),
      (vol, fw, idx, ai) => ({ volumeContent: `${vol.title}\n${vol.content}`, setFramework: fw, setIndex: idx, minorPlotPatterns: getPlotGuide(), ...ai }),
      (vol, p, idx, detail) => ({ id: nanoid(), volumeId: vol.id, index: idx, title: p.title, content: detail, chapterCount: 5, generatedAt: new Date().toISOString() }),
      (items) => setChapterSets(project.id, items),
    );
  }, [project, getAI, getPlotGuide, runFrameworkDetail, setChapterSets]);

  // ── L5: 每章计划 ──
  const handleGenerateChapterPlans = useCallback(async () => {
    if (!project?.chapterSets) return;
    await runFrameworkDetail<ChapterPlan>(
      5, '每章计划',
      project.chapterSets.map((s) => ({ id: s.id, title: s.title, content: s.content })),
      '/api/generation/chapter-plan-framework',
      '/api/generation/chapter-plan-detail',
      (set, ai) => ({ setContent: `${set.title}\n${set.content}`, minorPlotPatterns: getPlotGuide(), ...ai }),
      (set, fw, idx, ai) => ({ setContent: `${set.title}\n${set.content}`, planFramework: fw, chapterIndex: idx, minorPlotPatterns: getPlotGuide(), ...ai }),
      (set, p, idx, detail) => ({ id: nanoid(), chapterSetId: set.id, index: idx, title: p.title, content: detail, plotKeywords: [], patternStructure: '', generatedAt: new Date().toISOString() }),
      (items) => setChapterPlans(project.id, items),
    );
  }, [project, getAI, getPlotGuide, runFrameworkDetail, setChapterPlans]);

  // ── 重新生成（带自定义提示词） ──
  const handleRegenWithPrompt = useCallback(async (layerNum: number, customPrompt: string) => {
    if (!project) return;
    if (layerNum === 1) {
      setUserConcept(customPrompt);
      setTimeout(() => handleGenerateOutline(), 0);
    } else {
      const layerSetter: Record<number, () => void> = {
        2: () => setPhases(project.id, null as unknown as Phase[]),
        3: () => setVolumes(project.id, null as unknown as Volume[]),
        4: () => setChapterSets(project.id, null as unknown as ChapterSet[]),
        5: () => setChapterPlans(project.id, null as unknown as ChapterPlan[]),
      };
      layerSetter[layerNum]?.();
      await saveProject();
      const handlers: Record<number, () => void> = { 2: handleGeneratePhases, 3: handleGenerateVolumes, 4: handleGenerateChapterSets, 5: handleGenerateChapterPlans };
      handlers[layerNum]?.();
    }
  }, [project, handleGenerateOutline, handleGeneratePhases, handleGenerateVolumes, handleGenerateChapterSets, handleGenerateChapterPlans, setPhases, setVolumes, setChapterSets, setChapterPlans, saveProject]);

  // ── 手动编辑某层内容 ──
  const handleEditContent = useCallback(async (layerNum: number, newContent: string) => {
    if (!project || !activeProjectId) return;
    if (layerNum === 1 && project.outline) {
      updateProject(activeProjectId, { outline: { ...project.outline, content: newContent } });
    } else if (layerNum === 2) {
      const phases = splitSections(newContent).map((sec, i) => ({
        id: project.phases?.[i]?.id ?? nanoid(), index: i, title: sec.title, content: sec.content, volumeCount: 2, generatedAt: new Date().toISOString(),
      }));
      setPhases(activeProjectId, phases);
    } else if (layerNum === 3) {
      const volumes = splitSections(newContent).map((sec, i) => ({
        id: project.volumes?.[i]?.id ?? nanoid(), phaseId: project.phases?.[0]?.id ?? '', index: i, title: sec.title, content: sec.content, chapterSetCount: 3, generatedAt: new Date().toISOString(),
      }));
      setVolumes(activeProjectId, volumes);
    } else if (layerNum === 4) {
      const sets = splitSections(newContent).map((sec, i) => ({
        id: project.chapterSets?.[i]?.id ?? nanoid(), volumeId: project.volumes?.[0]?.id ?? '', index: i, title: sec.title, content: sec.content, chapterCount: 5, generatedAt: new Date().toISOString(),
      }));
      setChapterSets(activeProjectId, sets);
    } else if (layerNum === 5) {
      const plans = splitSections(newContent).map((sec, i) => ({
        id: project.chapterPlans?.[i]?.id ?? nanoid(), chapterSetId: project.chapterSets?.[0]?.id ?? '', index: i, title: sec.title, content: sec.content, plotKeywords: [], patternStructure: '', generatedAt: new Date().toISOString(),
      }));
      setChapterPlans(activeProjectId, plans);
    }
    await saveProject();
  }, [project, activeProjectId, updateProject, setPhases, setVolumes, setChapterSets, setChapterPlans, saveProject]);

  const generateHandlers = [handleGenerateOutline, handleGeneratePhases, handleGenerateVolumes, handleGenerateChapterSets, handleGenerateChapterPlans];

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        未选择项目
      </div>
    );
  }

  const currentLayer = project.currentLayer;

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* 左侧：层级树 */}
      <div className="w-64 border-r border-border overflow-y-auto p-3 shrink-0">
        <HierarchyTree
          outline={project.outline}
          phases={project.phases}
          volumes={project.volumes}
          chapterSets={project.chapterSets}
          chapterPlans={project.chapterPlans}
        />
      </div>

      {/* 右侧：逐层操作 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">

        {/* 进度条 */}
        {generatingLayer !== null && (
          <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-primary font-medium">{generationLabel}</span>
              <span className="text-xs text-primary/70">{genStream.progress}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-primary/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${genStream.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Layer 1: 需要用户输入创作想法 */}
        {currentLayer === 0 && (
          <div className="p-4 rounded-lg border border-border">
            <label className="text-sm font-medium text-foreground mb-2 block">你的创作想法</label>
            <textarea
              value={userConcept}
              onChange={(e) => setUserConcept(e.target.value)}
              placeholder="描述你想要写的故事类型、主角设定、核心冲突等..."
              className="w-full h-32 px-3 py-2 rounded-md border border-border bg-background text-sm resize-none"
            />
          </div>
        )}

        {/* 五层卡片 */}
        {LAYER_INFO.map((info, i) => {
          const layerNum = i + 1;
          const isDone = currentLayer >= layerNum;
          const isCurrent = currentLayer === layerNum - 1 || (currentLayer === 0 && layerNum === 1);
          const isThisGenerating = generatingLayer === layerNum;
          const canGen = isCurrent && !generatingLayer;

          let content: string | null = null;
          if (layerNum === 1) content = project.outline?.content ?? null;
          if (layerNum === 2) content = project.phases?.map((p) => `## ${p.title}\n${p.content}`).join('\n\n') ?? null;
          if (layerNum === 3) content = project.volumes?.map((v) => `## ${v.title}\n${v.content}`).join('\n\n') ?? null;
          if (layerNum === 4) content = project.chapterSets?.map((s) => `## ${s.title}\n${s.content}`).join('\n\n') ?? null;
          if (layerNum === 5) content = project.chapterPlans?.map((p) => `## ${p.title}\n${p.content}`).join('\n\n') ?? null;

          return (
            <LayerCard
              key={layerNum}
              layerNumber={layerNum}
              title={info.title}
              description={info.description}
              status={isDone ? 'done' : isThisGenerating ? 'generating' : 'pending'}
              content={content}
              streamContent={isThisGenerating ? genStream.displayText : ''}
              isStreaming={isThisGenerating && genStream.isStreaming}
              canGenerate={canGen}
              onGenerate={generateHandlers[i]}
              onEdit={isDone ? (newContent) => handleEditContent(layerNum, newContent) : undefined}
              onRegenWithPrompt={isCurrent || isDone ? (prompt) => handleRegenWithPrompt(layerNum, prompt) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
