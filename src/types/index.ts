// ============================================
// AI 小说风格仿写 — 核心类型定义
// ============================================

/** 已上传的参考小说 */
export interface ParsedNovel {
  id: string;
  title: string;
  totalChars: number;
  fullText: string;
  sampleText: string;
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

  // 聊天记录
  setChatMessages: (messages: ChatMessage[]) => void;
  addChatMessage: (message: ChatMessage) => void;
  clearChatMessages: () => void;

  // 文件同步
  setSyncStatus: (status: AppState['syncStatus']) => void;
  setSyncError: (error: string | null) => void;
  setFolderName: (name: string | null) => void;
}
