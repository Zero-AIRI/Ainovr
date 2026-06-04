// ============================================
// 提示词统一导出
// ============================================

// 素材库处理
export { buildSlicingMessages } from './source-slicing';
export { buildStyleExtractionMessages, buildStyleSupplementMessages } from './style-extraction';
export { buildPlotExtractionMessages, buildPlotSupplementMessages } from './plot-extraction';
export { buildSampleSelectionMessages } from './sample-selection';

// Layer 1: 全书大纲
export { buildOutlineGenerationMessages } from './outline-generation';

// Layer 2: 阶段规划
export { buildPhaseFrameworkMessages } from './phase-framework';
export { buildPhaseDetailMessages } from './phase-detail';

// Layer 3: 分卷
export { buildVolumeFrameworkMessages } from './volume-framework';
export { buildVolumeDetailMessages } from './volume-detail';

// Layer 4: 章节集合
export { buildChapterSetFrameworkMessages } from './chapter-set-framework';
export { buildChapterSetDetailMessages } from './chapter-set-detail';

// Layer 5: 每章计划
export { buildChapterPlanFrameworkMessages } from './chapter-plan-framework';
export { buildChapterPlanDetailMessages } from './chapter-plan-detail';

// 章节生成 + 审查
export { buildChapterWritingMessages } from './chapter-writing';
export { buildChapterReviewMessages } from './chapter-review';
export { buildChapterRevisionMessages } from './chapter-revision';
