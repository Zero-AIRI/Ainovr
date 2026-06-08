// ============================================
// 提示词管理 Store — 自定义覆盖 + 持久化到服务端
// ============================================

import { create } from 'zustand';

/** 提示词元信息 */
export interface PromptMeta {
  key: string;
  label: string;
  category: string;
  description: string;
}

/** 所有提示词的注册表 */
export const PROMPT_REGISTRY: PromptMeta[] = [
  // 素材库处理 — 基础设施层
  { key: 'entity-classification', label: '实体分类', category: '素材处理', description: 'AI对候选实体列表进行类型分类（character/location/organization/artifact/concept）' },
  // 素材库处理 — 分析层
  { key: 'source-slicing', label: '智能切片', category: '素材处理', description: '按叙事弧线对小说文本进行智能切片（可配置目标字数）' },
  { key: 'source-style', label: '文风提取', category: '素材处理', description: '9维度分析写作风格特征（基础六维+首尾技术+telling/showing+紧张语言标记）' },
  { key: 'source-style-supplement', label: '文风补充', category: '素材处理', description: '多批次处理时补充文风分析' },
  { key: 'source-plot', label: '叙事动力学', category: '素材处理', description: '8维叙事动力学分析（大情节+小模式+伏笔+节奏+谜团图谱+翻页驱动+刺激-情绪+高光技术）' },
  { key: 'source-plot-supplement', label: '叙事动力学补充', category: '素材处理', description: '多批次处理时补充叙事动力学分析' },
  { key: 'source-character-dynamics', label: '角色动力学', category: '素材处理', description: '角色叙事功能+关系拓扑+角色弧线+角色演化' },
  { key: 'source-character-dynamics-supplement', label: '角色动力学补充', category: '素材处理', description: '多批次处理时补充角色动力学分析' },
  { key: 'source-reader-experience', label: '读者体验模型', category: '素材处理', description: '心理缺失模型+高潮势能追踪+势能曲线+综合翻页驱动力' },
  { key: 'source-reader-experience-supplement', label: '读者体验补充', category: '素材处理', description: '多批次处理时补充读者体验分析' },
  { key: 'source-narrative-constraints', label: '叙事约束', category: '素材处理', description: '降温机制+结构异常+风险模式+叙事禁忌+交叉审查' },
  { key: 'source-narrative-constraints-supplement', label: '叙事约束补充', category: '素材处理', description: '多批次处理时补充叙事约束分析' },
  { key: 'source-evolution-modeling', label: '演化建模', category: '素材处理', description: 'AI自动识别叙事阶段+驱动变迁曲线+谜团密度曲线+世界扩展曲线' },
  { key: 'source-dna-compression', label: 'DNA压缩', category: '素材处理', description: '双层压缩：DNA超压缩(500字)+Genome完整基因库(5-10K字)' },
  { key: 'source-samples', label: '样本选取', category: '素材处理', description: '精选 3-5 个代表性切片（含高潮蓄能/情绪转换/异常结构）' },
  // 层级生成
  { key: 'outline', label: '全书大纲', category: '层级生成', description: '基于大情节框架和创作想法生成 ~200 字大纲' },
  { key: 'phase-framework', label: '阶段框架', category: '层级生成', description: '规划 4-6 个阶段的标题和章节范围' },
  { key: 'phase-detail', label: '阶段详情', category: '层级生成', description: '单个阶段 ~500 字详细规划' },
  { key: 'volume-framework', label: '分卷框架', category: '层级生成', description: '每阶段 1-2 卷的框架规划' },
  { key: 'volume-detail', label: '分卷详情', category: '层级生成', description: '单卷 ~300 字详细规划' },
  { key: 'chapter-set-framework', label: '章节集框架', category: '层级生成', description: '每卷 3-5 个章节集合的框架' },
  { key: 'chapter-set-detail', label: '章节集详情', category: '层级生成', description: '单集合 ~200 字详细规划' },
  { key: 'chapter-plan-framework', label: '章节计划框架', category: '层级生成', description: '每章标题和模式匹配' },
  { key: 'chapter-plan-detail', label: '章节计划详情', category: '层级生成', description: '单章 ~100 字场景节拍和伏笔操作' },
  // 章节生成
  { key: 'chapter-writing', label: '章节生成', category: '章节写作', description: '根据计划生成章节正文' },
  { key: 'chapter-review', label: '章节审查', category: '章节写作', description: '5 维度自动审查（文风/情节/节奏/模式/伏笔）' },
  { key: 'chapter-revision', label: '章节修正', category: '章节写作', description: '根据审查结果和人工反馈修正章节' },
];

export interface PromptsState {
  /** 自定义提示词覆盖（key -> content） */
  customPrompts: Record<string, string>;
  /** 默认提示词（key -> content） */
  defaultPrompts: Record<string, string>;
  /** 是否已加载 */
  loaded: boolean;

  // Actions
  loadPrompts: () => Promise<void>;
  getPrompt: (key: string) => string;
  setCustomPrompt: (key: string, content: string) => void;
  resetPrompt: (key: string) => void;
  saveCustomPrompt: (key: string, content: string) => Promise<void>;
}

export const usePromptStore = create<PromptsState>()((set, get) => ({
  customPrompts: {},
  defaultPrompts: {},
  loaded: false,

  loadPrompts: async () => {
    try {
      const res = await fetch('/api/prompts/list');
      if (!res.ok) return;
      const data = await res.json();
      set({
        defaultPrompts: data.defaults ?? {},
        customPrompts: data.custom ?? {},
        loaded: true,
      });
    } catch (err) {
      console.error('加载提示词失败:', err);
    }
  },

  getPrompt: (key: string) => {
    const { customPrompts, defaultPrompts } = get();
    return customPrompts[key] ?? defaultPrompts[key] ?? '';
  },

  setCustomPrompt: (key, content) => {
    set((s) => ({
      customPrompts: { ...s.customPrompts, [key]: content },
    }));
  },

  resetPrompt: (key) => {
    set((s) => {
      const next = { ...s.customPrompts };
      delete next[key];
      return { customPrompts: next };
    });
  },

  saveCustomPrompt: async (key, content) => {
    get().setCustomPrompt(key, content);
    try {
      await fetch('/api/prompts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, content }),
      });
    } catch (err) {
      console.error('保存提示词失败:', err);
    }
  },
}));
