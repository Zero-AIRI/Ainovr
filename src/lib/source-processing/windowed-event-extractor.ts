// ============================================
// 重叠窗口事件提取器 — 5窗口并行→合并→事件图谱
// 替代原 Step 0-3 的多批次文本摘要模式
// ============================================

import { buildEventExtractionMessages } from '@/lib/ai/prompts';
import { computeMaxCharsPerBatch } from '@/lib/analysis-chunker';
import { type AIConfig, type StreamState } from '@/lib/stream-fetcher';
import type { TextChunk, NovelEvent, EventGraph } from '@/types';

// ---- 类型 ----

interface StreamFetcher {
  fetch(url: string, body: object): Promise<{ result: string | null; state: StreamState }>;
}

/** 单窗口配置 */
interface WindowConfig {
  id: string;             // W1, W2, ...
  startChunk: number;
  endChunk: number;
}

// ---- 窗口划分 ----

/**
 * 将 chunks 划分为重叠窗口
 * 5 个窗口 × ~45万字，重叠 10%
 */
export function computeWindows(chunks: TextChunk[], totalChars: number): WindowConfig[] {
  const WINDOW_CHARS = 450_000;  // 每窗口约 45 万字
  const OVERLAP_RATIO = 0.10;    // 重叠 10%

  const windows: WindowConfig[] = [];
  let currentStart = 0;
  let windowIndex = 0;

  while (currentStart < chunks.length) {
    // 计算当前窗口的结束位置
    let charCount = 0;
    let endChunk = currentStart;
    for (let i = currentStart; i < chunks.length; i++) {
      charCount += chunks[i].charCount;
      if (charCount >= WINDOW_CHARS) {
        endChunk = i;
        break;
      }
      endChunk = i;
    }
    if (endChunk >= chunks.length) endChunk = chunks.length - 1;

    windows.push({
      id: `W${windowIndex + 1}`,
      startChunk: currentStart,
      endChunk,
    });

    if (endChunk >= chunks.length - 1) break;

    // 下一窗口从当前窗口的 ~90% 位置开始（重叠 10%）
    const windowCharCount = chunks.slice(currentStart, endChunk + 1).reduce((s, c) => s + c.charCount, 0);
    const overlapSize = Math.floor(windowCharCount * OVERLAP_RATIO);
    let overlapChars = 0;
    currentStart = endChunk;
    for (let i = endChunk; i >= currentStart; i--) {
      overlapChars += chunks[i].charCount;
      if (overlapChars >= overlapSize) {
        currentStart = i;
        break;
      }
    }

    windowIndex++;
  }

  return windows;
}

// ---- 主流程 ----

export interface WindowedExtractionResult {
  eventGraph: EventGraph;
  rawWindowResults: Array<{ windowId: string; events: NovelEvent[] }>;
}

/**
 * 执行重叠窗口事件提取
 * @param chunks 文本分块
 * @param entityDict 实体字典文本
 * @param novelId 小说 ID
 * @param aiConfig AI 配置
 * @param fetcher 流式 fetch 工具
 * @param onProgress 进度回调
 */
export async function runWindowedEventExtraction(
  chunks: TextChunk[],
  entityDict: string,
  novelId: string,
  aiConfig: AIConfig,
  fetcher: StreamFetcher,
  onProgress?: (window: string, progress: number) => void,
): Promise<WindowedExtractionResult> {
  const totalChars = chunks.reduce((s, c) => s + c.charCount, 0);
  const windows = computeWindows(chunks, totalChars);

  // ═══ 并行提取所有窗口的事件 ═══
  const windowResults = await Promise.all(
    windows.map(async (win) => {
      onProgress?.(win.id, 0);

      // 组装该窗口的原文
      const windowChunks = chunks.slice(win.startChunk, win.endChunk + 1);
      const chunksText = windowChunks
        .map((c) => `## Chunk ${c.index}: ${c.title}\n\n${c.content}`)
        .join('\n\n---\n\n');

      // TODO: 重叠区事件引用机制尚未实现，后续可传入前窗口事件 ID 提升合并质量
      const { systemPrompt, userMessage } = buildEventExtractionMessages(
        chunksText, win.startChunk, windows.length,
      );

      const res = await fetcher.fetch('/api/source/process/event-extraction', {
        systemPrompt, userMessage,
        apiKey: aiConfig.apiKey, model: aiConfig.model, baseURL: aiConfig.baseURL,
      });

      if (!res.result) {
        console.error(`窗口 ${win.id} 事件提取失败:`, res.state.error);
        return { windowId: win.id, events: [] };
      }

      const events = parseEventOutput(res.result, win.id, windowChunks);
      onProgress?.(win.id, 1);
      return { windowId: win.id, events };
    }),
  );

  // ═══ 合并去重（重叠区事件匹配） ═══
  const mergedEvents = mergeOverlappingEvents(windowResults, chunks);

  // ═══ 构建事件图谱 ═══
  const eventGraph = buildEventGraph(mergedEvents, novelId, chunks);

  return { eventGraph, rawWindowResults: windowResults };
}

// ---- 解析 AI 输出 ----

