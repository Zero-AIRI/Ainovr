// ============================================
// 提示词统一导出
// ============================================

// 素材库处理 — 函数
export { buildSlicingMessages } from './source-slicing';
export { buildEntityClassificationMessages } from './entity-classification';
export { buildStyleExtractionMessages, buildStyleSupplementMessages } from './style-extraction';
export { buildPlotExtractionMessages, buildPlotSupplementMessages } from './plot-extraction';
export { buildCharacterDynamicsExtractionMessages, buildCharacterDynamicsSupplementMessages } from './character-dynamics-extraction';
export { buildReaderExperienceExtractionMessages, buildReaderExperienceSupplementMessages } from './reader-experience-extraction';
export { buildNarrativeConstraintsExtractionMessages, buildNarrativeConstraintsSupplementMessages } from './narrative-constraints-extraction';
export { buildDnaCompressionMessages } from './dna-compression';
export { buildSampleSelectionMessages } from './sample-selection';

// 素材库处理 — 默认提示词
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_SLICING } from './source-slicing';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_ENTITY_CLASSIFICATION } from './entity-classification';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_STYLE, DEFAULT_SUPPLEMENT_PROMPT as DEFAULT_STYLE_SUPPLEMENT } from './style-extraction';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_PLOT, DEFAULT_SUPPLEMENT_PROMPT as DEFAULT_PLOT_SUPPLEMENT } from './plot-extraction';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_CHARACTER_DYNAMICS, DEFAULT_SUPPLEMENT_PROMPT as DEFAULT_CHARACTER_DYNAMICS_SUPPLEMENT } from './character-dynamics-extraction';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_READER_EXPERIENCE, DEFAULT_SUPPLEMENT_PROMPT as DEFAULT_READER_EXPERIENCE_SUPPLEMENT } from './reader-experience-extraction';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_NARRATIVE_CONSTRAINTS, DEFAULT_SUPPLEMENT_PROMPT as DEFAULT_NARRATIVE_CONSTRAINTS_SUPPLEMENT } from './narrative-constraints-extraction';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_DNA_COMPRESSION } from './dna-compression';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_SAMPLES } from './sample-selection';

// Layer 1: 全书大纲
export { buildOutlineGenerationMessages } from './outline-generation';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_OUTLINE } from './outline-generation';

// Layer 2: 阶段规划
export { buildPhaseFrameworkMessages } from './phase-framework';
export { buildPhaseDetailMessages } from './phase-detail';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_PHASE_FRAMEWORK } from './phase-framework';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_PHASE_DETAIL } from './phase-detail';

// Layer 3: 分卷
export { buildVolumeFrameworkMessages } from './volume-framework';
export { buildVolumeDetailMessages } from './volume-detail';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_VOLUME_FRAMEWORK } from './volume-framework';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_VOLUME_DETAIL } from './volume-detail';

// Layer 4: 章节集合
export { buildChapterSetFrameworkMessages } from './chapter-set-framework';
export { buildChapterSetDetailMessages } from './chapter-set-detail';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_CHAPTER_SET_FRAMEWORK } from './chapter-set-framework';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_CHAPTER_SET_DETAIL } from './chapter-set-detail';

// Layer 5: 每章计划
export { buildChapterPlanFrameworkMessages } from './chapter-plan-framework';
export { buildChapterPlanDetailMessages } from './chapter-plan-detail';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_CHAPTER_PLAN_FRAMEWORK } from './chapter-plan-framework';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_CHAPTER_PLAN_DETAIL } from './chapter-plan-detail';

// 章节生成 + 审查
export { buildChapterWritingMessages } from './chapter-writing';
export { buildChapterReviewMessages } from './chapter-review';
export { buildChapterRevisionMessages } from './chapter-revision';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_CHAPTER_WRITING } from './chapter-writing';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_CHAPTER_REVIEW } from './chapter-review';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_CHAPTER_REVISION } from './chapter-revision';

// 道/气 新模块
export { buildExperienceAnnotationMessages, READER_PERSONAS } from './experience-annotation';
export { buildAblationTestingMessages } from './ablation-testing';
export { buildTensionTrackingMessages } from './tension-tracking';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_EXPERIENCE_ANNOTATION } from './experience-annotation';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_ABLATION_TESTING } from './ablation-testing';
export { DEFAULT_SYSTEM_PROMPT as DEFAULT_TENSION_TRACKING } from './tension-tracking';
