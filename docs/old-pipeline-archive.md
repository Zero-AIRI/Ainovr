# 旧版分析管线归档文档

> **生成时间**: 2026-06-12  
> **状态**: 已废弃，由统一 7 步管线 (`src/lib/source-processing/unified-pipeline.ts`) 替代  
> **废弃原因**: 从「文学鉴赏式分析」转向「工程逆向式分析」，只提取可量化的生成规则

---

## 目录

1. [旧版管线概览](#旧版管线概览)
2. [基础 8 步管线 (basic-pipeline)](#基础-8-步管线-basic-pipeline)
3. [道/气 分析管线 (dao-pipeline)](#道气-分析管线-dao-pipeline)
4. [旧版 API 路由](#旧版-api-路由)
5. [旧版 UI 视图](#旧版-ui-视图)
6. [所有旧版提示词 (System Prompts)](#所有旧版提示词-system-prompts)

---

## 旧版管线概览

```
旧版系统由两个管线组成：

1. basic-pipeline.ts — 基础 8 步分析管线
   切片 → 文风 → 叙事动力学 → 角色动力学 → 读者体验 ‖ 叙事约束 → 样本 → DNA

2. dao-pipeline.ts — 道/气 DAG 并行管线（在基础管线完成后运行）
   体验流标注 → 消融测试 → 势能追踪
```

两者已被统一 7 步管线替代：
```
小切片 → 逐片事件提取 → 事件对齐 → 大切片 → 逐大切片深度分析 → 汇总报告 → DNA 压缩
```

---

## 基础 8 步管线 (basic-pipeline)

**文件**: `src/lib/source-processing/basic-pipeline.ts`

### 流程图

```
Step 0: 智能切片 ──── AI 按叙事弧线切分章节 (~5000字/片)
       │
Step 1: 文风提取 ──── 9 维度文风分析 (句式/修辞/词汇/视角/对话/描写 + 章首尾/叙述比例/紧张标记)
       │
Step 2: 叙事动力学 ── 8 部分叙事分析 (大情节/小情节模式/伏笔/节奏/谜团/翻页驱动/刺激映射/高光技术)
       │
Step 3: 角色动力学 ── 3 部分角色分析 (叙事功能/关系拓扑/角色弧线)
       │
Step 4: 读者体验 ──── 3 部分体验分析 (心理缺失/高潮势能/综合驱动力)
  ‖
Step 5: 叙事约束 ──── 4 部分约束分析 (降温/结构异常/禁忌/交叉审查)
       │
Step 6: 样本选取 ──── 精选 3-5 个代表性切片
       │
Step 7: DNA 压缩 ──── YAML 格式压缩所有分析结果
```

### Step 依赖关系

- Step 1 依赖 Step 0（切片）
- Step 2 依赖 Step 1（文风档案）
- Step 3 依赖 Step 2（叙事动力学报告）
- Step 4 依赖 Step 1 + Step 2 + Step 3
- Step 5 依赖 Step 2 + Step 3
- Step 4 和 Step 5 可并行执行
- Step 6 依赖 Step 1 + Step 2 + Step 4 + Step 5
- Step 7 依赖 Step 1 + Step 2 + Step 3 + Step 4 + Step 5

### 核心代码

```typescript
export const TOTAL_STEPS = 8;

export function determineResumeStep(novel: SourceNovel | null): number {
  if (!novel) return 0;
  if (!novel.slices || novel.slices.length === 0) return 0;
  if (!novel.styleProfile) return 1;
  if (!novel.plotReport) return 2;
  if (!novel.characterDynamics) return 3;
  if (!novel.readerExperience) return 4;
  if (!novel.narrativeConstraints) return 5;
  if (!novel.representativeSamples) return 6;
  return 7;
}
```

### 分批策略

对于长文本，Step 1-5 使用自动分批：先将切片打包，第一批用完整 results，后续用 supplement prompt 增量更新。

---

## 道/气 分析管线 (dao-pipeline)

**文件**: `src/lib/source-processing/dao-pipeline.ts`

### 流程图

```
基础管线完成
       │
Step 道-1: 体验流标注    ─── 3 种读者人格 × N 个切片（并行）
       │                     每切片输出 immersion/emotional_intensity/anticipation/perceived_pace
       │
Step 道-2: 消融测试      ─── 四分类判定每个切片的叙事必要性
       │                     bone | muscle | filler_a | filler_b | uncertain
  ‖
Step 道-3: 势能追踪      ─── "积累→释放"周期分析 + 全局节奏画像
       │
       └──→ NovelDNA 生成
```

### DAG 并行设计

- 道-1 内部：3 persona × N slices = 3N 个并行 AI 调用
- 道-2 和道-3：可在道-1 完成后并行执行

---

## 旧版 API 路由

所有路由在 `src/app/api/source/process/` 下：

| 路由 | 对应步骤 | 对应模块 |
|------|----------|----------|
| `slice/` | Step 0 | smart-slicer.ts |
| `style/` | Step 1 | style-extractor.ts |
| `plot/` | Step 2 | plot-extractor.ts |
| `character-dynamics/` | Step 3 | character-dynamics-extractor.ts |
| `reader-experience/` | Step 4 | reader-experience-extractor.ts |
| `narrative-constraints/` | Step 5 | narrative-constraints-extractor.ts |
| `samples/` | Step 6 | sample-selector.ts |
| `classify-entities/` | Step -1A | entity-classifier.ts |
| `experience-annotation/` | 道-1 | experience-annotator.ts |
| `ablation-testing/` | 道-2 | ablation-tester.ts |
| `tension-tracking/` | 道-3 | tension-tracker.ts |
| `dna-compression/` | Step 7 | dna-compressor.ts（共用，新管线仍使用） |

---

## 旧版 UI 视图

两个已废弃的独立视图：

### LayerGenerationView
**文件**: `src/components/generation/LayerGenerationView.tsx`
- 五层管线视图：大纲 → 阶段规划 → 分卷 → 章节集合 → 每章计划
- 已迁移到 `WritingProjectView` 的内嵌标签页

### ChapterGenerationView
**文件**: `src/components/chapter/ChapterGenerationView.tsx`
- 章节生成 + 自动审查 + 人工反馈修正
- 已迁移到 `WritingProjectView` 的内嵌标签页

### ActiveView 类型中的废弃值

```typescript
'source-process'       // [废弃] 旧处理页
'layer-generation'     // [废弃] 旧层级页
'chapter-generation'   // [废弃] 旧章节页
'analyze'              // 旧版兼容
'write'                // 旧版兼容
```

---

## 所有旧版提示词 (System Prompts)

### 1. 智能切片 (source-slicing.ts)

```
你是小说逆向工程系统的智能切片模块。
目标：按叙事弧线切割小说文本，保持情节完整性。

要求：
- 以情节完整性为最高优先级（不在高潮中间切断）
- 以章节边界为自然切割点
- 每个切片包含一个相对完整的叙事单元
- 为每个切片标注：序号、标题、语义标签、情节弧线、情绪基调
- 每个切片的目标字数：{targetSliceSize} 字（允许 ±30% 浮动，情节完整性优先于字数约束）

切片粒度说明：
- 2000字以下：精细切片，适合短篇分析或需要逐场景拆解
- 5000字左右（默认）：标准切片，平衡语义完整性和分析效率
- 10000字以上：粗粒度切片，适合快速浏览长篇小说的整体结构
- 30000字以上：按卷/大弧线切片，每个切片对应一个完整的叙事大段落
```

### 2. 文风提取 (style-extraction.ts)

```
你是小说逆向工程系统的文风分析模块。
目标：提取可迁移、可复用的文风规律。

禁止：剧情复述、人物介绍、作者评价、文学赏析、主观吹捧、推测意图。

你的任务是深入分析小说文本，提取 9 个维度的写作风格特征。

## 分析维度

### 基础六维
1. 句式特征（长短句比例、排比/对仗使用）
2. 修辞偏好（比喻、拟人、夸张等手法的使用频率和方式）
3. 词汇特征（文言/白话、口语/书面语、特定词汇频率）
4. 叙事视角（人称、全知/有限视角、语言调性）
5. 对话风格（对话长度、节奏、个性化程度）
6. 描写手法（环境描写、动作描写、心理描写的偏好和方式）

### 增强三维
7. 章节首尾技术
   - 开头 hook 类型分布及各自占比
   - 结尾类型分布及各自占比
   - 首尾组合模式

8. 叙述与场景比例（telling vs showing）
   - 不同节奏区域的叙述/场景比例
   - 从叙述切换到场景的触发条件
   - 从场景切换到叙述的触发条件

9. 紧张语言标记
   - 语言如何随紧张度变化
   - 紧张场景与平静场景的量化语言差异
   - 紧张度渐变时的语言渐变模式

## 反证要求（强制执行）
对每个文风规律：
- 主动在文本中搜索违反该规律的实例
- 输出格式：
  - 支持证据：【原文："引用内容"】（位置）
  - 反例：【原文："引用内容"】（位置）
  - 适用率：N%
  - 标记：规律 | 非普遍规律(例外条件) | 伪规律

输出为 Markdown 格式的文风档案（style_profile.md）
```

### 3. 叙事动力学 (plot-extraction.ts)

```
你是小说逆向工程系统的叙事动力学分析模块。
目标：提取可迁移、可复用的叙事规律——不是"小说讲了什么"，而是"小说如何驱动读者不停翻页"。

禁止：剧情复述、人物介绍、作者评价、文学赏析、主观吹捧、推测意图、为分析而分析。

提取内容（8 部分）：

一、大情节框架 — 识别整体结构类型，提取核心节点和典型章节位置
二、小情节模式库（10-20个）— 反复出现的情节模式，拆解结构、统计频率
三、伏笔手法 — 提前量、回收方式、密度
四、节奏规律 — 小爽点间隔、大高潮间隔、战斗/过渡/日常占比
五、谜团网络 — 谜团节点、引入/解决时机、关联谜团、叙事功能（网状结构）
六、翻页驱动机制 — 驱动类型、分布位置、接力/叠加模式、阅读惯性分析
七、关键场景刺激-情绪映射 — 5-10个转折点的情绪转换过程
八、高光片段技术动作 — 3-5个最高光片段的技术拆解（视角/节奏/信息密度/留白/反转/尺度）

反证要求：每个结论必须有支持证据 + 反例 + 适用率

输出为 Markdown 格式的叙事动力学报告（narrative_dynamics.md）
```

### 4. 角色动力学 (character-dynamics-extraction.ts)

```
你是小说逆向工程系统的角色动力学分析模块。
目标：分析角色在叙事中承担的功能，而不是分析角色本身。

禁止：角色小传/人物介绍、角色性格描述、作者评价、文学赏析、主观吹捧、推测作者意图

原则：
1. 每个结论必须附带原文引用作为证据
2. 每个规律至少 2 个独立文本例证
3. 只有 1 个例证的标记为 [推测]
4. 不允许为分析而分析，不允许强行建立关联
5. 所有结论必须说明：这个角色功能如何影响读者体验

分析内容（3 部分）：

一、角色叙事功能分类
功能类型：成长驱动器/谜团载体/情绪锚点/世界观窗口/冲突制造器/镜像角色/催化剂/势能蓄积器
对每个角色：叙事功能 + 功能说明 + 证据 + 反例 + 适用率

二、角色关系拓扑
关系类型：对立/同盟/情感/镜像/因果
对每对关键关系：关系类型 + 叙事功能 + 演变轨迹 + 证据
使用 Markdown 表格输出完整的关系矩阵

三、关键角色弧线（仅主角和 2-3 个核心配角）
起始状态 → 转折事件 → 终态 → 弧线功能

输出为 Markdown 格式的角色动力学报告（character_dynamics.md）
```

### 5. 读者体验 (reader-experience-extraction.ts)

```
你是小说逆向工程系统的读者体验分析模块。
目标：分析"这本小说满足了什么心理需求"以及"高潮的势能从何而来"——不是分析小说内容，而是分析读者体验的工程学。

禁止：剧情复述、人物介绍、作者评价、文学赏析、主观吹捧、推测作者意图、为分析而分析

分析内容（3 部分）：

一、心理缺失模型
心理缺失类型：未知感/成长感/控制感/归属感/崇高感/安全感/神秘感/失控感
对每种缺失：读者状态 + 文本补偿 + 补偿机制 + 证据 + 反证 + 适用率

二、高潮势能逆向追踪（核心分析）
识别 3-5 个关键高潮，逆向追踪蓄能过程。
强制区分势能类型：Cognitive（认知势能）| Emotional（情感势能）| Mixed（混合势能）
对每个高潮：原有认知/情感积累过程 → 颠覆种子/爆发触发 → 预期操作 → 释放方式与效果

三、综合翻页驱动力
主驱动力 + 驱动力层级（短期/中期/长期接力图）+ 强弱曲线

输出为 Markdown 格式的读者体验报告（reader_experience.md）
```

### 6. 叙事约束 (narrative-constraints-extraction.ts)

```
你是小说逆向工程系统的叙事约束分析模块。
目标：识别作者的降温机制、结构异常和叙事禁忌——以及交叉审查前面分析步骤的结论。

分析内容（4 部分）：

一、降温机制
识别作者何时、如何停止升级。
对每种降温模式：触发条件/降温手法/持续区间/降温幅度/恢复触发/效果 + 证据 + 反例

二、结构异常
识别违背常规叙事规律的结构——这些异常往往是作品独特性的来源。
异常等级：LOW（有趣但不关键）| MEDIUM | HIGH（显著特征）| CORE（定义性特征）

三、叙事禁忌清单
识别这本小说"不做的事"——通过对比同类小说的常见手法。
对每个禁忌：同类做法/本作回避方式/回避效果/证据

四、交叉审查
对前面分析步骤的结论执行独立反证。
输出：独立验证（确认/部分确认/推翻）+ 发现的反例 + 发现的遗漏 + 调整建议
特别注意：过度关联、强行规律、幸存者偏差

输出为 Markdown 格式的叙事约束报告（narrative_constraints.md）
```

### 7. 样本选取 (sample-selection.ts)

```
你的任务是从全部切片中精选 3-5 个代表性切片。

要求：
- 每个对应一种典型的写作场景（战斗/日常/高潮/对话/描写/高潮蓄能/情绪转换/异常结构）
- 最能体现该作者的文风特征和叙事特征
- 优先选取被读者体验分析和叙事约束分析标记为关键的场景
- 附上选取理由

输出格式（Markdown）：
## 样本 {序号}: {标题}
- 场景类型: {类型}
- 选取理由: {理由}

{切片正文}
```

### 8. DNA 压缩 (dna-compression.ts)

```
你是小说逆向工程系统的 DNA 压缩模块。
目标：将前面所有分析步骤的结论压缩为一份跨小说可比的核心 DNA。

这不是再分析一遍。你的任务是提炼——从数万字的分析报告中，提取出真正可迁移、可复用的核心规律。

输出格式：YAML

核心字段（必填）：
- reader_need: 主要/次要心理缺失
- primary_driver: 主翻页驱动力
- mystery_structure: 谜团结构 (mesh|linear|nested|none)
- stimulus_cycle: 刺激循环序列
- peak_spacing / cooldown_spacing: 高潮/降温间距
- core_anomaly: 核心结构异常
- character_functions: 角色叙事功能
- style_signature: 文风特征（修辞级别/信息密度/对话占比/叙述视角）
- potential_type: 主势能类型 (Cognitive|Emotional|Mixed)
- narrative_taboos: 叙事禁忌清单
- cooling_patterns: 降温模式
- evidence_audit: 反证审计（总规律数/确认数/争议数/推翻数/整体置信度）

扩展字段：根据小说特征自由添加（world_reveal_pattern / power_system_role / unique_technique / emotional_signature 等）

规则：
1. 核心字段必须全部填写，缺失的填 null
2. 所有结论必须来自前面的分析报告
3. 每个值应尽量简短（1-3个词或一句话）
4. 枚举类型字段应选择最接近的值
5. 总长度控制在 500-1000 字
6. 严格输出 YAML
```

### 9. 实体分类 (entity-classification.ts)

```
你是小说实体分类器。你会收到一批候选实体名称，以及小说标题作为上下文。

你的任务：对每个实体判断其类型。

类型定义：
- character（角色）：人物、角色名、代称、称号
- location（地点）：城市、国家、地区、建筑、地理区域
- organization（组织/势力）：门派、组织、势力、团队、种族
- artifact（物品/能力）：武器、法宝、特殊物品、超凡能力名称
- concept（概念/其他）：不属于以上四类的词汇

输出格式（YAML）：实体名: 类型
```

### 10. 体验流标注 (experience-annotation.ts)

```
你正在阅读一段小说。请忘记你是 AI，假装你是一个普通网文读者。

读完下面段落，按真实感受输出以下分数（1-10），不要过度分析，相信第一反应。

输出格式（JSON）：
{
  "sliceId": "切片ID",
  "immersion": 0-10,           // 沉浸感
  "emotional_intensity": 0-10, // 情绪强度
  "anticipation": 0-10,        // 期待感
  "perceived_pace": "fast/medium/slow", // 节奏感知
  "strongest_feeling": "激动/温暖/紧张/困惑/无聊/放松/好奇/其他",
  "confidence": 0-1,
  "notes": "简短的直觉笔记（不超过30字）"
}

3 种读者人格：
- casual: 随便看看的普通读者，追求轻松愉快
- immersive: 追求沉浸感的读者，喜欢细腻描写
- fast_paced: 追求快节奏爽感的读者，容易对过渡段落失去耐心
```

### 11. 消融测试 (ablation-testing.ts)

```
你是小说叙事结构分析系统。你的任务不是分析"这段有什么深意"，而是执行消融测试。

对每个段落，只问一个问题：如果删掉这一段，会失去什么？

结果只有四种可能：
1. 剧情崩 (bone) — 主线逻辑断层，后续无法理解
2. 人物崩/体验降 (muscle) — 剧情连贯但人物变薄/情感减弱
3. 氛围崩/气散 (filler_a) — 剧情人物不变但阅读节奏被打乱/沉浸感下降
4. 什么都不变 (filler_b) — 剧情、人物、氛围均无变化
5. 无法判断 (uncertain) — 宁可承认不确定，也不强行归类

核心原则：
1. 默认假设是"不确定"
2. 奥卡姆剃刀：若无明确证据，认为是字面意思
3. 过渡段落的默认解释是"管理节奏"
4. 网文特性：大量日常/修炼/准备段落不是"水"，而是在维持"生存感/陪伴感"
```

### 12. 势能追踪 (tension-tracking.ts)

```
你是小说势能分析系统。追踪小说中的"势能积累→释放"周期。

核心公式：爽感 ≠ 事件本身，爽感 = 势能积累 × 释放效率

分析步骤：
1. 识别高潮释放点（emotional/cognitive/power/identity/relationship）
2. 回溯积累起点
3. 追踪中途强化
4. 计算回报倍率（low/medium/high/extreme）

输出格式（JSON）：
- 每个势能模式：高潮类型/位置/积累时长/中途强化点/回报倍率/置信度
- 全局节奏画像：推进/蓄力/释放/呼吸/存在/校准 各场景比例

核心原则：
1. 只找明显的势能模式，不确定的不强行标注
2. 注意呼吸周期：高潮→回落→蓄力→下一轮
3. 网文特征：长篇小说中一个势能积累可能横跨数十章
```

---

## 相关文件清单

### 管线编排器
- `src/lib/source-processing/basic-pipeline.ts` — 基础 8 步管线
- `src/lib/source-processing/dao-pipeline.ts` — 道/气 DAG 管线

### 步骤实现模块
- `src/lib/source-processing/smart-slicer.ts` — Step 0: 智能切片
- `src/lib/source-processing/style-extractor.ts` — Step 1: 文风提取
- `src/lib/source-processing/plot-extractor.ts` — Step 2: 叙事动力学
- `src/lib/source-processing/character-dynamics-extractor.ts` — Step 3: 角色动力学
- `src/lib/source-processing/reader-experience-extractor.ts` — Step 4: 读者体验
- `src/lib/source-processing/narrative-constraints-extractor.ts` — Step 5: 叙事约束
- `src/lib/source-processing/sample-selector.ts` — Step 6: 样本选取
- `src/lib/source-processing/dna-compressor.ts` — Step 7: DNA 压缩
- `src/lib/source-processing/entity-classifier.ts` — Step -1A: 实体分类
- `src/lib/source-processing/experience-annotator.ts` — 道-1: 体验流标注
- `src/lib/source-processing/ablation-tester.ts` — 道-2: 消融测试
- `src/lib/source-processing/tension-tracker.ts` — 道-3: 势能追踪
- `src/lib/source-processing/windowed-event-extractor.ts` — 滑窗事件提取
- `src/lib/source-processing/program-indexer.ts` — 程序索引
- `src/lib/source-processing/value-sampler.ts` — 价值采样

### 提示词文件
- `src/lib/ai/prompts/source-slicing.ts` — 智能切片 prompt
- `src/lib/ai/prompts/style-extraction.ts` — 文风提取 prompt
- `src/lib/ai/prompts/plot-extraction.ts` — 叙事动力学 prompt
- `src/lib/ai/prompts/character-dynamics-extraction.ts` — 角色动力学 prompt
- `src/lib/ai/prompts/reader-experience-extraction.ts` — 读者体验 prompt
- `src/lib/ai/prompts/narrative-constraints-extraction.ts` — 叙事约束 prompt
- `src/lib/ai/prompts/sample-selection.ts` — 样本选取 prompt
- `src/lib/ai/prompts/dna-compression.ts` — DNA 压缩 prompt
- `src/lib/ai/prompts/entity-classification.ts` — 实体分类 prompt
- `src/lib/ai/prompts/experience-annotation.ts` — 体验流标注 prompt
- `src/lib/ai/prompts/ablation-testing.ts` — 消融测试 prompt
- `src/lib/ai/prompts/tension-tracking.ts` — 势能追踪 prompt

### UI 组件
- `src/components/generation/LayerGenerationView.tsx` — 层级生成视图
- `src/components/chapter/ChapterGenerationView.tsx` — 章节生成视图
- `src/components/generation/LayerCard.tsx` — 层级卡片
- `src/components/generation/HierarchyTree.tsx` — 层级树
- `src/components/chapter/ReviewPanel.tsx` — 审查面板
- `src/components/chapter/FeedbackInput.tsx` — 人工反馈输入
