// ============================================
// 智能切片 — 客户端编排模块
// ============================================

import type { SemanticSlice } from '@/types';
import { buildSlicingMessages } from '@/lib/ai/prompts';
import { chunkText, DEFAULT_MAX_CHUNK_SIZE } from '@/lib/chunker';

/** 解析 AI 输出的切片 markdown 为 SemanticSlice[] */
export function parseSliceOutput(raw: string, novelId: string): SemanticSlice[] {
  const slices: SemanticSlice[] = [];
  const sections = raw.split(/^## 切片 /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split('\n');
    const headerLine = lines[0] ?? '';
    const titleMatch = headerLine.match(/^\d+:\s*(.+)/);

    // 提取元数据
    let semanticTags: string[] = [];
    let plotArc = '';
    let emotionalTone = '';
    let contentStartIndex = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('- 语义标签:')) {
        semanticTags = line.replace('- 语义标签:', '').split(',').map((s) => s.trim()).filter(Boolean);
      } else if (line.startsWith('- 情节弧线:')) {
        plotArc = line.replace('- 情节弧线:', '').trim();
      } else if (line.startsWith('- 情绪基调:')) {
        emotionalTone = line.replace('- 情绪基调:', '').trim();
      } else if (line === '---' || (line && !line.startsWith('-') && contentStartIndex === 0)) {
        // 找到正文开始位置
        if (contentStartIndex === 0) contentStartIndex = i;
        break;
      }
    }

    // 如果没找到明确的正文开始位置，跳过元数据行后开始
    if (contentStartIndex === 0) {
      contentStartIndex = lines.findIndex((l, i) => i > 0 && !l.startsWith('-') && l.trim() !== '' && l.trim() !== '---');
      if (contentStartIndex === -1) contentStartIndex = lines.length;
    }

    const content = lines.slice(contentStartIndex).join('\n').replace(/^---\s*/m, '').trim();

    if (content) {
      slices.push({
        id: `${novelId}-slice-${slices.length}`,
        index: slices.length,
        title: titleMatch?.[1]?.trim() ?? `切片${slices.length + 1}`,
        content,
        charCount: content.length,
        semanticTags,
        plotArc,
        emotionalTone,
        // 增强字段默认值（后续由 Memory Graph 填充）
        segmentId: '',
        volume: null,
        chapterRange: '',
        characterRefs: [],
        narrativeFunction: '',
        tensionLevel: 0,
        dependencies: [],
      });
    }
  }

  return slices;
}

/** 降级：使用硬分块 + 空语义标签 */
export function fallbackSlice(novelId: string, fullText: string): SemanticSlice[] {
  const chunks = chunkText(novelId, fullText, DEFAULT_MAX_CHUNK_SIZE);
  return chunks.map((chunk, index) => ({
    id: chunk.id,
    index,
    title: chunk.title,
    content: chunk.content,
    charCount: chunk.charCount,
    semanticTags: [],
    plotArc: '',
    emotionalTone: '',
    segmentId: '',
    volume: null,
    chapterRange: '',
    characterRefs: [],
    narrativeFunction: '',
    tensionLevel: 0,
    dependencies: [],
  }));
}

/** 获取切片 API 的请求体 */
export function getSlicingRequestBody(
  rawText: string,
  apiKey: string,
  model: string,
  baseURL: string,
  targetSliceSize: number = 5000,
) {
  const { systemPrompt, userMessage } = buildSlicingMessages(rawText, targetSliceSize);
  return {
    systemPrompt,
    userMessage,
    apiKey,
    model,
    baseURL,
  };
}

/**
 * 判断文本是否足够短，可以跳过 AI 切片，直接作为单一切片
 */
export function shouldSkipSlicing(rawText: string, targetSliceSize: number = 5000): boolean {
  return rawText.length <= targetSliceSize * 1.3;
}

/**
 * 短文本直接创建单一切片（无需 AI 调用）
 */
export function createSingleSlice(novelId: string, rawText: string): SemanticSlice[] {
  return [{
    id: `${novelId}-slice-0`,
    index: 0,
    title: '全文',
    content: rawText,
    charCount: rawText.length,
    semanticTags: [],
    plotArc: '全文',
    emotionalTone: '',
    segmentId: '',
    volume: null,
    chapterRange: '',
    characterRefs: [],
    narrativeFunction: '',
    tensionLevel: 0,
    dependencies: [],
  }];
}
