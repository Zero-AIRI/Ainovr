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
  style: string;        // 文风特征
  plot: string;         // 剧情结构
  character: string;    // 人物塑造
  technique: string;    // 叙事技巧
  tags: string[];       // 风格标签
  fullReport: string;   // 完整报告原文
}

/** AI 后端提供商类型 */
export type AIProviderType = 'deepseek' | 'moonshot' | 'openai' | 'anthropic' | 'ollama';

/** AI 提供商配置 */
export interface AIProviderConfig {
  type: AIProviderType;
  label: string;
  apiKey: string;
  baseURL?: string;
  model: string;
}

/** 预设的 AI 提供商列表 */
export const AI_PROVIDER_PRESETS: Omit<AIProviderConfig, 'apiKey'>[] = [
  { type: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
  { type: 'moonshot', label: 'Kimi (月之暗面)', model: 'moonshot-v1-128k' },
  { type: 'openai', label: 'OpenAI', model: 'gpt-4o' },
  { type: 'anthropic', label: 'Claude', model: 'claude-sonnet-4-6' },
  { type: 'ollama', label: 'Ollama (本地)', model: 'qwen2.5:14b', baseURL: 'http://localhost:11434' },
];

/** 仿写篇幅选项 */
export type WriteLength = 'fragment' | 'chapter' | 'short';

/** 仿写请求参数 */
export interface WriteRequest {
  genre: string;
  length: WriteLength;
  synopsis: string;
  extraRequirements?: string;
}

/** 应用全局状态 */
export interface AppState {
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

  // Actions
  addNovel: (novel: ParsedNovel) => void;
  removeNovel: (id: string) => void;
  clearNovels: () => void;
  setAnalysisReport: (report: string | null) => void;
  setIsAnalyzing: (v: boolean) => void;
  setWriteResult: (result: string | null) => void;
  setIsWriting: (v: boolean) => void;
  setAISettings: (settings: Partial<Pick<AppState, 'providerType' | 'apiKey' | 'model' | 'baseURL'>>) => void;
}
