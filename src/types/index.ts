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

// ---- 采样相关 ----

/** 采样策略 */
export type SamplingStrategy = 'full' | 'chapter' | 'fixedLength' | 'customLimit';

/** 章节采样配置 */
export interface ChapterSamplingConfig {
  headCount: number;    // 开头章节数 (default 3)
  midCount: number;     // 中间章节数 (default 3)
  tailCount: number;    // 结尾章节数 (default 3)
  randomCount: number;  // 随机章节数 (default 2)
}

/** 固定长度采样配置 */
export interface FixedLengthSamplingConfig {
  headRatio: number;   // 头部比例 0-1 (default 0.30)
  midRatio: number;    // 中部比例 0-1 (default 0.25)
  tailRatio: number;   // 尾部比例 0-1 (default 0.20)
}

/** 采样配置 */
export interface SamplingConfig {
  strategy: SamplingStrategy;
  /** 章节采样参数 */
  chapter: ChapterSamplingConfig;
  /** 固定长度采样参数 */
  fixedLength: FixedLengthSamplingConfig;
  /** 自定义字数限制 */
  customCharLimit: number;
  /** 覆盖模型推荐的字数上限，null = 自动根据模型推算 */
  maxCharsOverride: number | null;
}

/** 导入管道配置 */
export interface ImportConfig {
  cleaning: CleaningConfig;
  sampling: SamplingConfig;
}

// ---- 核心数据结构 ----

/** 已上传的参考小说 */
export interface ParsedNovel {
  id: string;
  title: string;
  totalChars: number;
  fullText: string;
  sampleText: string;
  /** 原始未清洗文本，用于重新处理（旧数据可能为 null） */
  rawText: string | null;
  /** 产生当前结果的配置（旧数据可能为 null） */
  importConfig: ImportConfig | null;
}

/** 供应商标识: deepseek | custom:{id} */
export type AIProviderType = 'deepseek' | `custom:${string}`;

/** 自定义供应商配置 */
export interface CustomProvider {
  id: string;
  label: string;
  baseURL: string;
  model: string;
}

/** 判断是否为自定义供应商 */
export function isCustomProvider(type: AIProviderType): type is `custom:${string}` {
  return type.startsWith('custom:');
}

/** 从 AIProviderType 提取自定义供应商 id */
export function getCustomId(type: AIProviderType): string | null {
  if (!isCustomProvider(type)) return null;
  return type.slice('custom:'.length);
}

/** 判断该供应商是否需要 API Key */
export function needsApiKey(providerType: AIProviderType): boolean {
  return true; // DeepSeek 和自定义都需要
}

/** DeepSeek 思考强度 */
export type ThinkingEffort = 'high' | 'max';

/** 仿写篇幅选项 */
export type WriteLength = 'fragment' | 'chapter' | 'short';

/** 聊天消息 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 当前激活的视图 */
export type ActiveView = 'welcome' | 'analyze' | 'write' | 'chat';

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

  // AI 设置
  providerType: AIProviderType;
  apiKey: string;
  model: string;
  baseURL: string;

  // DeepSeek 思考模式
  thinkingMode: boolean;
  thinkingEffort: ThinkingEffort;

  // 自定义供应商列表
  customProviders: CustomProvider[];

  // 聊天记录
  chatMessages: ChatMessage[];

  // 文本处理配置
  importConfig: ImportConfig;

  // 文件同步状态
  syncStatus: 'idle' | 'loading' | 'syncing' | 'error' | 'no-folder';
  syncError: string | null;
  folderName: string | null;

  // Actions
  setActiveView: (view: ActiveView) => void;
  addNovel: (novel: ParsedNovel) => void;
  removeNovel: (id: string) => void;
  clearNovels: () => void;
  setAnalysisReport: (report: string | null) => void;
  setIsAnalyzing: (v: boolean) => void;
  setWriteResult: (result: string | null) => void;
  setIsWriting: (v: boolean) => void;
  setAISettings: (settings: Partial<Pick<AppState, 'providerType' | 'apiKey' | 'model' | 'baseURL' | 'thinkingMode' | 'thinkingEffort'>>) => void;
  setCustomProviders: (providers: CustomProvider[]) => void;

  // 文本处理
  updateImportConfig: (config: Partial<ImportConfig>) => void;
  reprocessNovel: (novelId: string) => Promise<void>;
  reprocessAllNovels: () => Promise<void>;

  // 聊天记录
  setChatMessages: (messages: ChatMessage[]) => void;
  addChatMessage: (message: ChatMessage) => void;
  clearChatMessages: () => void;

  // 文件同步
  setSyncStatus: (status: AppState['syncStatus']) => void;
  setSyncError: (error: string | null) => void;
  setFolderName: (name: string | null) => void;

  // 启动恢复
  loadNovelsFromIDB: () => Promise<void>;
}
