// ============================================
// 小说分块 — 章节级简单分块
// ============================================

import { nanoid } from 'nanoid';
import type { NovelChunk } from '@/types';

/** 章节检测正则 */
export const CHAPTER_PATTERN = /第[零一二三四五六七八九十百千万\d]+[章节回卷集部篇]/g;

/** 默认每块最大字符数 */
export const DEFAULT_MAX_CHUNK_SIZE = 8000;

/** 无章节时的默认分段大小 */
export const DEFAULT_SEGMENT_SIZE = 5000;

/**
 * 将清洗后的全文分割成 NovelChunk[]
 *
 * 策略：
 * 1. 尝试按章节标题分割
 * 2. 如果检测到 >=2 个章节，每个章节成为一个 chunk
 * 3. 单个 chunk 超过 maxChunkSize 时，在段落边界处进一步分割
 * 4. 无章节结构时，按 ~segmentSize 字符在段落边界处分割
 */
export function chunkText(
  novelId: string,
  fullText: string,
  maxChunkSize: number = DEFAULT_MAX_CHUNK_SIZE,
): NovelChunk[] {
  if (!fullText.trim()) return [];

  // 查找所有章节标题及其位置
  const markers = findChapterMarkers(fullText);

  if (markers.length >= 2) {
    return chunkByChapters(novelId, fullText, markers, maxChunkSize);
  }

  // 无章节结构：按固定大小分段
  return chunkBySegments(novelId, fullText, DEFAULT_SEGMENT_SIZE, maxChunkSize);
}

/** 章节标题行匹配（章节标记 + 同行剩余文本） */
const CHAPTER_LINE = /第[零一二三四五六七八九十百千万\d]+[章节回卷集部篇][^\n]*/g;

interface ChapterMarker {
  index: number;
  title: string;
}

function findChapterMarkers(text: string): ChapterMarker[] {
  const markers: ChapterMarker[] = [];
  const regex = new RegExp(CHAPTER_LINE.source, 'g');
  let match;
  while ((match = regex.exec(text)) !== null) {
    markers.push({ index: match.index, title: match[0].trim() });
  }
  return markers;
}

/** 按章节分块 */
function chunkByChapters(
  novelId: string,
  text: string,
  markers: ChapterMarker[],
  maxChunkSize: number,
): NovelChunk[] {
  const chunks: NovelChunk[] = [];

  const addChunk = (content: string, title: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    if (trimmed.length > maxChunkSize) {
      // 超大章节：在段落边界分割
      const parts = splitAtParagraphs(trimmed, maxChunkSize);
      for (let i = 0; i < parts.length; i++) {
        const partTitle = parts.length > 1 ? `${title}（${i + 1}/${parts.length}）` : title;
        chunks.push({
          id: nanoid(),
          novelId,
          index: chunks.length,
          title: partTitle,
          content: parts[i],
          charCount: parts[i].length,
        });
      }
    } else {
      chunks.push({
        id: nanoid(),
        novelId,
        index: chunks.length,
        title,
        content: trimmed,
        charCount: trimmed.length,
      });
    }
  };

  // 第一个章节之前的内容 → "前言/简介"
  if (markers[0].index > 0) {
    const preface = text.slice(0, markers[0].index).trim();
    if (preface) {
      addChunk(preface, '前言/简介');
    }
  }

  // 每个章节
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    addChunk(text.slice(start, end), markers[i].title);
  }

  return chunks;
}

/** 在段落边界（双换行）处将文本分割为不超过 maxSize 的片段 */
function splitAtParagraphs(text: string, maxSize: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const result: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > maxSize) {
      result.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  // 极端情况：某段落本身就超过限制 → 硬截断
  if (result.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += maxSize) {
      result.push(text.slice(i, i + maxSize));
    }
  }

  return result;
}

/** 无章节时按固定大小分段 */
function chunkBySegments(
  novelId: string,
  text: string,
  segmentSize: number,
  maxChunkSize: number,
): NovelChunk[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: NovelChunk[] = [];
  let current = '';
  let partIndex = 0;

  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > segmentSize) {
      // 检查合并后的块是否超标
      const trimmed = current.trim();
      if (trimmed.length > maxChunkSize) {
        const parts = splitAtParagraphs(trimmed, maxChunkSize);
        for (const part of parts) {
          partIndex++;
          chunks.push({
            id: nanoid(),
            novelId,
            index: chunks.length,
            title: `第${partIndex}部分`,
            content: part,
            charCount: part.length,
          });
        }
      } else {
        partIndex++;
        chunks.push({
          id: nanoid(),
          novelId,
          index: chunks.length,
          title: `第${partIndex}部分`,
          content: trimmed,
          charCount: trimmed.length,
        });
      }
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }

  // 最后一段
  if (current.trim()) {
    const trimmed = current.trim();
    if (trimmed.length > maxChunkSize) {
      const parts = splitAtParagraphs(trimmed, maxChunkSize);
      for (const part of parts) {
        partIndex++;
        chunks.push({
          id: nanoid(),
          novelId,
          index: chunks.length,
          title: `第${partIndex}部分`,
          content: part,
          charCount: part.length,
        });
      }
    } else {
      partIndex++;
      chunks.push({
        id: nanoid(),
        novelId,
        index: chunks.length,
        title: `第${partIndex}部分`,
        content: trimmed,
        charCount: trimmed.length,
      });
    }
  }

  return chunks;
}
