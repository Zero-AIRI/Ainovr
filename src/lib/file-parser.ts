// ============================================
// TXT 文件解析
// ============================================

import { nanoid } from 'nanoid';
import type {
  ParsedNovel,
  ImportConfig,
  CleaningConfig,
} from '@/types';
import { cleanNovelText } from './text-cleaner';
import { chunkText, DEFAULT_MAX_CHUNK_SIZE } from './chunker';

// ---- 默认配置 ----

export const DEFAULT_CLEANING_CONFIG: CleaningConfig = {
  preset: 'aggressive',
  enabledSteps: [],
};

export const DEFAULT_IMPORT_CONFIG: ImportConfig = {
  cleaning: DEFAULT_CLEANING_CONFIG,
  maxChunkSize: DEFAULT_MAX_CHUNK_SIZE,
};

// ---- 文件解析 ----

/**
 * 解析上传的 TXT 文件
 * @param file 上传的 File 对象
 * @param importConfig 导入配置（清洗 + 分块大小），不传则使用默认配置
 */
export function parseTxtFile(
  file: File,
  importConfig?: ImportConfig,
): Promise<ParsedNovel> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawText = e.target?.result as string;
      if (!rawText) {
        reject(new Error('文件读取失败'));
        return;
      }

      const config = importConfig ?? { cleaning: DEFAULT_CLEANING_CONFIG, maxChunkSize: DEFAULT_MAX_CHUNK_SIZE };
      const cleaned = cleanNovelText(rawText, config.cleaning);
      const title = file.name.replace(/\.txt$/i, '');
      const id = nanoid();
      const chunks = chunkText(id, cleaned, config.maxChunkSize);

      resolve({
        id,
        title,
        totalChars: cleaned.length,
        fullText: cleaned,
        chunks,
        rawText,
        importConfig: config,
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
