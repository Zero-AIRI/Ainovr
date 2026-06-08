// ============================================
// AI 仿写小说系统 — 核心类型定义
// ============================================

// ---- 文本清洗相关 ----

/** 清洗步骤 ID（对应 text-cleaner.ts 的 10 个步骤） */
export type CleaningStepId =
  | 'encoding'       // Step 1: 编码清理
  | 'urls'           // Step 2: URL 行
  | 'promos'         // Step 3: 广告推广
  | 'authorNotes'    // Step 4: 作者碎碎念
  | 'watermarks'     // Step 5: 水印/来源
  | 'nav'            // Step 6: 导航行
  | 'separators'     // Step 7: 分隔线
  | 'toc'            // Step 8: 目录块
  | 'punctuation'    // Step 9: 标点规范化
  | 'blankLines';    // Step 10: 空行整理

/** 清洗预设方案 */
export type CleaningPreset = 'aggressive' | 'standard' | 'light' | 'none';

/** 清洗配置 */
export interface CleaningConfig {
  preset: CleaningPreset;
  /** 仅 preset='none' 时生效，手动选择启用的步骤 */
  enabledSteps: CleaningStepId[];
}

// ---- 分块相关（上传阶段，保留兼容） ----

/** 小说分块 */
export interface NovelChunk {
  id: string;          // nanoid
  novelId: string;     // 所属小说 ID
  index: number;       // 在小说中的顺序（从 0 开始）
  title: string;       // 章节标题（如"第一章 陨落的天才"或"第3部分"）
  content: string;     // 块文本内容
  charCount: number;   // content.length
}

/** 导入管道配置（保留用于兼容） */
export interface ImportConfig {
  cleaning: CleaningConfig;
  maxChunkSize: number;
}

/** 仿写篇幅选项（旧版兼容，Phase 7 后移除） */
export type WriteLength = 'fragment' | 'chapter' | 'short';

/** 已上传的参考小说（上传阶段类型，保留兼容） */
export interface ParsedNovel {
  id: string;
  title: string;
  totalChars: number;
  fullText: string;
  chunks: NovelChunk[];
  rawText: string | null;
  importConfig: ImportConfig | null;
}

// ========================================
// 素材库（Source Library）
// ========================================

// ---- Novel Memory System（Step -1 产出）----

/** 实体类型 */
export type EntityType = 'character' | 'location' | 'organization' | 'artifact' | 'concept';

/** 实体索引条目（Step -1A 产出） */
export interface EntityEntry {
  type: EntityType;
  aliases: string[];
  frequency: number;
  occurrences: string[];  // 出现的 slice IDs
  segments: string[];     // 出现的 segment IDs
}

/** 实体索引 */
export type EntityIndex = Record<string, EntityEntry>;

/** 叙事段（Step -1B 产出） */
export interface NarrativeSegment {
  id: string;               // e.g. "segment_1"
  label: string;            // e.g. "廷根探索"
  startSlice: number;
  endSlice: number;
  startChapter: string;
  endChapter: string;
  charCount: number;
  primaryDriver: string;
  primaryMysteries: string[];
  primaryCharacters: string[];
  worldState: string;
  emotionBaseline: string;
  transitionReason: string | null;
}

/** 图节点 */
export interface GraphNode {
  id: string;
  type: string;
  frequency: number;
  segments: string[];
}

/** 图边 */
export interface GraphEdge {
  source: string;
  target: string;
  type: string;               // causes / reveals / parallels / contradicts / depends_on / co_occurrence
  coOccurrenceCount?: number;
  segments?: string[];
  evidence?: string;
}

/** 记忆图谱 */
export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Novel Memory 整体（Step -1 全部产出） */
export interface NovelMemory {
  entityIndex: EntityIndex | null;
  segments: NarrativeSegment[] | null;
  characterGraph: MemoryGraph | null;
  mysteryGraph: MemoryGraph | null;
  eventGraph: MemoryGraph | null;
}

/** 源小说处理状态 */
export type SourceNovelStatus =
  | 'raw'                // 已上传，未处理
  | 'indexing'           // Step -1A: 程序索引中
  | 'segmenting'         // Step -1B: 叙事分段中
  | 'slicing'            // Step 0: 智能切片中
  | 'extracting'         // Step 1+2: 文风+叙事动力学提取中
  | 'character_dynamics' // Step 2.5: 角色动力学分析中
  | 'deep_analyzing'     // Step 3+4: 读者体验+叙事约束分析中
  | 'selecting'          // Step 5: 代表性切片选取中
  | 'evolution_modeling' // Step 6.5: 演化建模中
  | 'compressing'        // Step 7: DNA+Genome 压缩中
  | 'ready'              // 全部处理完成，可被项目引用
  | 'error';             // 处理出错

