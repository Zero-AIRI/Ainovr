// ============================================
// TXT 文件解析 + 智能采样算法
// ============================================

import { nanoid } from 'nanoid';
import type {
  ParsedNovel,
  ImportConfig,
  SamplingConfig,
  FixedLengthSamplingConfig,
  CleaningConfig,
} from '@/types';
import { cleanNovelText } from './text-cleaner';

// ---- 默认配置 ----

export const DEFAULT_CLEANING_CONFIG: CleaningConfig = {
  preset: 'aggressive',
  enabledSteps: [],
};

export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  strategy: 'chapter',
  chapter: { headCount: 3, midCount: 3, tailCount: 3, randomCount: 2 },
  fixedLength: { headRatio: 0.3, midRatio: 0.25, tailRatio: 0.2 },
  customCharLimit: 80000,
  maxCharsOverride: null,
};

export const DEFAULT_IMPORT_CONFIG: ImportConfig = {
  cleaning: DEFAULT_CLEANING_CONFIG,
  sampling: DEFAULT_SAMPLING_CONFIG,
};

// ---- 文件解析 ----

/**
 * 解析上传的 TXT 文件
 * @param file 上传的 File 对象
 * @param importConfig 导入配置（清洗 + 采样），不传则使用默认激进清洗
 */
export function parseTxtFile(
  file: File,
  importConfig: ImportConfig = DEFAULT_IMPORT_CONFIG,
): Promise<ParsedNovel> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawText = e.target?.result as string;
      if (!rawText) {
        reject(new Error('文件读取失败'));
        return;
      }
      const cleaned = cleanNovelText(rawText, importConfig.cleaning);
      const title = file.name.replace(/\.txt$/i, '');
      const totalChars = cleaned.length;
      const sampleText = smartSample(cleaned, importConfig.sampling);

      resolve({
        id: nanoid(),
        title,
        totalChars,
        fullText: cleaned,
        sampleText,
        rawText,          // 保存原始未清洗文本，用于后续重新处理
        importConfig,     // 保存产生此结果的配置
      });
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

// ---- 智能采样 ----

/**
 * 智能采样算法
 * - < limit 字：全文送入
 * - 按策略：chapter（章节采样）/ fixedLength（固定长度）/ full（全文）/ customLimit（截断）
 */
export function smartSample(text: string, config?: SamplingConfig): string {
  const sampling = config ?? DEFAULT_SAMPLING_CONFIG;
  const limit = sampling.maxCharsOverride ?? sampling.customCharLimit;

  // 'full' 策略：返回全文
  if (sampling.strategy === 'full') return text;

  // 短文本直接返回
  if (text.length <= limit) return text;

  // 'customLimit' 策略：直接截断
  if (sampling.strategy === 'customLimit') {
    return text.slice(0, limit);
  }

  // 按章节分割（常见的章节标记）
  const chapterPattern = /第[零一二三四五六七八九十百千万\d]+[章节回卷集部篇]/g;
  const chapters = text.split(chapterPattern).filter((s) => s.trim());

  // 无章节结构 或 明确指定固定长度策略
  if (chapters.length <= 3 || sampling.strategy === 'fixedLength') {
    return fixedLengthSample(text, limit, sampling.fixedLength);
  }

  // 章节采样
  const result: string[] = [];
  const takeRange = (arr: string[], start: number, count: number) => {
    for (let i = start; i < start + count && i < arr.length; i++) {
      if (arr[i].trim()) result.push(arr[i]);
    }
  };

  const { headCount, midCount, tailCount, randomCount } = sampling.chapter;

  // 开头
  takeRange(chapters, 0, headCount);
  // 中间
  const mid = Math.floor(chapters.length / 2);
  const midStart = Math.max(0, mid - Math.floor(midCount / 2));
  takeRange(chapters, midStart, midCount);
  // 结尾
  takeRange(chapters, chapters.length - tailCount, tailCount);
  // 随机
  const picked = new Set(result);
  let randomPicked = 0;
  for (let attempts = 0; attempts < 20 && randomPicked < randomCount; attempts++) {
    const idx = Math.floor(Math.random() * chapters.length);
    if (!picked.has(chapters[idx]) && chapters[idx].trim()) {
      result.push(chapters[idx]);
      randomPicked++;
    }
  }

  let sampled = result.join('\n\n');

  // 如果还是太长，截断
  if (sampled.length > limit) {
    sampled = sampled.slice(0, limit);
  }

  return sampled;
}

/** 无章节标记时的固定长度采样 */
function fixedLengthSample(
  text: string,
  limit: number,
  config?: FixedLengthSamplingConfig,
): string {
  let headRatio = config?.headRatio ?? 0.3;
  let midRatio = config?.midRatio ?? 0.25;
  let tailRatio = config?.tailRatio ?? 0.2;

  // 归一化：如果比例之和 > 1.0，按比例缩小
  const total = headRatio + midRatio + tailRatio;
  if (total > 1.0) {
    headRatio /= total;
    midRatio /= total;
    tailRatio /= total;
  }

  const headLen = Math.floor(limit * headRatio);
  const midLen = Math.floor(limit * midRatio);
  const tailLen = Math.floor(limit * tailRatio);
  const midStart = Math.floor(text.length / 2) - Math.floor(midLen / 2);

  const head = text.slice(0, headLen);
  const mid = text.slice(Math.max(0, midStart), midStart + midLen);
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
