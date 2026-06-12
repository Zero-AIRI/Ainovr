// ============================================
// 深度分析 — 逐大切片（统一管线 Step 5）
// 输出结构化 SliceAnalysis JSON
// ============================================

import { getPrompt } from './helpers';
import { withEngineeringConstraints } from './pipeline-common';

export const DEFAULT_SYSTEM_PROMPT = withEngineeringConstraints(`你是小说逆向工程分析程序。你的任务是从原文片段中提取可复现的写作机制，直接指导 AI 仿写。

## 你要提取什么

对给定的原文片段，提取以下 5 个维度的量化机制。每个结论必须有数值支撑和反例。

### 1. styleMechanics — 文风机制
- sentenceLength: { avg, range, climax（高潮段落）, calm（平静段落） }
- dialogueRatio: 对话占比 (0-1)
- descriptionStrategy: 描写策略的可操作规则，如"动作描写用短句堆叠，环境描写用长句铺陈"
- counterExample: 不符合上述规律的原文片段（限30字）
- confidence: 0-1
- generationRule: 一条直接可执行的生成指令

### 2. narrativeMechanics — 叙事机制
- pacingPattern: 节奏模式，如"铺垫20%→递进50%→高潮30%"
- informationControl: 信息控制策略，如"读者知道主角有底牌，对手不知道"
- counterExample, confidence, generationRule（同上格式）

### 3. characterMechanics — 角色机制
对每个重要角色：
- stimulusResponse: 刺激-反应对数组，如 [{ stimulus: "被挑衅", response: "沉默+观察+不口舌" }]
- relationshipChanges: 关系变化，如 [{ with: "南宫婉", from: "盟友", to: "疑虑" }]
- confidence: 0-1

### 4. stimulationPoints — 刺激点
标记每个叙事刺激点：
- type: 冲突升级 | 信息释放 | 关系变化 | 实力跃迁 | 悬念建立 | 日常过渡
- location: 章节或段落位置
- sentenceLengthAtPoint: 该点的平均句长
- tensionChange: -5 到 +5
- confidence: 0-1

### 5. constraints — 约束
- worldRules: 世界观硬规则，如 ["筑基期不能飞行"]
- characterLimits: 角色当前限制，如 ["灵力即将耗尽"]
- plotConstraints: 情节约束，如 ["三章内必须解决威胁"]
- taboos: 绝对不做的，如 ["不写虐主"]

## 同时你会收到全书记忆图谱

图谱包含所有已提取的事件和实体信息。你可以用它来理解当前片段在全书中的位置，但你只分析当前片段的原文。

## 输出格式

输出单个 JSON 对象，严格遵循上述结构。分析不出的字段填 null。`);

export function buildDeepAnalysisMessages(
  sliceText: string,
  sliceIndex: number,
  totalSlices: number,
  eventGraphJson: string,
) {
  const userMessage = `## 切片信息\n- 大切片编号: ${sliceIndex + 1} / ${totalSlices}\n\n## 全书记忆图谱\n${eventGraphJson}\n\n---\n## 原文内容\n${sliceText}\n\n---\n请分析原文，输出 SliceAnalysis JSON。`;

  return {
    systemPrompt: getPrompt('deep-analysis', DEFAULT_SYSTEM_PROMPT),
    userMessage,
  };
}