/** AI 智能切片（增强版，含 Memory Graph 引用） */
export interface SemanticSlice {
  id: string;
  index: number;
  title: string;           // e.g. "001_开场_废柴处境"
  content: string;
  charCount: number;
  semanticTags: string[];  // e.g. ["战斗", "修炼", "转折"]
  plotArc: string;         // 所属情节弧线
  emotionalTone: string;   // e.g. "紧张", "温馨"

  // 增强字段（从 Novel Memory 填充）
  segmentId: string;              // 属于哪个 NarrativeSegment
  volume: string | null;          // 属于哪一卷
  chapterRange: string;           // 章节范围 e.g. "第1章-第12章"
  characterRefs: string[];        // 出现的角色名（引用 entity_index）
  narrativeFunction: string;      // setup / escalation / climax / cooldown / resolution
  tensionLevel: number;           // 0-10
  dependencies: string[];         // 依赖的其他切片 IDs
}

/** 代表性切片样本（3-5 个） */
export interface RepresentativeSample {
  sliceId: string;
  sliceIndex: number;
  title: string;
  content: string;
  selectionReason: string; // 选取理由（如"典型战斗场景"）
}

/** 素材库中的源小说 */
export interface SourceNovel {
  id: string;
  title: string;
  totalChars: number;
  importConfig: ImportConfig | null;
  status: SourceNovelStatus;
  createdAt: string;
  processedAt: string | null;

  // Novel Memory（Step -1 产出）
  memory: NovelMemory | null;

  // 处理产出（null 表示尚未处理到该步）
  slices: SemanticSlice[] | null;                      // Step 0: 增强切片
  styleProfile: string | null;                         // Step 1: 文风画像
  plotReport: string | null;                           // Step 2: 叙事动力学
  characterDynamics: string | null;                    // Step 2.5: 角色动力学
  readerExperience: string | null;                     // Step 3: 读者体验
  narrativeConstraints: string | null;                 // Step 4: 叙事约束
  representativeSamples: RepresentativeSample[] | null; // Step 5: 样本
  evolutionModel: string | null;                       // Step 6.5: 演化模型 JSON
  novelDna: string | null;                             // Step 7: DNA 超压缩 YAML
  novelGenome: string | null;                          // Step 7: Genome 完整基因库 YAML
}

// ========================================
// 写作项目（Writing Project）
// ========================================

/** 源小说在项目中的角色 */
export interface SourceRole {
  sourceNovelId: string;
  role: 'style' | 'plot' | 'style_and_plot';
}

/** 管线层级枚举 */
export type GenerationLayer = 0 | 1 | 2 | 3 | 4 | 5;

/** 写作项目 */
export interface WritingProject {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;

  // 源小说引用
  sourceNovelIds: string[];
  sourceRoles: SourceRole[];

  // 五层产出（null 表示尚未生成）
  outline: BookOutline | null;           // Layer 1
  phases: Phase[] | null;                // Layer 2
  volumes: Volume[] | null;              // Layer 3
  chapterSets: ChapterSet[] | null;      // Layer 4
  chapterPlans: ChapterPlan[] | null;    // Layer 5

  // 生成的章节正文
  chapters: GeneratedChapter[];

  // 当前已生成到哪一层（0 = 尚未开始）
  currentLayer: GenerationLayer;
}

// ========================================
// 五层层级（Five-Layer Hierarchy）
// ========================================

/** Layer 1: 全书大纲（~200字，不可变） */
export interface BookOutline {
  content: string;
  generatedAt: string;
  isLocked: boolean;
  majorPlotFrameworkRef: string; // 引用哪个源小说的大情节框架
}

/** Layer 2: 阶段规划（4-6 份，每份 ~500 字） */
export interface Phase {
  id: string;
  index: number;
  title: string;
  content: string;
  volumeCount: number;
  generatedAt: string;
}

/** Layer 3: 分卷（每阶段 1-2 卷，每卷 ~300 字） */
export interface Volume {
  id: string;
  phaseId: string;
  index: number;
  title: string;
  content: string;
  chapterSetCount: number;
  generatedAt: string;
}

