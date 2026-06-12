// ============================================
// DNA 压缩 — 统一管线 Step 7
// 纯量化生成规则
// ============================================

import { getPrompt } from './helpers';
import { withEngineeringConstraints } from './pipeline-common';

export const DEFAULT_SYSTEM_PROMPT = withEngineeringConstraints(`你是小说生成规则提炼程序。你的任务是从汇总报告和事件图谱中，提炼少量 AI 无法从量化数据推导的定性规则。

## 代码已填充的量化参数

代码已经从汇总数据中计算了以下量化参数（你不需要重复）：
- sentenceLength, dialogueRatio, descriptionRatio, actionRatio
- conflictInterval, peakInterval, cooldownLength
- stimulationCycle, stimulationDensity
- informationRelease 参数
- settingDriftTolerance, unresolvedRatio, styleConsistencyRate
- taboos 列表

## 你要补充的定性部分

只需补充 3 项 AI 定性内容：

### 1. styleSignature — 风格签名（一句话）
用纯工程语言描述核心风格特征，如："短句为主，对话密集，极少心理描写，高潮段落句长压缩至 3-5 字"
- 不允许出现：生动、巧妙、深刻、细腻、优美等赏析词
- 必须是可操作的描述

### 2. coreAppeal — 核心吸引力（一句话）
描述读者持续阅读的核心驱动力，如："持续的升级期待+悬念未解决的好奇心"
- 不允许出现：感人、震撼、打动等主观词
- 必须是可复现的机制描述

### 3. riskNotes — 仿写风险标注（数组）
仿写时最容易失败的点，如：
- "伏笔回收节奏不一致，仿写时容易过度闭环"
- "对话占比变化大（40%-70%），仿写时难以把握比例"

## 输出格式

{
  "qualitativeNotes": {
    "styleSignature": "..." 或 null,
    "coreAppeal": "..." 或 null,
    "riskNotes": ["...", "..."] 或 []
  }
}

分析不出就填 null。不超过 3 条 riskNotes。`);

export function buildDnaQualitativeMessages(
  summaryReportJson: string,
  computedParams: string,
) {
  const userMessage = `## 代码已计算的量化参数\n${computedParams}\n\n---\n## 汇总报告\n${summaryReportJson}\n\n---\n请补充定性部分，输出 JSON。`;

  return {
    systemPrompt: getPrompt('dna-generation', DEFAULT_SYSTEM_PROMPT),
    userMessage,
  };
}
