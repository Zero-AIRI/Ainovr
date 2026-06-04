// ============================================
// 五层管线视图 — 逐层生成
// ============================================

'use client';

import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useSettingsStore } from '@/lib/store/settings';
import { useStreamingFetch } from '@/lib/hooks/use-streaming-fetch';
import { LayerCard } from './LayerCard';
import { HierarchyTree } from './HierarchyTree';

const LAYER_INFO = [
  { title: '全书大纲', description: '基于大情节框架和创作想法，约200字，确定后不可变' },
  { title: '阶段规划', description: '4-6个阶段，每阶段约500字，分配节奏和伏笔' },
  { title: '分卷', description: '每阶段1-2卷，每卷约300字，匹配小情节模式' },
  { title: '章节集合', description: '每卷3-5个集合，每个约200字，安排小情节出场' },
  { title: '每章计划', description: '每章约100字，场景节拍+关键词+伏笔操作' },
];

export function LayerGenerationView() {
  const { projects, activeProjectId, setActiveProjectId, setActiveView, setOutline, setPhases, setVolumes, setChapterSets, setChapterPlans } = useProjectStore();
  const { sourceNovels } = useSourceLibraryStore();
  const { getEffectiveApiKey, model, baseURL, maxContextTokens } = useSettingsStore();

  const project = projects.find((p) => p.id === activeProjectId);
  const projectSources = sourceNovels.filter((s) => project?.sourceNovelIds.includes(s.id));

  const outlineStream = useStreamingFetch();
  const [userConcept, setUserConcept] = useState('');

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

  const handleGenerateOutline = useCallback(async () => {
    if (!project || !userConcept.trim()) return;

    const ai = { apiKey: getEffectiveApiKey(), model, baseURL };
    const styleGuide = projectSources.map((s) => s.styleProfile).filter(Boolean).join('\n\n');
    const plotGuide = projectSources.map((s) => s.plotReport).filter(Boolean).join('\n\n');

    const result = await outlineStream.startFetch('/api/generation/outline', {
      styleGuide,
      plotGuide,
      userConcept: userConcept.trim(),
      apiKey: ai.apiKey,
      model: ai.model,
      baseURL: ai.baseURL,
    });

    if (result) {
      const outline = {
        content: result,
        generatedAt: new Date().toISOString(),
        isLocked: true,
        majorPlotFrameworkRef: '',
      };
      setOutline(project.id, outline);

      // 保存到服务端
      const updated = { ...useProjectStore.getState().projects.find((p) => p.id === project.id)!, outline };
      await fetch('/api/project/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
    }
  }, [project, projectSources, userConcept, getEffectiveApiKey, model, baseURL, outlineStream, setOutline]);

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        未选择项目
      </div>
    );
  }

  const currentLayer = project.currentLayer;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧：层级树 */}
      <div className="w-64 border-r border-border overflow-y-auto p-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">层级结构</h3>
        <HierarchyTree
          outline={project.outline}
          phases={project.phases}
          volumes={project.volumes}
          chapterSets={project.chapterSets}
          chapterPlans={project.chapterPlans}
        />
      </div>

      {/* 右侧：逐层操作 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
          const canGen = isCurrent && (layerNum === 1 ? !!userConcept.trim() : true);
          const streamContent = layerNum === 1 ? outlineStream.streamContent : '';

          let content: string | null = null;
          if (layerNum === 1) content = project.outline?.content ?? null;
          if (layerNum === 2) content = project.phases?.map((p) => p.content).join('\n\n') ?? null;
          if (layerNum === 3) content = project.volumes?.map((v) => v.content).join('\n\n') ?? null;
          if (layerNum === 4) content = project.chapterSets?.map((s) => s.content).join('\n\n') ?? null;
          if (layerNum === 5) content = project.chapterPlans?.map((p) => p.content).join('\n\n') ?? null;

          return (
            <LayerCard
              key={layerNum}
              layerNumber={layerNum}
              title={info.title}
              description={info.description}
              status={isDone ? 'done' : streamContent ? 'generating' : 'pending'}
              content={content}
              streamContent={streamContent}
              isStreaming={layerNum === 1 && outlineStream.isStreaming}
              canGenerate={canGen}
              onGenerate={layerNum === 1 ? handleGenerateOutline : () => {}}
            />
          );
        })}
      </div>
    </div>
  );
}
