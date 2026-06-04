// ============================================
// 上下文组装器 — 为每层生成组装输入
// ============================================

import type { GenerationLayer, SourceNovel, WritingProject } from '@/types';

export interface LayerContext {
  /** 文风档案（role='style' 的源小说拼接） */
  styleGuide: string;
  /** 情节报告（role='plot' 的源小说拼接） */
  plotGuide: string;
  /** 当前层以上的层级内容 */
  hierarchyContext: string;
  /** 当前层的具体任务（仅 Layer 5） */
  chapterTask: string;
  /** 已生成的前文状态 */
  previousState: string;
}

/**
 * 从情节报告中提取大情节框架部分
 */
function extractMajorPlot(plotReport: string): string {
  const match = plotReport.match(/## 一、大情节框架[\s\S]*?(?=## 二、|$)/);
  return match ? match[0].trim() : plotReport;
}

/**
 * 从情节报告中提取小情节模式库
 */
function extractMinorPlots(plotReport: string): string {
  const match = plotReport.match(/## 二、小情节模式库[\s\S]*?(?=## 三、|$)/);
  return match ? match[0].trim() : '';
}

/**
 * 从情节报告中提取节奏和伏笔规则
 */
function extractPacingAndForeshadow(plotReport: string): string {
  const pacing = plotReport.match(/## 四、节奏规律[\s\S]*?(?=$)/);
  const foreshadow = plotReport.match(/## 三、伏笔手法[\s\S]*?(?=## 四、|$)/);
  return [foreshadow?.[0]?.trim(), pacing?.[0]?.trim()].filter(Boolean).join('\n\n');
}

/**
 * 组装层级上下文
 */
export function assembleLayerContext(
  layer: GenerationLayer,
  sourceNovels: SourceNovel[],
  project: WritingProject,
  chapterPlanId?: string,
): LayerContext {
  // 按角色分类源小说
  const styleSources = sourceNovels.filter((s) =>
    project.sourceRoles.some((r) => r.sourceNovelId === s.id && (r.role === 'style' || r.role === 'style_and_plot'))
  );
  const plotSources = sourceNovels.filter((s) =>
    project.sourceRoles.some((r) => r.sourceNovelId === s.id && (r.role === 'plot' || r.role === 'style_and_plot'))
  );

  // 拼接文风档案
  const styleGuide = styleSources
    .map((s) => s.styleProfile)
    .filter(Boolean)
    .join('\n\n---\n\n');

  // 拼接情节报告
  const plotGuide = plotSources
    .map((s) => s.plotReport)
    .filter(Boolean)
    .join('\n\n---\n\n');

  // 根据层级提取情节报告的不同部分
  const majorPlot = extractMajorPlot(plotGuide);
  const minorPlots = extractMinorPlots(plotGuide);
  const pacingRules = extractPacingAndForeshadow(plotGuide);

  // 层级上下文（当前层以上的内容）
  let hierarchyContext = '';
  let chapterTask = '';
  let previousState = '';

  if (layer >= 1 && project.outline) {
    hierarchyContext += `## 全书大纲\n\n${project.outline.content}\n\n`;
  }

  if (layer >= 2 && project.phases) {
    hierarchyContext += `## 阶段规划\n\n${project.phases.map((p) => `### ${p.title}\n${p.content}`).join('\n\n')}\n\n`;
  }

  if (layer >= 3 && project.volumes) {
    hierarchyContext += `## 分卷\n\n${project.volumes.map((v) => `### ${v.title}\n${v.content}`).join('\n\n')}\n\n`;
  }

  if (layer >= 4 && project.chapterSets) {
    hierarchyContext += `## 章节集合\n\n${project.chapterSets.map((s) => `### ${s.title}\n${s.content}`).join('\n\n')}\n\n`;
  }

  if (layer === 5 && project.chapterPlans && chapterPlanId) {
    const plan = project.chapterPlans.find((p) => p.id === chapterPlanId);
    if (plan) {
      chapterTask = `## 本章计划\n\n${plan.content}\n\n关键词: ${plan.plotKeywords.join(', ')}\n小情节模式: ${plan.patternStructure}`;
    }
  }

  // 前文状态（最近 5 章摘要）
  if (project.chapters.length > 0) {
    const recentChapters = project.chapters.slice(-5);
    previousState = `## 前情提要（最近 ${recentChapters.length} 章）\n\n${recentChapters.map((c) => c.content.slice(0, 300) + '...').join('\n\n---\n\n')}`;
  }

  // 按层级组装最终的上下文
  switch (layer) {
    case 1:
      return { styleGuide, plotGuide: majorPlot, hierarchyContext: '', chapterTask: '', previousState: '' };
    case 2:
      return { styleGuide, plotGuide: pacingRules, hierarchyContext, chapterTask: '', previousState: '' };
    case 3:
      return { styleGuide, plotGuide: minorPlots, hierarchyContext, chapterTask: '', previousState: '' };
    case 4:
      return { styleGuide, plotGuide: minorPlots, hierarchyContext, chapterTask: '', previousState: '' };
    case 5:
      return { styleGuide, plotGuide: minorPlots, hierarchyContext, chapterTask, previousState };
    default:
      return { styleGuide, plotGuide, hierarchyContext, chapterTask, previousState };
  }
}
