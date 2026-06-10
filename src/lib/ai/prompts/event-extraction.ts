// ============================================
// 事件提取 — 系统提示词
// 从原文 Chunk 中提取结构化事件，带因果链
// ============================================

import { getPrompt } from './helpers';

export const DEFAULT_SYSTEM_PROMPT = `你是一部小说的结构化分析系统。你的任务是从原文中提取事件，建立事件之间的因果链。

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
  "id": "E-窗口标识-序号",     // 如 E-W1-0042
  "chapter": 章节号,
  "type": "事件类型",
  "participants": ["角色1", "角色2"],
  "location": "地点",
  "description": "一句话描述（不超过50字）",
  "causes": ["E-xxx"],      // 哪些事件直接导致了这个事件（在同一个窗口内的事件ID）
  "effects": ["E-xxx"],     // 这个事件直接导致了哪些事件（可以预填，后续窗口补充）
  "tension_change": -5~5,   // 紧张度变化：正数=更紧张，负数=更松弛
  "emotion": "情绪词",       // 如：紧张/希望/绝望/温馨/好奇/愤怒
  "foreshadowing_of": null, // 如果是伏笔，指向它预示的未来事件（当前窗口内的事件ID）
  "confidence": 0-1         // 你对此事件的提取置信度
}

## 因果链标注规则

1. **直接因果**：如果事件A直接导致事件B发生 → A.causes包含B的ID
2. **不标注间接因果**：如果A→B→C，则A不直接标注C（通过B传导）
3. **伏笔标注**：如果某事件明显是为未来剧情埋设线索 → 标注 foreshadowing_of
4. **默认不确定**：拿不准的因果关系留空，不要强行连接

## 核心原则

- 每个输出的事件必须对应原文中实际发生的内容
- 置信度低于0.5的事件不要输出
- 宁可漏提也不要编造
`;

export function buildEventExtractionMessages(
  chunksText: string,
  entityDict: string,
  windowId: string,
  previousEventIds: string,
) {
  const userMessage = `## 已知实体字典\n${entityDict}\n\n---\n## 原文内容（窗口: ${windowId}）\n${chunksText}\n\n---\n${previousEventIds ? `## 前一窗口已知的事件ID（重叠区可能引用）\n${previousEventIds}\n\n` : ''}请提取所有事件，输出 JSON 数组。事件ID 格式为 E-${windowId}-序号。`;
  return { systemPrompt: getPrompt('event-extraction', DEFAULT_SYSTEM_PROMPT), userMessage };
}
