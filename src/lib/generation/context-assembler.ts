// ============================================
// 上下文组装器 — 为每层生成组装输入
// v2: 支持新六层 DNA（道/气/骨/肉/势能）
// ============================================

import type { GenerationLayer, SourceNovel, WritingProject, NovelDNA, NovelDao, NovelQi } from '@/types';

// ---- 层级上下文截断常量（近似 token 预算） ----

/** Layer 1 道/气上下文最大字符数（大纲层只需核心信息） */
const DAO_CONTEXT_MAX_CHARS_L1 = 300;
/** Layer 2 节奏处方截断字符数 */
const RHYTHM_MAX_CHARS_L2 = 300;
/** Layer < 3 风格引擎摘要截断字符数 */
const STYLE_SUMMARY_MAX_CHARS_EARLY = 500;
/** 前一章末尾衔接字符数（硬核衔接轨） */
const PREV_CHAPTER_TAIL_CHARS = 1200;
/** 前情提要每章取头/尾字符数 */
const RECENT_CHAPTER_PREVIEW_CHARS = 200;
/** 前情提要回看章数 */
const RECENT_CHAPTER_LOOKBACK = 5;

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
  // ── v2 新增字段 ──
  /** 道/气上下文（从新 DNA 提取） */
  daoContext: string;
  /** 节奏处方（从势能分析和消融测试提取） */
  rhythmPrescription: string;
  /** 风格引擎摘要（精简版文风指导） */
  styleEngineSummary: string;
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
 * 从新 DNA 构建道/气上下文
 */
function buildDaoContext(allNovels: SourceNovel[]): string {
  const dnaV2s = allNovels
    .map((n) => n.novelDnaV2)
    .filter((d): d is NovelDNA => d !== null);

  if (dnaV2s.length === 0) return '';

  const parts: string[] = [];

  for (const dna of dnaV2s) {
    const dao = dna.dao;
    const qi = dna.qi;

    parts.push(`### 核心吸引力（道）\n- 主情绪场：${dao.primaryEmotionalField}\n- 读者为何停留：${dao.whyReadersStay}\n- AI 置信度：${Math.round(dao.confidence * 100)}%${dao.userConfirmed ? ' ✅ 已确认' : ' ⚠️ 待确认'}`);

    parts.push(`### 阅读状态维持（气）\n- 维持方法：${qi.maintenanceMethods.join('；')}\n- 呼吸周期：${qi.breathingCycleDescription}\n- 破坏因素：${qi.disruptors.join('；')}`);

    if (qi.rhythmProfile) {
      const rp = qi.rhythmProfile;
      parts.push(`### 节奏画像\n- 推进 ${Math.round(rp.propulsionRatio * 100)}% | 蓄力 ${Math.round(rp.buildupRatio * 100)}% | 释放 ${Math.round(rp.releaseRatio * 100)}%\n- 呼吸 ${Math.round(rp.breathRatio * 100)}% | 存在 ${Math.round(rp.existenceRatio * 100)}% | 校准 ${Math.round(rp.calibrationRatio * 100)}%`);
    }
  }

  return parts.join('\n\n');
}

/**
 * 从势能分析和消融测试构建节奏处方
 */
