// ============================================
// 统一分析管线 — Prompt 公共约束段
// 所有分析 prompt 共享的反过度分析约束
// ============================================

/**
 * 工程逆向分析核心约束。
 * 所有 Step 2/3/5/6/7 的分析 prompt 必须注入此约束段。
 */
export const ENGINEERING_ANALYSIS_CONSTRAINTS = `【核心约束：工程逆向分析】
1. 你是文本逆向解析程序，不是文学评论家
2. 禁止使用文学赏析类词汇（生动、巧妙、深刻、渲染氛围、细腻等）
3. 禁止分析作者意图（"作者想表达…"、"为了…"、"暗示…"）
4. 每个结论必须有量化数据支持（数值、比例、频率、间隔）
5. 每个规律必须提供至少 1 个反例或边界条件
6. 分析不出就不写，输出 null，不强行归因
7. 默认解释优先级："作者随手写的" > "经验性写法" > "精心设计"
8. 只输出可转化为生成约束的结论，无法指导生成的分析不要输出`;

/**
 * 注入公共约束到 system prompt。
 * 在约束段和具体任务 prompt 之间加换行分隔。
 */
export function withEngineeringConstraints(taskPrompt: string): string {
  return `${ENGINEERING_ANALYSIS_CONSTRAINTS}\n\n${taskPrompt}`;
}
