// ============================================
// 五层管线视图 — 逐层生成（含 L2-L5 完整管线）
// ============================================

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
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

/** 从框架文本中解析编号列表项 */
function parseFrameworkItems(text: string): { title: string }[] {
  const items: { title: string }[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const numbered = line.match(/^\s*(\d+)\.\s*(.+)/);
    if (numbered) {
      items.push({ title: numbered[2].trim() });
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      items.push({ title: heading[1].trim() });
    }
  }
  return items;
}

/**
 * 多步生成专用 hook。
 * - 每步完成后，文本追加到 accumulated 而非覆盖
 * - 当前步的流式内容实时追加到末尾
 * - 提供 step/total 用于进度条
 */
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

  /** 追加一段已完成文本 */
  const appendDone = useCallback((text: string) => {
    setAccumulated((prev) => prev + (prev ? '\n\n' : '') + text);
  }, []);

  /** 设置进度 */
  const setProgress = useCallback((s: number, t: number) => {
    setStep(s);
    setTotal(t);
  }, []);

  /** 获取显示文本 = 已完成累积 + 当前流式内容 */
  const displayText = accumulated + (stream.streamContent ? (accumulated ? '\n\n' : '') + stream.streamContent : '');
  const progress = total > 0 ? Math.round((step / total) * 100) : 0;

  return {
    ...stream,
    displayText,
    progress,
    step,
    total,
    reset,
    appendDone,
    setProgress,
  };
}

