// ============================================
// TXT 文件解析 + 智能采样算法
// ============================================

import { nanoid } from 'nanoid';
import type { ParsedNovel } from '@/types';

/**
 * 解析上传的 TXT 文件
 */
export function parseTxtFile(file: File): Promise<ParsedNovel> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        reject(new Error('文件读取失败'));
        return;
      }
      const title = file.name.replace(/\.txt$/i, '');
      const totalChars = text.length;
      const sampleText = smartSample(text);

      resolve({
        id: nanoid(),
        title,
        totalChars,
        fullText: text,
        sampleText,
      });
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

/**
 * 智能采样算法
 * - < 8万字：全文送入
 * - 8-30万字：采样（开头 + 中间 + 结尾 + 随机片段）
 * - > 30万字：多段采样，总计约 6 万字
 */
export function smartSample(text: string): string {
  const CHAR_LIMIT = 80000;

  if (text.length <= CHAR_LIMIT) {
    return text;
  }

  // 按章节分割（常见的章节标记）
  const chapterPattern = /第[零一二三四五六七八九十百千万\d]+[章节回卷集部篇]/g;
  const chapters = splitByPattern(text, chapterPattern);

  if (chapters.length <= 3) {
    // 没有明显章节分割，按固定长度采样
    return fixedLengthSample(text, CHAR_LIMIT);
  }

  // 有章节结构：开头3章 + 中间3章 + 结尾3章 + 随机2章
  const result: string[] = [];
  const take = (arr: string[], indices: number[]) => {
    for (const i of indices) {
      if (i >= 0 && i < arr.length && arr[i].trim()) {
        result.push(arr[i]);
      }
    }
  };

  // 开头
  take(chapters, [0, 1, 2]);
  // 中间
  const mid = Math.floor(chapters.length / 2);
  take(chapters, [mid - 1, mid, mid + 1]);
  // 结尾
  take(chapters, [chapters.length - 3, chapters.length - 2, chapters.length - 1]);
  // 随机
  const picked = new Set(result);
  let randomCount = 0;
  for (let attempts = 0; attempts < 20 && randomCount < 2; attempts++) {
    const idx = Math.floor(Math.random() * chapters.length);
    if (!picked.has(chapters[idx]) && chapters[idx].trim()) {
      result.push(chapters[idx]);
      randomCount++;
    }
  }

  let sampled = result.join('\n\n');

  // 如果还是太长，截断
  if (sampled.length > CHAR_LIMIT) {
    sampled = sampled.slice(0, CHAR_LIMIT);
  }

  return sampled;
}

/** 按正则模式分割文本 */
function splitByPattern(text: string, pattern: RegExp): string[] {
  const parts: string[] = [];
  let lastIndex = 0;

  const regex = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    lastIndex = match.index;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

/** 无章节标记时的固定长度采样 */
function fixedLengthSample(text: string, limit: number): string {
  const headLen = Math.floor(limit * 0.3);
  const tailLen = Math.floor(limit * 0.2);
  const midStart = Math.floor(text.length / 2) - Math.floor(limit * 0.25);

  const head = text.slice(0, headLen);
  const mid = text.slice(Math.max(0, midStart), midStart + Math.floor(limit * 0.25));
  const tail = text.slice(text.length - tailLen);

  return `${head}\n\n……（中间省略）……\n\n${mid}\n\n……（中间省略）……\n\n${tail}`;
}

/** 格式化字数显示 */
export function formatCharCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万字`;
  }
  return `${count}字`;
}