function buildRhythmPrescription(allNovels: SourceNovel[]): string {
  const dnaV2s = allNovels
    .map((n) => n.novelDnaV2)
    .filter((d): d is NovelDNA => d !== null);

  if (dnaV2s.length === 0) return '';

  const parts: string[] = [];
  parts.push('## 节奏处方（从源小说提取）\n');

  for (const dna of dnaV2s) {
    // 势能模式
    const patterns = dna.engines.tensionPatterns;
    if (patterns.length > 0) {
      const avgDuration = Math.round(patterns.reduce((s, p) => s + p.duration, 0) / patterns.length);
      parts.push(`- 平均势能积累周期：约 ${avgDuration} 个场景\n`);
      parts.push(`- 势能模式类型：${[...new Set(patterns.map((p) => p.climaxType))].join('、')}\n`);

      const highPayoff = patterns.filter((p) => p.payoffMultiplier === 'high' || p.payoffMultiplier === 'extreme');
      if (highPayoff.length > 0) {
        parts.push(`- ⚡ 高回报释放点：${highPayoff.length} 个（需充分积累后才释放）\n`);
      }
    }

    // 结构比例
    const structure = dna.structure;
    parts.push(`- 核心骨架段落：${structure.bones.length} 个 → **不可省略**\n`);
    parts.push(`- 增强体验段落：${structure.muscles.length} 个 → 可调整但会影响体验\n`);

    if (structure.fillerTypeA.length > 0) {
      parts.push(`- 🌬️ 体验填充段落：${structure.fillerTypeA.length} 个 → 维持"气"的关键，生成时需保留对应比例的呼吸段落\n`);
    }

    if (structure.fillerTypeB.length > 0) {
      parts.push(`- ⚠️ 机械填充段落：${structure.fillerTypeB.length} 个 → 模仿时替换为有意义的呼吸内容\n`);
    }

    // 失败模式
    const risks = dna.failureModes.risks;
    if (risks.length > 0) {
      parts.push('\n### 避坑指南\n');
      for (const risk of risks) {
        parts.push(`- **${risk.description}** → ${risk.mitigation}\n`);
      }
    }
  }

  return parts.join('');
}

/**
 * 组装层级上下文（v2：支持新 DNA）
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

  // 拼接文风档案（优先用新 DNA 的风格引擎摘要）
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

  // 道/气上下文（所有层共享，但 L1 用精简版）
  const allSources = [...styleSources, ...plotSources].filter(
    (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i
  );
  const daoContext = buildDaoContext(allSources);
  const rhythmPrescription = buildRhythmPrescription(allSources);

  // 风格引擎摘要
  const styleEngineSummary = allSources
    .map((s) => s.novelDnaV2?.styleEngine.rawStyleProfile)
    .filter(Boolean)
    .join('\n\n---\n\n');

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

  // ═══ 前情提要修复：从"前5章前300字"改为"前一章末尾1200字 + 状态增量" ═══
  if (project.chapters.length > 0) {
    // 前一章的末尾 1200 字（硬核衔接轨）
    const lastChapter = project.chapters[project.chapters.length - 1];
    const lastChapterEnd = lastChapter.content.slice(-PREV_CHAPTER_TAIL_CHARS);
    previousState = `## 前一章末尾（无缝衔接）\n\n${lastChapterEnd}\n\n`;

    // 状态增量轨：前 5 章的关键事件摘要
    const recentChapters = project.chapters.slice(-RECENT_CHAPTER_LOOKBACK);
    if (recentChapters.length > 1) {
      previousState += `## 前情提要（最近${recentChapters.length}章关键事件）\n\n`;
      for (const ch of recentChapters.slice(0, -1)) { // 排除最后一章（已传末尾）
        const preview = ch.content.slice(0, RECENT_CHAPTER_PREVIEW_CHARS);
        const tail = ch.content.slice(-RECENT_CHAPTER_PREVIEW_CHARS);
        previousState += `- ${preview.replace(/\n/g, ' ')}...${tail.replace(/\n/g, ' ')}\n`;
      }
    }
  }

  // 按层级组装最终的上下文
  const layerContext = (() => {
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
  })();

  // L1 用精简版道/气上下文
  const daoForLayer = layer === 1
    ? daoContext.slice(0, DAO_CONTEXT_MAX_CHARS_L1)
    : daoContext;

  // L5 获得完整的节奏处方
  const rhythmForLayer = layer >= 4
    ? rhythmPrescription
    : (layer >= 2 ? rhythmPrescription.slice(0, RHYTHM_MAX_CHARS_L2) : '');

  return {
    ...layerContext,
    daoContext: daoForLayer,
    rhythmPrescription: rhythmForLayer,
    styleEngineSummary: layer >= 3 ? styleEngineSummary : styleEngineSummary.slice(0, STYLE_SUMMARY_MAX_CHARS_EARLY),
  };
}