export function LayerGenerationView({ embedded = false }: { embedded?: boolean }) {
  const { projects, activeProjectId, setActiveProjectId, setActiveView, setOutline, setPhases, setVolumes, setChapterSets, setChapterPlans, updateProject } = useProjectStore();
  const { sourceNovels } = useSourceLibraryStore();
  const { getEffectiveApiKey, model, baseURL } = useSettingsStore();

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
        if (data.project) {
          useProjectStore.getState().updateProject(activeProjectId, data.project);
        }
      })
      .catch(console.error);
  }, [activeProjectId]);

  // ── 保存当前项目到服务端 ──
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

  const getAI = useCallback(() => ({
    apiKey: getEffectiveApiKey(),
    model,
    baseURL,
  }), [getEffectiveApiKey, model, baseURL]);

  const getPlotGuide = useCallback(() =>
    projectSources.map((s) => s.plotReport).filter(Boolean).join('\n\n'),
    [projectSources]
  );

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
      styleGuide,
      plotGuide,
      userConcept: userConcept.trim(),
      ...ai,
    });

    if (result && !cancelledRef.current) {
      genStream.setProgress(1, 1);
      const outline = {
        content: result,
        generatedAt: new Date().toISOString(),
        isLocked: true,
        majorPlotFrameworkRef: '',
      };
      setOutline(project.id, outline);
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

    // Step 1: 生成阶段框架
    setGenerationLabel('阶段规划 · 生成框架');
    genStream.setProgress(0, 2);
    const framework = await genStream.startFetch('/api/generation/phase-framework', {
      outline: project.outline.content,
      plotGuide,
      ...ai,
    });
    if (!framework || cancelledRef.current) { setGeneratingLayer(null); setGenerationLabel(''); return; }

    genStream.appendDone(framework);

    // Step 2: 解析框架得到阶段列表
    const parsed = parseFrameworkItems(framework);
    if (parsed.length === 0) parsed.push({ title: '阶段一' });

    const totalSteps = parsed.length;
    genStream.setProgress(1, totalSteps);

    // Step 3: 为每个阶段生成详细内容
    const phases: Phase[] = [];
    for (let i = 0; i < parsed.length; i++) {
      if (cancelledRef.current) break;
      setGenerationLabel(`阶段规划 · 详细 ${i + 1}/${totalSteps}`);
      genStream.setProgress(i + 1, totalSteps);
      const detail = await genStream.startFetch('/api/generation/phase-detail', {
        outline: project.outline.content,
        phaseFramework: framework,
        phaseIndex: i,
        plotGuide,
        ...ai,
      });
      if (detail) genStream.appendDone(`## ${parsed[i].title}\n${detail}`);
      phases.push({
        id: nanoid(),
        index: i,
        title: parsed[i].title,
        content: detail ?? '',
        volumeCount: 2,
        generatedAt: new Date().toISOString(),
      });
    }

    if (phases.length > 0 && !cancelledRef.current) {
      setPhases(project.id, phases);
      await saveProject();
    }
    setGeneratingLayer(null);
    setGenerationLabel('');
  }, [project, getAI, getPlotGuide, genStream, setPhases, saveProject]);

  // ── L3: 生成分卷 ──
  const handleGenerateVolumes = useCallback(async () => {
    if (!project?.outline || !project.phases) return;
    setGeneratingLayer(3);
    setGenerationLabel('分卷规划');
    cancelledRef.current = false;
    genStream.reset();
    const ai = getAI();
    const plotGuide = getPlotGuide();

    const totalPhases = project.phases.length;
    const allVolumes: Volume[] = [];
    let stepCount = 0;
    const estimatedTotal = totalPhases * 2; // framework + 1 detail per phase (approx)

    for (let pi = 0; pi < totalPhases; pi++) {
      const phase = project.phases[pi];
      if (cancelledRef.current) break;

      setGenerationLabel(`分卷 · ${phase.title} · 框架`);
      stepCount++;
      genStream.setProgress(stepCount, estimatedTotal);

      const volFramework = await genStream.startFetch('/api/generation/volume-framework', {
        outline: project.outline!.content,
        phaseContent: `${phase.title}\n${phase.content}`,
        minorPlotPatterns: plotGuide,
        ...ai,
      });
      if (!volFramework || cancelledRef.current) continue;

      genStream.appendDone(`### ${phase.title} — 分卷框架\n${volFramework}`);

      const parsed = parseFrameworkItems(volFramework);
      if (parsed.length === 0) parsed.push({ title: `${phase.title} · 卷一` });

      for (let i = 0; i < parsed.length; i++) {
        if (cancelledRef.current) break;
        setGenerationLabel(`分卷 · ${parsed[i].title}`);
        stepCount++;
        genStream.setProgress(stepCount, estimatedTotal + parsed.length - 1);

        const detail = await genStream.startFetch('/api/generation/volume-detail', {
          outline: project.outline!.content,
          phaseContent: `${phase.title}\n${phase.content}`,
          volumeFramework: volFramework,
          volumeIndex: i,
          minorPlotPatterns: plotGuide,
          ...ai,
        });
        if (detail) genStream.appendDone(`## ${parsed[i].title}\n${detail}`);
        allVolumes.push({
          id: nanoid(),
          phaseId: phase.id,
          index: i,
          title: parsed[i].title,
          content: detail ?? '',
          chapterSetCount: 3,
          generatedAt: new Date().toISOString(),
        });
      }
    }

    if (allVolumes.length > 0 && !cancelledRef.current) {
      setVolumes(project.id, allVolumes);
      await saveProject();
    }
    setGeneratingLayer(null);
    setGenerationLabel('');
  }, [project, getAI, getPlotGuide, genStream, setVolumes, saveProject]);

  // ── L4: 生成章节集合 ──
  const handleGenerateChapterSets = useCallback(async () => {
    if (!project?.volumes) return;
    setGeneratingLayer(4);
    setGenerationLabel('章节集合');
    cancelledRef.current = false;
    genStream.reset();
    const ai = getAI();
    const plotGuide = getPlotGuide();

    const allSets: ChapterSet[] = [];
    let stepCount = 0;
    const estimatedTotal = project.volumes.length * 2;

    for (const volume of project.volumes) {
      if (cancelledRef.current) break;

      setGenerationLabel(`章节集合 · ${volume.title} · 框架`);
      stepCount++;
      genStream.setProgress(stepCount, estimatedTotal);

      const setFramework = await genStream.startFetch('/api/generation/chapter-set-framework', {
        volumeContent: `${volume.title}\n${volume.content}`,
        minorPlotPatterns: plotGuide,
        ...ai,
      });
      if (!setFramework || cancelledRef.current) continue;

      genStream.appendDone(`### ${volume.title} — 集合框架\n${setFramework}`);

      const parsed = parseFrameworkItems(setFramework);
      if (parsed.length === 0) parsed.push({ title: `${volume.title} · 集合一` });

      for (let i = 0; i < parsed.length; i++) {
        if (cancelledRef.current) break;
        setGenerationLabel(`章节集合 · ${parsed[i].title}`);
        stepCount++;
        genStream.setProgress(stepCount, estimatedTotal + parsed.length - 1);

        const detail = await genStream.startFetch('/api/generation/chapter-set-detail', {
          volumeContent: `${volume.title}\n${volume.content}`,
          setFramework,
          setIndex: i,
          minorPlotPatterns: plotGuide,
          ...ai,
        });
        if (detail) genStream.appendDone(`## ${parsed[i].title}\n${detail}`);
        allSets.push({
          id: nanoid(),
          volumeId: volume.id,
          index: i,
          title: parsed[i].title,
          content: detail ?? '',
          chapterCount: 5,
          generatedAt: new Date().toISOString(),
        });
      }
    }

    if (allSets.length > 0 && !cancelledRef.current) {
      setChapterSets(project.id, allSets);
      await saveProject();
    }
    setGeneratingLayer(null);
    setGenerationLabel('');
  }, [project, getAI, getPlotGuide, genStream, setChapterSets, saveProject]);

  // ── L5: 生成每章计划 ──
  const handleGenerateChapterPlans = useCallback(async () => {
    if (!project?.chapterSets) return;
    setGeneratingLayer(5);
    setGenerationLabel('每章计划');
    cancelledRef.current = false;
    genStream.reset();
    const ai = getAI();
    const plotGuide = getPlotGuide();

    const allPlans: ChapterPlan[] = [];
    let stepCount = 0;
    const estimatedTotal = project.chapterSets.length * 2;

    for (const set of project.chapterSets) {
      if (cancelledRef.current) break;

      setGenerationLabel(`章节计划 · ${set.title} · 框架`);
      stepCount++;
      genStream.setProgress(stepCount, estimatedTotal);

      const planFramework = await genStream.startFetch('/api/generation/chapter-plan-framework', {
        setContent: `${set.title}\n${set.content}`,
        minorPlotPatterns: plotGuide,
        ...ai,
      });
      if (!planFramework || cancelledRef.current) continue;

      genStream.appendDone(`### ${set.title} — 计划框架\n${planFramework}`);

      const parsed = parseFrameworkItems(planFramework);
      if (parsed.length === 0) parsed.push({ title: `${set.title} · 第一章` });

      for (let i = 0; i < parsed.length; i++) {
        if (cancelledRef.current) break;
        setGenerationLabel(`章节计划 · ${parsed[i].title}`);
        stepCount++;
        genStream.setProgress(stepCount, estimatedTotal + parsed.length - 1);

        const detail = await genStream.startFetch('/api/generation/chapter-plan-detail', {
          setContent: `${set.title}\n${set.content}`,
          planFramework,
          chapterIndex: i,
          minorPlotPatterns: plotGuide,
          ...ai,
        });
        if (detail) genStream.appendDone(`## ${parsed[i].title}\n${detail}`);
        allPlans.push({
          id: nanoid(),
          chapterSetId: set.id,
          index: i,
          title: parsed[i].title,
          content: detail ?? '',
          plotKeywords: [],
          patternStructure: '',
          generatedAt: new Date().toISOString(),
        });
      }
    }

    if (allPlans.length > 0 && !cancelledRef.current) {
      setChapterPlans(project.id, allPlans);
      await saveProject();
    }
    setGeneratingLayer(null);
    setGenerationLabel('');
  }, [project, getAI, getPlotGuide, genStream, setChapterPlans, saveProject]);

  // ── 重新生成（带自定义提示词）─ callback ──
  const handleRegenWithPrompt = useCallback(async (layerNum: number, customPrompt: string) => {
    if (!project) return;
    // 将自定义提示词作为额外上下文注入，走正常生成流程
    // 通过临时覆盖 userConcept 触发
    if (layerNum === 1) {
      setUserConcept(customPrompt);
      // 在下一帧执行，确保 state 已更新
      setTimeout(() => handleGenerateOutline(), 0);
    } else {
      // L2+ 的重新规划：先清除该层数据再重新生成
      const layerSetter: Record<number, () => void> = {
        2: () => setPhases(project.id, null as unknown as Phase[]),
        3: () => setVolumes(project.id, null as unknown as Volume[]),
        4: () => setChapterSets(project.id, null as unknown as ChapterSet[]),
        5: () => setChapterPlans(project.id, null as unknown as ChapterPlan[]),
      };
      // 将 customPrompt 临时存到项目备注中供 API 使用（简化处理：直接重新生成）
      layerSetter[layerNum]?.();
      await saveProject();
      // 重新加载后再生成
      const handlers: Record<number, () => void> = {
        2: handleGeneratePhases,
        3: handleGenerateVolumes,
        4: handleGenerateChapterSets,
        5: handleGenerateChapterPlans,
      };
      handlers[layerNum]?.();
    }
  }, [project, handleGenerateOutline, handleGeneratePhases, handleGenerateVolumes, handleGenerateChapterSets, handleGenerateChapterPlans, setPhases, setVolumes, setChapterSets, setChapterPlans, saveProject]);

  // ── 手动编辑某层内容 ──
  const handleEditContent = useCallback(async (layerNum: number, newContent: string) => {
    if (!project || !activeProjectId) return;
    if (layerNum === 1 && project.outline) {
      updateProject(activeProjectId, { outline: { ...project.outline, content: newContent } });
    } else if (layerNum === 2) {
      // 按章节标题重新解析编辑后的文本
      const sections = newContent.split(/^## /m).filter(Boolean);
      const phases: Phase[] = sections.map((sec, i) => {
        const lines = sec.split('\n');
        const title = lines[0].trim();
        const content = lines.slice(1).join('\n').trim();
        return { id: project.phases?.[i]?.id ?? nanoid(), index: i, title, content, volumeCount: 2, generatedAt: new Date().toISOString() };
      });
      setPhases(activeProjectId, phases);
    } else if (layerNum === 3) {
      const sections = newContent.split(/^## /m).filter(Boolean);
      const volumes: Volume[] = sections.map((sec, i) => {
        const lines = sec.split('\n');
        const title = lines[0].trim();
        const content = lines.slice(1).join('\n').trim();
        const phaseId = project.phases?.[0]?.id ?? '';
        return { id: project.volumes?.[i]?.id ?? nanoid(), phaseId, index: i, title, content, chapterSetCount: 3, generatedAt: new Date().toISOString() };
      });
      setVolumes(activeProjectId, volumes);
    } else if (layerNum === 4) {
      const sections = newContent.split(/^## /m).filter(Boolean);
      const sets: ChapterSet[] = sections.map((sec, i) => {
        const lines = sec.split('\n');
        const title = lines[0].trim();
        const content = lines.slice(1).join('\n').trim();
        const volumeId = project.volumes?.[0]?.id ?? '';
        return { id: project.chapterSets?.[i]?.id ?? nanoid(), volumeId, index: i, title, content, chapterCount: 5, generatedAt: new Date().toISOString() };
      });
      setChapterSets(activeProjectId, sets);
    } else if (layerNum === 5) {
      const sections = newContent.split(/^## /m).filter(Boolean);
      const plans: ChapterPlan[] = sections.map((sec, i) => {
        const lines = sec.split('\n');
        const title = lines[0].trim();
        const content = lines.slice(1).join('\n').trim();
        const chapterSetId = project.chapterSets?.[0]?.id ?? '';
        return { id: project.chapterPlans?.[i]?.id ?? nanoid(), chapterSetId, index: i, title, content, plotKeywords: [], patternStructure: '', generatedAt: new Date().toISOString() };
      });
      setChapterPlans(activeProjectId, plans);
    }
    await saveProject();
  }, [project, activeProjectId, updateProject, setPhases, setVolumes, setChapterSets, setChapterPlans, saveProject]);

  const generateHandlers = [
    handleGenerateOutline,
    handleGeneratePhases,
    handleGenerateVolumes,
    handleGenerateChapterSets,
    handleGenerateChapterPlans,
  ];

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
        {!embedded && (
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">层级结构</h3>
        )}
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
        {!embedded && (
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => { setActiveProjectId(null); setActiveView('writing-project'); }}
              className="p-1.5 rounded hover:bg-accent transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-xl font-bold text-foreground">{project.title}</h1>
            <span className="text-xs text-muted-foreground">层级 {currentLayer}/5</span>
          </div>
        )}

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
