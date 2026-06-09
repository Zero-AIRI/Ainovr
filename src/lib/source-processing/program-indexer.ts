// ============================================
// Step -1A: 程序索引 — 从原文提取实体索引
// 90% 程序 + 10% AI（仅最后分类用）
// ============================================

import type { EntityIndex } from '@/types';

// ---- 中文停用词表（核心子集） ----
const STOP_WORDS = new Set([
  // 代词
  '他', '她', '它', '我', '你', '我们', '你们', '他们', '她们', '它们',
  '自己', '这', '那', '这个', '那个', '什么', '怎么', '为什么',
  '哪', '哪里', '谁', '多少', '怎样',
  // 介词/连词
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '他', '她', '它', '吗', '吧', '啊', '呢', '哦',
  '哈', '嗯', '呀', '嘛', '啦', '喔', '嘿', '哎', '唉', '嗨',
  // 量词
  '个', '只', '把', '条', '件', '次', '位', '种', '样', '份', '群', '批',
  '些', '点', '段', '间', '年', '月', '日', '天', '时', '分', '秒',
  // 方位
  '里', '外', '前', '后', '左', '右', '上', '下', '中', '内', '旁',
  // 常见动词/形容词（太泛，无区分度）
  '知道', '可以', '已经', '应该', '可能', '需要', '开始', '继续',
  '正在', '一直', '虽然', '但是', '因为', '所以', '如果', '不过',
  '然后', '之后', '之后', '以前', '以后', '之间', '关于', '对于',
  '但是', '而且', '或者', '还是', '不过', '只是', '已经', '正在',
  '这个', '那个', '这些', '那些', '什么', '怎样', '如何', '为什么',
  '今天', '明天', '昨天', '现在', '时候', '地方', '东西', '问题',
  '时候', '样子', '事情', '道理', '办法', '关系', '意思', '感觉',
  '忽然', '突然', '立刻', '马上', '终于', '竟然', '果然', '居然',
  '慢慢', '渐渐', '轻轻', '默默', '悄悄',
  // 时间词
  '早上', '中午', '下午', '晚上', '白天', '夜晚', '早上', '今天',
  '昨天', '明天', '早上', '上午',
]);

// ---- 对话标记（出现在角色名附近的词） ----
const DIALOGUE_MARKERS = [
  '说道', '道', '问道', '喊道', '叫道', '笑道', '冷笑道', '低声道',
  '说道', '怒道', '沉声道', '大声道', '轻声道', '缓缓道', '淡淡道',
  '看着', '看向', '望着', '盯着', '凝视着', '瞥了', '扫了一眼',
  '回答', '问道', '说了', '吼道', '喝道', '催促道', '建议道',
  '说', '问', '喊', '叫', '笑', '吼', '喝',
];

// ---- 章节边界正则 ----
const CHAPTER_REGEX = /第[零一二三四五六七八九十百千万\d]+[章节回卷集部篇]/g;

/**
 * 从原文中提取候选实体（第一层：纯程序）
 * 使用 n-gram 统计 + 对话标记检测
 */
export function extractCandidateEntities(rawText: string): Map<string, { frequency: number; contexts: string[] }> {
  const candidates = new Map<string, { frequency: number; contexts: string[] }>();

  // 1. 提取2-4字 n-gram
  // 只在非空白、非标点的中文字符序列上统计
  const chineseText = rawText.replace(/[^一-鿿]/g, ' ');

  for (let n = 2; n <= 4; n++) {
    const segments = chineseText.split(/\s+/).filter(s => s.length >= n);
    for (const seg of segments) {
      for (let i = 0; i <= seg.length - n; i++) {
        const gram = seg.slice(i, i + n);
        if (STOP_WORDS.has(gram)) continue;
        // 过滤纯数字、纯标点
        if (/^[零一二三四五六七八九十百千万\d]+$/.test(gram)) continue;

        const entry = candidates.get(gram) || { frequency: 0, contexts: [] };
        entry.frequency++;
        candidates.set(gram, entry);
      }
    }
  }

  // 2. 利用对话标记提取特殊实体
  // 匹配模式："XX说道" "XX看着" 等
  for (const marker of DIALOGUE_MARKERS) {
    const regex = new RegExp(`([\\u4e00-\\u9fff]{2,4})${escapeRegex(marker)}`, 'g');
    let match;
    while ((match = regex.exec(rawText)) !== null) {
      const name = match[1];
      if (!STOP_WORDS.has(name) && name.length >= 2) {
        const entry = candidates.get(name) || { frequency: 0, contexts: [] };
        entry.frequency++;
        if (entry.contexts.length < 3) {
          // 保存一小段上下文（前后各10字）
          const start = Math.max(0, match.index - 10);
          const end = Math.min(rawText.length, match.index + name.length + marker.length + 10);
          entry.contexts.push(rawText.slice(start, end));
        }
        candidates.set(name, entry);
      }
    }
  }

  return candidates;
}

/**
 * 统计过滤（第二层）
 * 过滤停用词、低频项、普通名词
 */
