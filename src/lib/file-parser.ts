// ============================================
// TXT 文件解析
// ============================================

import { nanoid } from 'nanoid';
import type { ParsedNovel, ImportConfig, CleaningConfig } from '@/types';
import { cleanNovelText } from './text-cleaner';
import { chunkText, DEFAULT_MAX_CHUNK_SIZE } from './chunker';

// ---- 默认配置（保留导出用于 store 迁移兼容） ----

const STANDARD_CLEANING_CONFIG: CleaningConfig = {
  preset: 'standard',
  enabledSteps: [],
};

export const DEFAULT_CLEANING_CONFIG: CleaningConfig = STANDARD_CLEANING_CONFIG;

export const DEFAULT_IMPORT_CONFIG: ImportConfig = {
  cleaning: STANDARD_CLEANING_CONFIG,
  maxChunkSize: DEFAULT_MAX_CHUNK_SIZE,
};

// ---- 文件解析 ----

/**
 * 解析上传的 TXT 文件（固定使用 standard 清洗预设）
 */
export function parseTxtFile(file: File): Promise<ParsedNovel> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawText = e.target?.result as string;
      if (!rawText) {
        reject(new Error('文件读取失败'));
        return;
      }

      const cleaned = cleanNovelText(rawText, STANDARD_CLEANING_CONFIG);
      const title = file.name.replace(/\.txt$/i, '');
      const id = nanoid();
      const chunks = chunkText(id, cleaned, DEFAULT_MAX_CHUNK_SIZE);

      resolve({
        id,
        title,
        totalChars: cleaned.length,
        fullText: cleaned,
        chunks,
        rawText,
        importConfig: null,
      });
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

/** 格式化字数显示 */
export function formatCharCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万字`;
  }
  return `${count}字`;
}
