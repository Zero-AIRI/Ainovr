// ============================================
// AI 小说风格仿写 — 核心类型定义
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

// ---- 分块相关 ----

/** 小说分块 */
export interface NovelChunk {
  id: string;          // nanoid
  novelId: string;     // 所属小说 ID
  index: number;       // 在小说中的顺序（从 0 开始）
  title: string;       // 章节标题（如"第一章 陨落的天才"或"第3部分"）
  content: string;     // 块文本内容
  charCount: number;   // content.length
}

/** 导入管道配置（保留用于 IndexedDB 旧数据兼容） */
export interface ImportConfig {
  cleaning: CleaningConfig;
  /** 分块大小上限（字符数），超过此大小的章节会被进一步分割 */
  maxChunkSize: number;
}

// ---- 核心数据结构 ----

/** 已上传的参考小说 */
export interface ParsedNovel {
  id: string;
  title: string;
  totalChars: number;
  fullText: string;
  /** 清洗后的分块列表 */
  chunks: NovelChunk[];
  /** 原始未清洗文本，用于重新处理（旧数据可能为 null） */
  rawText: string | null;
  /** 产生当前结果的配置（旧数据可能为 null） */
  importConfig: ImportConfig | null;
}

/** 仿写篇幅选项 */
export type WriteLength = 'fragment' | 'chapter' | 'short';

/** 当前激活的视图 */
export type ActiveView = 'analyze' | 'write';

/** 应用全局状态 */
export interface AppState {
  // 视图
  activeView: ActiveView;

  // 上传的小说
  novels: ParsedNovel[];

  // 分析报告
  analysisReport: string | null;
  isAnalyzing: boolean;

  // 仿写
  writeResult: string | null;
  isWriting: boolean;

  // API 设置
  apiKey: string;
  model: string;
  baseURL: string;

  // 最大上下文 Token 数（控制分批分析的每批大小）
  maxContextTokens: number;

  // Actions
  setActiveView: (view: ActiveView) => void;
  addNovel: (novel: ParsedNovel) => void;
  removeNovel: (id: string) => void;
  clearNovels: () => void;
  setAnalysisReport: (report: string | null) => void;
  setIsAnalyzing: (v: boolean) => void;
  setWriteResult: (result: string | null) => void;
  setIsWriting: (v: boolean) => void;
  setAISettings: (settings: Partial<Pick<AppState, 'apiKey' | 'model' | 'baseURL' | 'maxContextTokens'>>) => void;

  // 启动恢复
  loadNovelsFromIDB: () => Promise<void>;

  // 运行时解析 API Key（用户配置优先，环境变量兜底）
  getEffectiveApiKey: () => string;
}