function parseEventOutput(raw: string, windowId: string, windowChunks: TextChunk[]): NovelEvent[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((e: Record<string, unknown>) =>
        typeof e.type === 'string' && typeof e.description === 'string' && (e.confidence === undefined || Number(e.confidence) >= 0.5))
      .map((e: Record<string, unknown>, idx: number): NovelEvent => {
        const chunkIdx = typeof e.chapter === 'number'
          ? windowChunks.findIndex((c) => c.chapterStart <= Number(e.chapter) && c.chapterEnd >= Number(e.chapter))
          : 0;

        return {
          id: String(e.id ?? `E-${windowId}-${idx}`),
          chapter: Number(e.chapter ?? 0),
          chunkIndex: chunkIdx >= 0 ? chunkIdx : 0,
          type: String(e.type ?? '其他'),
          participants: Array.isArray(e.participants) ? e.participants.map(String) : [],
          location: String(e.location ?? '未知'),
          description: String(e.description ?? '').slice(0, 50),
          causes: Array.isArray(e.causes) ? e.causes.map(String) : [],
          effects: Array.isArray(e.effects) ? e.effects.map(String) : [],
          tensionChange: Math.min(5, Math.max(-5, Number(e.tension_change ?? 0))),
          emotion: String(e.emotion ?? ''),
          foreshadowingOf: e.foreshadowing_of ? String(e.foreshadowing_of) : null,
          foreshadowingFrom: null, // 合并阶段填充
          confidence: Math.min(1, Math.max(0, Number(e.confidence ?? 0.7))),
        };
      });
  } catch (err) {
    console.error(`窗口 ${windowId} 事件解析失败:`, err);
    return [];
  }
}

// ---- 重叠区合并 ----

function mergeOverlappingEvents(
  windowResults: Array<{ windowId: string; events: NovelEvent[] }>,
  chunks: TextChunk[],
): NovelEvent[] {
  const allEvents: NovelEvent[] = [];
  const mergedNextEventIds = new Set<string>(); // 被合并的下一窗口事件 ID

  for (let i = 0; i < windowResults.length; i++) {
    const currentWin = windowResults[i];
    const nextWin = windowResults[i + 1];

    for (const event of currentWin.events) {
      // 检查此事件是否与下一窗口中的某个事件一致（重叠区检测）
      let merged = false;
      if (nextWin) {
        for (const nextEvent of nextWin.events) {
          // 匹配条件：同章节 + 同类型 + 共享至少一个参与者
          const sameChapter = Math.abs(event.chapter - nextEvent.chapter) <= 2;
          const sameType = event.type === nextEvent.type;
          const sharedParticipant = event.participants.some((p) => nextEvent.participants.includes(p));

          if (sameChapter && sameType && sharedParticipant) {
            // 这是同一个事件在不同窗口中的两次提取 → 合并
            const mergedEvent = {
              ...event,
              // 取更长的描述
              description: event.description.length >= nextEvent.description.length ? event.description : nextEvent.description,
              // 合并参与者
              participants: [...new Set([...event.participants, ...nextEvent.participants])],
              // 取更高的置信度
              confidence: Math.max(event.confidence, nextEvent.confidence),
              // 合并因果
              causes: [...new Set([...event.causes, ...nextEvent.causes])],
              effects: [...new Set([...event.effects, ...nextEvent.effects])],
            };
            allEvents.push(mergedEvent);
            mergedNextEventIds.add(nextEvent.id);
            merged = true;
            break;
          }
        }
      }

      if (!merged) {
        allEvents.push(event);
      }
    }

    // 添加下一窗口中未被合并的事件
    if (nextWin) {
      for (const nextEvent of nextWin.events) {
        if (!mergedNextEventIds.has(nextEvent.id)) {
          allEvents.push(nextEvent);
        }
      }
    }
  }

  // 去重（最终按 ID）
  const uniqueById = new Map<string, NovelEvent>();
  for (const e of allEvents) {
    const existing = uniqueById.get(e.id);
    if (!existing || e.confidence > existing.confidence) {
      uniqueById.set(e.id, e);
    }
  }

  return [...uniqueById.values()].sort((a, b) => a.chapter - b.chapter || a.chunkIndex - b.chunkIndex);
}

// ---- 构建事件图谱 ----

function buildEventGraph(events: NovelEvent[], novelId: string, chunks: TextChunk[]): EventGraph {
  // 索引
  const byChapter: Record<number, string[]> = {};
  const byParticipant: Record<string, string[]> = {};
  const byType: Record<string, string[]> = {};
  const eventById = new Map<string, NovelEvent>();
  for (const e of events) {
    eventById.set(e.id, e);
    (byChapter[e.chapter] ??= []).push(e.id);
    for (const p of e.participants) {
      (byParticipant[p] ??= []).push(e.id);
    }
    (byType[e.type] ??= []).push(e.id);
  }

  // 伏笔-回收对
  const foreshadowingPairs: EventGraph['foreshadowingPairs'] = [];
  for (const e of events) {
    if (e.foreshadowingOf) {
      const payoff = eventById.get(e.foreshadowingOf);
      if (payoff) {
        foreshadowingPairs.push({
          setup: e.id,
          payoff: payoff.id,
          distance: payoff.chapter - e.chapter,
        });
        // 反向标记
        payoff.foreshadowingFrom = e.id;
      }
    }
  }

  return {
    novelId,
    events,
    totalChapters: chunks[chunks.length - 1]?.chapterEnd ?? 0,
    totalChunks: chunks.length,
    extractedAt: new Date().toISOString(),
    byChapter,
    byParticipant,
    byType,
    foreshadowingPairs,
  };
}
