// ============================================
// TXT 文本清洗 — 过滤网络小说噪声 + 标点规范化
// ============================================
// 参考项目：txt_reform、text_edit、novel-proofer、nanoWriter、novel-proofreader

import type { CleaningConfig, CleaningStepId } from '@/types';

/** 全部 10 个清洗步骤 ID */
export const ALL_CLEANING_STEPS: CleaningStepId[] = [
  'encoding', 'urls', 'promos', 'authorNotes', 'watermarks',
  'nav', 'separators', 'toc', 'punctuation', 'blankLines',
];

/** 预设对应的步骤列表（模块级常量，避免每次调用重新分配） */
const STEPS_STANDARD = ALL_CLEANING_STEPS.filter(
  (s) => s !== 'promos' && s !== 'authorNotes',
);
const STEPS_LIGHT: CleaningStepId[] = ['encoding', 'punctuation', 'blankLines'];

/** 根据 CleaningConfig 解析出需要执行的步骤列表 */
export function resolveCleaningSteps(config: CleaningConfig): CleaningStepId[] {
  switch (config.preset) {
    case 'aggressive':
      return ALL_CLEANING_STEPS;
    case 'standard':
      return STEPS_STANDARD;
    case 'light':
      return STEPS_LIGHT;
    case 'none':
      return config.enabledSteps;
    default:
      // 防御性回退：未知预设 → 运行全部步骤
      console.warn(`Unknown cleaning preset: "${config.preset}", falling back to aggressive`);
      return ALL_CLEANING_STEPS;
  }
}

// ---- Step 1: 编码清理 ----

/** 去掉 BOM、零宽字符、替换字符、控制字符，统一换行 */
export function stripEncodingArtifacts(text: string): string {
  return text
    .replace(/^﻿/, '')                                          // UTF-8 BOM
    .replace(/[​‌‍﻿­�]/g, '')         // 零宽/软连字符/替换
    .replace(/\r\n/g, '\n')                                          // CRLF → LF
    .replace(/\r/g, '\n')                                            // CR → LF
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');             // 控制字符
}

// ---- Step 2: URL 行 ----

const URL_LINE_RE = /^(?:https?:\/\/|www\.)\S+$/i;

/** 删除整行都是 URL 的行 */
export function removeUrlLines(lines: string[]): string[] {
  return lines.filter((line) => !URL_LINE_RE.test(line.trim()));
}

// ---- Step 3: 广告/推广行 ----

const PROMO_PATTERNS: RegExp[] = [
  /本章未完.*继续/,
  /最新章节/,
  /本书由.*首发/,
  /无弹窗/,
  /免费阅读/,
  /记住.*网址/,
  /纯文字.*首发/,
  /更新最快/,
  /天才一秒记住/,
  /新笔下文学/,
  /吾爱文学/,
  /笔趣阁/,
  /起点中文网/,
  /创世中文网/,
  /纵横中文网/,
  /小说阅读网/,
];

/** 删除广告推广行 */
export function removePromoLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    if (!t) return true; // 保留空行
    return !PROMO_PATTERNS.some((p) => p.test(t));
  });
}

// ---- Step 4: 作者碎碎念 ----

const AUTHOR_NOTE_PATTERNS: RegExp[] = [
  /^ps[\s:：]/i,
  /^作者[说有感]/,
  /求[月票推荐票收藏打赏订阅阅]/,
  /投[推荐票月票]/,
  /本章[说福利]/,
];

/** 删除作者碎碎念行（安全阀：>40字保留，以。结尾保留） */
export function removeAuthorNoteLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (t.length > 40) return true;        // 长度安全阀
    if (t.endsWith('。')) return true;      // 句末标点排除（txt_reform StrictEnd 思路）
    return !AUTHOR_NOTE_PATTERNS.some((p) => p.test(t));
  });
}

// ---- Step 5: 水印/来源行 ----

const WATERMARK_PATTERNS: RegExp[] = [
  /本小说来自/,
  /[Tt][Xx][Tt]小说下载/,
  /电子书下载/,
  /更多好书/,
  /全集下载/,
  /\.txt下载/i,
  /小说论坛/,
  /书友[群号]/,
  /QQ[群号]/,
  /微信[公号群]/,
];

/** 删除水印/来源行（40字安全阀） */
export function removeWatermarkLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (t.length > 40) return true;
    return !WATERMARK_PATTERNS.some((p) => p.test(t));
  });
}

// ---- Step 6: 导航行 ----

const NAV_EXACT = new Set([
  '上一章', '下一章', '返回目录', '返回书页', '返回列表', '上一页', '下一页',
  '上一章]', '[下一章', '[返回目录]',
]);

/** 删除导航行（20字安全阀） */
export function removeNavLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (t.length > 20) return true;
    // 精确匹配
    if (NAV_EXACT.has(t)) return false;
    // 方括号包裹的导航 [xxx]
    if (/^\[.+\]$/.test(t) && t.length <= 12) {
      const inner = t.slice(1, -1);
      if (NAV_EXACT.has(inner)) return false;
    }
    return true;
  });
}

// ---- Step 7: 分隔线 ----

/** 由重复符号组成的分隔线（至少3个连续相同符号），>5字才删 */
export function removeSeparatorLines(lines: string[]): string[] {
  const SEP_RE = /^([-=*_—])\1{2,}$/;
  return lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (t.length <= 5) return true;        // 短行保留
    return !SEP_RE.test(t);
  });
}

// ---- Step 8: 目录块 ----

