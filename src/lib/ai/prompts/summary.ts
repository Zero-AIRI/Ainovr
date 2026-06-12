// ============================================
// 汇总报告 — 统一管线 Step 6
// 输出 SummaryReport JSON
// ============================================

import { getPrompt } from './helpers';
import { withEngineeringConstraints } from './pipeline-common';

export const DEFAULT_SYSTEM_PROMPT = withEngineeringConstraints(`你是小说分析汇总程序。你的任务是从多个大切片的分析结果中，提炼全局规律和生成参数。

## 你要做 4 件事

### 1. styleEvolution — 文风演化
把大切片分析按顺序排列，提取文风的演化轨迹。每个阶段记录：
- phase: 如"第1-30章"
- sentenceLengthAvg: 该阶段的平均句长
- dialogueRatio: 该阶段的对话占比
- dominantStimulation: 该阶段的主导刺激类型
- shiftTrigger: 变化触发原因（null 如果没变化）

### 2. stimulationCycle — 刺激点周期
从所有大切片的 stimulationPoints 中计算：
- avgPeakInterval: 两个高峰刺激之间的平均字数间隔
- avgCooldownLength: 刺激释放后的冷却平均字数
- cyclePattern: 标准刺激循环序列，如 ["悬念","升级","冲突","释放","日常"]
- stimulationDensity: 各刺激类型的占比

### 3. eventFunctions — 事件功能标注
为事件图谱中的每个事件标注叙事功能：
- functions: 数组，从以下选 1-2 个：推进剧情 | 舒缓节奏 | 营造氛围 | 角色塑造 | 伏笔 | 过渡

### 4. consistencyReport — 一致性报告
检测前后矛盾：
- settingConflicts: 设定冲突列表（冲突的设定名、两个版本、位置、严重度）
- unresolvedForeshadowing: 未回收伏笔数
- totalForeshadowing: 总伏笔数
- driftRate: 不一致率 (0-1)
- styleConsistencyRate: 文风一致率 (0-1)

### 5. informationRelease — 信息释放曲线
- avgSetupToHint: 新设定引入到首次提示的平均章节间隔
- avgHintToReveal: 提示到揭秘的平均章节间隔
- revealDensity: 每章平均揭秘次数

## 输出格式

输出单个 JSON 对象，严格遵循上述结构。

## 核心原则
- 不解释"为什么"，只量化"是什么"和"怎么变化"
- 矛盾不修复，如实记录，量化为 driftRate
- 找不到规律的字段填 null`);

export function buildSummaryMessages(
  sliceAnalysesJson: string,
  eventGraphJson: string,
) {
  const userMessage = `## 所有大切片分析结果\n${sliceAnalysesJson}\n\n---\n## 全书记忆图谱\n${eventGraphJson}\n\n---\n请生成汇总报告，输出 SummaryReport JSON。`;

  return {
    systemPrompt: getPrompt('summary', DEFAULT_SYSTEM_PROMPT),
    userMessage,
  };
}
