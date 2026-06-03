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

/** 风格分析报告 */
export interface AnalysisReport {
  style: string;
  plot: string;
  character: string;
  technique: string;
  tags: string[];
  fullReport: string;
}

/** 预设供应商标识 */
export type PresetProviderType = 'deepseek' | 'moonshot' | 'openai' | 'anthropic' | 'ollama';

/** 完整供应商标识 = 预设 | custom:{id} */
export type AIProviderType = PresetProviderType | `custom:${string}`;

/** 自定义供应商配置 */
export interface CustomProvider {
  id: string;
  label: string;
  baseURL: string;
  model: string;
}

/** AI 提供商配置 */
export interface AIProviderConfig {
  type: AIProviderType;
  label: string;
  apiKey: string;
  baseURL?: string;
  model: string;
}

/** 预设的 AI 提供商列表 */
export const AI_PROVIDER_PRESETS: { type: PresetProviderType; label: string; model: string; baseURL?: string }[] = [
  { type: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
  { type: 'moonshot', label: 'Kimi (月之暗面)', model: 'moonshot-v1-128k' },
  { type: 'openai', label: 'OpenAI', model: 'gpt-4o' },
  { type: 'anthropic', label: 'Claude', model: 'claude-sonnet-4-6' },
  { type: 'ollama', label: 'Ollama (本地)', model: 'qwen2.5:14b', baseURL: 'http://localhost:11434' },
];

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
  return providerType !== 'ollama';
}

/** DeepSeek 思考强度 */
export type ThinkingEffort = 'high' | 'max';

/** 仿写篇幅选项 */
export type WriteLength = 'fragment' | 'chapter' | 'short';

/** 仿写请求参数 */
export interface WriteRequest {
  genre: string;
  length: WriteLength;
  synopsis: string;
  extraRequirements?: string;
}

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
}
