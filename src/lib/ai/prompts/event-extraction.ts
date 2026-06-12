// ============================================
// 事件提取 — 逐切片模式（统一管线 Step 2）
// 从小切片原文中提取结构化事件，带因果链
// ============================================

import { getPrompt } from './helpers';
import { withEngineeringConstraints } from './pipeline-common';

export const DEFAULT_SYSTEM_PROMPT = withEngineeringConstraints(`你是一部小说的结构化事件提取程序。你的任务是从原文片段中提取事件，建立事件之间的因果链。

## 什么是"事件"

事件 = 一个改变了故事状态的具体行动或发生。

- ✅ "韩立拜墨居仁为师" → 事件（状态：无师→有师）
- ✅ "发现神秘小瓶可以催熟药草" → 事件（状态：未知→已知）
- ❌ "韩立走在路上" → 不是事件（状态未改变）
- ❌ "天很蓝" → 不是事件（环境描写，不是行动）

## 事件类型

使用以下标准类型之一：
- **拜师/收徒**：师徒关系建立
- **战斗/冲突**：武力对抗
- **死亡/牺牲**：角色死亡
- **揭露/发现**：关键信息被揭示
- **突破/升级**：实力/境界提升
- **交易/获得**：重要物品的获取或交易
- **背叛/决裂**：关系破裂
- **结盟/合作**：新联盟建立
- **离别/重逢**：角色离开或重聚
- **决策/选择**：角色做出影响后续的重大决策
- **日常/过渡**：状态维护性事件（修炼、赶路、准备）
- **其他**

## 输出格式

对每个识别到的事件输出 JSON：

{
  "id": "E-S{sliceIndex}-{序号}",
  "chapter": 章节号,
  "type": "事件类型",
  "participants": ["角色1", "角色2"],
  "location": "地点",
  "description": "一句话描述（不超过50字）",
  "causes": [],
  "effects": [],
  "tension_change": -5~5,
  "emotion": "情绪词",
  "foreshadowing_of": null,
  "confidence": 0-1
}

## 因果链标注规则

1. **只标注本切片内的因果**：事件 A 在本切片内直接导致事件 B → A.effects 包含 B.id
2. **不猜测跨切片因果**：跨切片的因果关系由后续步骤处理，不要在这里猜测
3. **伏笔标注**：如果本事件明显为后续剧情埋线索 → 标注 foreshadowing_of（仅限本切片内能确认的）
4. **拿不准就留空**：因果关系不确定时留空，宁缺毋滥

## 核心原则

- 只提取原文中**实际发生**的事件，不推测、不编造
- 置信度 < 0.5 的事件不要输出
- 同时记录出现的所有实体名（角色、地点、势力、物品）
- 只做事实提取，不分析作者意图，不解读象征意义`);

/**
 * 构建逐切片事件提取的消息（统一管线 Step 2）
 */
export function buildEventExtractionMessages(
  sliceContent: string,
  sliceIndex: number,
  totalSlices: number,
) {
  const userMessage = `## 切片信息\n- 切片编号: ${sliceIndex + 1} / ${totalSlices}\n- 事件 ID 格式: E-S${sliceIndex}-{序号}\n\n## 原文内容\n${sliceContent}\n\n---\n请提取本切片中的所有事件，输出 JSON 数组。同时列出本切片中出现的所有实体名。`;

  return {
    systemPrompt: getPrompt('event-extraction', DEFAULT_SYSTEM_PROMPT),
    userMessage,
  };
}

/**
 * 构建事件对齐的消息（统一管线 Step 3）
 * AI 看到所有事件 JSON + 候选实体对，输出完整重建的图谱
 */
export const DEFAULT_ALIGNMENT_PROMPT = withEngineeringConstraints(`你是事件图谱对齐程序。你的任务是：
1. 实体归一：识别不同切片中对同一实体的不同称呼（别名、错别字、称号变化）
2. 跨切片因果链：建立跨切片的事件因果关系
3. 伏笔配对：识别埋设和回收的伏笔对
4. 实体时间线：为每个实体构建状态演变轨迹

## 输入
你将收到：所有事件 JSON、候选实体对（代码预匹配的疑似同一实体）、实体频率统计。

## 输出格式（完整 JSON）

{
  "entityMappings": [
    { "aliases": ["韩立", "韩老魔", "韩历"], "canonical": "韩立", "type": "character" }
  ],
  "crossSliceCausalLinks": [
    { "cause": "E-S0-005", "effect": "E-S3-012", "confidence": 0.8 }
  ],
  "foreshadowingPairs": [
    { "setup": "E-S1-003", "payoff": "E-S8-021", "distance": 42, "status": "resolved" }
  ],
  "entityTimelines": [
    { "entity": "韩立", "timeline": [
      { "chapter": 1, "state": "散修", "triggerEventId": "E-S0-001" },
      { "chapter": 25, "state": "筑基", "triggerEventId": "E-S2-008" }
    ]}
  ],
  "events": [ ... ]
  // 重新输出所有事件，其中：
  // - participants 替换为 canonical 名称
  // - causes/effects 包含跨切片因果链接
  // - id 保持不变
]

## 核心原则
- 不分析作者意图，不做文学解读
- 实体归一需要证据（从不同时出现、类型匹配、上下文线索）
- 拿不准的因果链不标注，置信度 < 0.5 的不输出
- 未回收的伏笔 status 标为 "open"，无任何提示的标为 "dangling"`);

export function buildEventAlignmentMessages(
  allEventsJson: string,
  candidatePairs: string,
  entityFrequency: string,
  totalEvents: number,
  totalSlices: number,
) {
  const userMessage = `## 输入概要
- 共 ${totalEvents} 个事件，来自 ${totalSlices} 个切片

## 所有事件（已按切片排序）
${allEventsJson}

## 候选实体对（代码预匹配）
${candidatePairs}

## 实体频率统计
${entityFrequency}

---
请执行实体归一、跨切片因果链接、伏笔配对、实体时间线构建。输出完整 JSON。`;

  return {
    systemPrompt: getPrompt('event-alignment', DEFAULT_ALIGNMENT_PROMPT),
    userMessage,
  };
}