const CHAPTER_TITLE_RE = /^第[零一二三四五六七八九十百千万〇\d]+[章节回卷集部篇].{0,30}$/;
const BOOK_PART_RE = /^(序章|序言|前言|引子|楔子|尾声|后记|番外[一二三四五六七八九十\d]{0,3})(\s.*)?$/;

function isChapterTitleLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 35 && (CHAPTER_TITLE_RE.test(t) || BOOK_PART_RE.test(t));
}

/** 删除连续 3+ 个章节标题行组成的目录块 */
export function removeTocBlocks(lines: string[]): string[] {
  const marks = lines.map((l) => isChapterTitleLine(l));

  const toRemove = new Set<number>();
  let runStart = -1;
  let runCount = 0;

  const flushRun = (end: number) => {
    if (runCount >= 3) {
      for (let j = runStart; j < end; j++) {
        if (marks[j] || lines[j].trim() === '') {
          toRemove.add(j);
        }
      }
    }
    runStart = -1;
    runCount = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    if (marks[i]) {
      if (runStart === -1) runStart = i;
      runCount++;
    } else if (lines[i].trim() === '') {
      // 空行在目录块中间 → 继续扫描
      continue;
    } else {
      flushRun(i);
    }
  }
  flushRun(lines.length);

  return lines.filter((_, i) => !toRemove.has(i));
}

// ---- Step 9: 标点规范化（novel-proofer CJK 上下文感知） ----

/** CJK 字符范围，用于上下文感知判断 */
const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af';

/** 省略号/破折号/标点规范化（只在中日韩上下文中转换） */
export function normalizePunctuation(text: string): string {
  let t = text;

  // 省略号规范化
  t = t.replace(/\.{3,}/g, '……');            // ... → ……
  t = t.replace(/[。．｡]{3,}/g, '……');       // 。。。→ ……
  t = t.replace(/…{3,}/g, '……');              // ……… → ……

  // 破折号规范化
  t = t.replace(/[-—]{2,}/g, '——');            // ---/———→ ——

  // CJK 上下文感知：ASCII 标点 → 全角（数字中不变）
  // 逗号：CJK 旁边的 , → ，（数字中不转）
  t = t.replace(new RegExp(`(?<=[${CJK}])(?<!\\d),(?!\\d)`, 'g'), '，');
  t = t.replace(new RegExp(`(?<!\\d),(?!\\d)(?=[${CJK}])`, 'g'), '，');

  // 分号
  t = t.replace(new RegExp(`(?<=[${CJK}]);`, 'g'), '；');

  // 冒号
  t = t.replace(new RegExp(`(?<=[${CJK}]):`, 'g'), '：');

  // 问号
  t = t.replace(new RegExp(`(?<=[${CJK}])\\?`, 'g'), '？');

  // 感叹号
  t = t.replace(new RegExp(`(?<=[${CJK}])!`, 'g'), '！');

  // 句号：CJK 后面且后面是 CJK/空白/结尾/右标点（数字中不转）
  const CLOSING = '"\'"\'"\\u201c\\u201d\\u2018\\u2019)\\]\\u3011\\u300b\\u300d\\u300f';
  t = t.replace(
    new RegExp(`(?<=[${CJK}])\\.(?=(?:[${CJK}]|\\s|$|[${CLOSING}]))`, 'g'),
    '。',
  );

  // 括号：CJK 旁边 () → （）
  t = t.replace(new RegExp(`(?<=[${CJK}])\\(`, 'g'), '（');
  t = t.replace(new RegExp(`\\)(?=[${CJK}])`, 'g'), '）');
  t = t.replace(new RegExp(`\\((?=[${CJK}])`, 'g'), '（');

  // CJK 和标点之间的空格删除
  t = t.replace(new RegExp(`(?<=[${CJK}])[ \\t]+(?=[，。！？；：、,.!?;:])`, 'g'), '');
  t = t.replace(new RegExp(`(?<=[，。！？；：、,.!?;:])[ \\t]+(?=[${CJK}])`, 'g'), '');

  return t;
}

// ---- Step 10: 空行整理 ----

/** 3+ 连续空行压缩为 2，首尾 trim */
export function collapseBlankLines(text: string): string {
  return text
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// ============================================
// 主管道
// ============================================

/** 清洗网络小说 TXT 文本（可选 CleaningConfig，不传则默认运行全部步骤） */
export function cleanNovelText(raw: string, config?: CleaningConfig): string {
  const steps = config ? resolveCleaningSteps(config) : ALL_CLEANING_STEPS;

  // Step 1: 编码清理
  let text = steps.includes('encoding') ? stripEncodingArtifacts(raw) : raw;

  // Step 2-8: 按行过滤
  let lines = text.split('\n');
  if (steps.includes('urls')) lines = removeUrlLines(lines);
  if (steps.includes('promos')) lines = removePromoLines(lines);
  if (steps.includes('authorNotes')) lines = removeAuthorNoteLines(lines);
  if (steps.includes('watermarks')) lines = removeWatermarkLines(lines);
  if (steps.includes('nav')) lines = removeNavLines(lines);
  if (steps.includes('separators')) lines = removeSeparatorLines(lines);
  if (steps.includes('toc')) lines = removeTocBlocks(lines);

  // 合并
  text = lines.join('\n');

  // Step 9: 标点规范化
  if (steps.includes('punctuation')) text = normalizePunctuation(text);

  // Step 10: 空行整理
  if (steps.includes('blankLines')) text = collapseBlankLines(text);

  return text;
}