export function filterCandidates(
  candidates: Map<string, { frequency: number; contexts: string[] }>,
  totalChars: number,
): Map<string, { frequency: number; contexts: string[] }> {
  // 动态最低频率：按文本长度调整
  // 10万字以下：3次；50万字：5次；200万字：8次
  const minFreq = totalChars < 100000 ? 3 : totalChars < 500000 ? 5 : 8;

  // 最大保留实体数
  const maxEntities = totalChars < 50000 ? 80 : totalChars < 500000 ? 200 : 300;

  const filtered = new Map<string, { frequency: number; contexts: string[] }>();

  // 按频率排序
  const sorted = [...candidates.entries()]
    .filter(([name, data]) => {
      if (data.frequency < minFreq) return false;
      if (STOP_WORDS.has(name)) return false;
      // 过滤纯方位词、纯时间词
      if (/^[上下左右前后内外中东西南北]+$/.test(name)) return false;
      // 过滤以"的""了"结尾的短语
      if (name.endsWith('的') || name.endsWith('了') || name.endsWith('着')) return false;
      // 过滤章节标题词
      if (/^第[零一二三四五六七八九十百千万\d]+/.test(name)) return false;
      return true;
    })
    .sort((a, b) => b[1].frequency - a[1].frequency);

  for (let i = 0; i < Math.min(sorted.length, maxEntities); i++) {
    const [name, data] = sorted[i];
    filtered.set(name, data);
  }

  return filtered;
}

/**
 * 检测别名（同一个实体的不同称呼）
 * 简单策略：如果两个高频实体A和B，且B完全包含在A的上下文中频繁共现，可能是别名
 */
export function detectAliases(
  filtered: Map<string, { frequency: number; contexts: string[] }>,
): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const names = [...filtered.keys()];

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];

      // 如果一个名字包含另一个，可能是全名/简称
      if (a.includes(b) || b.includes(a)) {
        // 较长的作为主名
        const primary = a.length >= b.length ? a : b;
        const secondary = a.length >= b.length ? b : a;
        const existing = aliases.get(primary) || [];
        if (!existing.includes(secondary)) {
          existing.push(secondary);
          aliases.set(primary, existing);
        }
      }
    }
  }

  return aliases;
}

/**
 * 构建每个实体出现在哪些章节/位置
 */
export function buildEntityOccurrences(
  rawText: string,
  entityNames: string[],
): Map<string, string[]> {
  const occurrences = new Map<string, string[]>();

  // 先找章节边界
  const chapters: { title: string; start: number; end: number }[] = [];
  let match;
  const regex = new RegExp(CHAPTER_REGEX.source, 'g');
  while ((match = regex.exec(rawText)) !== null) {
    chapters.push({
      title: match[0],
      start: match.index,
      end: 0,
    });
  }
  // 设置 end
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].end = i + 1 < chapters.length ? chapters[i + 1].start : rawText.length;
  }

  // 对每个实体，统计出现在哪些章节
  for (const name of entityNames) {
    const positions: number[] = [];
    let searchStart = 0;
    while (true) {
      const idx = rawText.indexOf(name, searchStart);
      if (idx === -1) break;
      positions.push(idx);
      searchStart = idx + name.length;
      // 最多采样1000个位置
      if (positions.length >= 1000) break;
    }

    // 映射到章节
    const chapterTitles = new Set<string>();
    for (const pos of positions) {
      for (const ch of chapters) {
        if (pos >= ch.start && pos < ch.end) {
          chapterTitles.add(ch.title);
          break;
        }
      }
    }

    occurrences.set(name, [...chapterTitles]);
  }

  return occurrences;
}

/**
 * 构建完整的 EntityIndex（综合上面所有步骤）
 * 注意：type 字段留给 AI 分类步骤填充，这里默认 'concept'
 */
export function buildEntityIndex(
  rawText: string,
  candidates: Map<string, { frequency: number; contexts: string[] }>,
  aliases: Map<string, string[]>,
  occurrences: Map<string, string[]>,
): EntityIndex {
  const index: EntityIndex = {};

  for (const [name, data] of candidates) {
    const entityAliases = aliases.get(name) || [];
    index[name] = {
      type: 'concept', // 默认类型，AI分类步骤会更新
      aliases: entityAliases,
      frequency: data.frequency,
      occurrences: occurrences.get(name) || [],
      segments: [], // Step -1B 填充
    };
  }

  return index;
}

/**
 * 按类型拆分 EntityIndex 为子索引
 */
export function splitEntityIndex(index: EntityIndex): {
  characterIndex: EntityIndex;
  locationIndex: EntityIndex;
  organizationIndex: EntityIndex;
  artifactIndex: EntityIndex;
  conceptIndex: EntityIndex;
} {
  const characterIndex: EntityIndex = {};
  const locationIndex: EntityIndex = {};
  const organizationIndex: EntityIndex = {};
  const artifactIndex: EntityIndex = {};
  const conceptIndex: EntityIndex = {};

  for (const [name, entry] of Object.entries(index)) {
    switch (entry.type) {
      case 'character':
        characterIndex[name] = entry;
        break;
      case 'location':
        locationIndex[name] = entry;
        break;
      case 'organization':
        organizationIndex[name] = entry;
        break;
      case 'artifact':
        artifactIndex[name] = entry;
        break;
      case 'concept':
        conceptIndex[name] = entry;
        break;
    }
  }

  return { characterIndex, locationIndex, organizationIndex, artifactIndex, conceptIndex };
}

/**
 * 主入口：执行完整的 Step -1A 程序索引（不含AI分类）
 */
export function runProgramIndexing(rawText: string): {
  entityIndex: EntityIndex;
  candidateNames: string[];
} {
  // Layer 1: 提取候选实体
  const candidates = extractCandidateEntities(rawText);

  // Layer 2: 过滤
  const filtered = filterCandidates(candidates, rawText.length);

  // 别名检测
  const aliases = detectAliases(filtered);

  // 构建位置索引
  const names = [...filtered.keys()];
  const occurrences = buildEntityOccurrences(rawText, names);

  // 综合为 EntityIndex
  const entityIndex = buildEntityIndex(rawText, filtered, aliases, occurrences);

  return {
    entityIndex,
    candidateNames: names,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