/** Layer 4: 章节集合（每卷 3-5 个，每个 ~200 字） */
export interface ChapterSet {
  id: string;
  volumeId: string;
  index: number;
  title: string;
  content: string;
  chapterCount: number;
  generatedAt: string;
}

/** Layer 5: 每章计划（~100 字/章） */
export interface ChapterPlan {
  id: string;
  chapterSetId: string;
  index: number;
  title: string;
  content: string;
  plotKeywords: string[];
  patternStructure: string; // 引用的小情节模式名称
  generatedAt: string;
}

// ========================================
// 章节生成 + 审查
// ========================================

/** 审查维度 */
export type ReviewDimension =
  | 'style_consistency'    // 文风一致性
  | 'plot_coherence'       // 情节逻辑
  | 'pacing'               // 节奏
  | 'pattern_execution'    // 小情节模式执行度
  | 'foreshadow_execution'; // 伏笔/铺垫执行度

/** 审查状态 */
export type ReviewStatus =
  | 'pending_review'
  | 'reviewing'
  | 'passed'
  | 'needs_revision'
  | 'approved';

/** 单维度审查结果 */
export interface ChapterReview {
  id: string;
  dimension: ReviewDimension;
  score: number;           // 1-10
  issues: string[];
  suggestions: string[];
  reviewedAt: string;
}

/** 生成的章节 */
export interface GeneratedChapter {
  id: string;
  chapterPlanId: string;
  content: string;
  generatedAt: string;
  reviewStatus: ReviewStatus;
  revisionCount: number;   // 最大 3
  reviews: ChapterReview[];
  humanFeedback: string | null;
}

// ========================================
// 管线任务追踪
// ========================================

/** 管线任务类型 */
export type PipelineTaskType =
  // 素材库处理 — 基础设施层
  | 'program_indexing'
  | 'entity_classification'
  | 'narrative_segmentation'
  | 'memory_graph_build'
  // 素材库处理 — 分析层
  | 'smart_slicing'
  | 'style_extraction'
  | 'narrative_dynamics_extraction'
  | 'character_dynamics_extraction'
  | 'reader_experience_extraction'
  | 'narrative_constraints_extraction'
  | 'sample_selection'
  | 'evolution_modeling'
  | 'dna_compression'
  | 'genome_compression'
  // 五层生成
  | 'outline_generation'
  | 'phase_framework'
  | 'phase_detail'
  | 'volume_framework'
  | 'volume_detail'
  | 'chapter_set_framework'
  | 'chapter_set_detail'
  | 'chapter_plan_framework'
  | 'chapter_plan_detail'
  // 章节生成
  | 'chapter_writing'
  | 'chapter_review'
  | 'chapter_revision';

/** 进行中的管线操作 */
export interface PipelineTask {
  id: string;
  type: PipelineTaskType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;        // 0-100
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

// ========================================
// 视图导航
// ========================================

/** 当前激活的视图 */
export type ActiveView =
  | 'source-library'       // 素材库管理（含文风/情节库标签页）
  | 'source-detail'        // 单本源小说详情（含处理+结果）
  | 'writing-project'      // 写作项目（含项目设置/层级规划/章节生成标签页）
  | 'prompt-management'    // 提示词管理
  | 'source-process'       // [废弃] 旧处理页，迁移完成后移除
  | 'layer-generation'     // [废弃] 旧层级页，迁移完成后移除
  | 'chapter-generation'   // [废弃] 旧章节页，迁移完成后移除
  | 'analyze'              // 旧版兼容
  | 'write';               // 旧版兼容

// ---- 旧版应用状态（Phase 7 后移除） ----

/** 旧版应用全局状态（保留至旧组件迁移完成） */
export interface AppState {
  activeView: ActiveView;
  novels: ParsedNovel[];
  analysisReport: string | null;
  isAnalyzing: boolean;
  writeResult: string | null;
  isWriting: boolean;
  apiKey: string;
  model: string;
  baseURL: string;
  maxContextTokens: number;

  setActiveView: (view: ActiveView) => void;
  addNovel: (novel: ParsedNovel) => void;
  removeNovel: (id: string) => void;
  clearNovels: () => void;
  setAnalysisReport: (report: string | null) => void;
  setIsAnalyzing: (v: boolean) => void;
  setWriteResult: (result: string | null) => void;
  setIsWriting: (v: boolean) => void;
  setAISettings: (settings: Partial<Pick<AppState, 'apiKey' | 'model' | 'baseURL' | 'maxContextTokens'>>) => void;
  loadNovelsFromIDB: () => Promise<void>;
  getEffectiveApiKey: () => string;
}
