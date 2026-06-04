import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 过滤文件名中的非法字符 */
export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

/** 安全解析数字输入，避免 NaN 扩散 */
export function safeInt(value: string, fallback: number = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

import type { NovelChunk } from '@/types';

/** 客户端保存小说到服务端 data/novels/ */
export async function saveNovelToServer(novel: {
  id: string;
  title: string;
  fullText: string;
  chunks: NovelChunk[];
}): Promise<void> {
  try {
    const res = await fetch('/api/novels/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: novel.id,
        title: novel.title,
        fullText: novel.fullText,
        chunks: novel.chunks,
      }),
    });
    if (!res.ok) {
      console.error('Failed to save novel to server:', res.status);
    }
  } catch (err) {
    console.error('Failed to save novel to server:', err);
  }
}
