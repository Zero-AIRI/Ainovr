// ============================================
// 代表性切片选取 — 客户端编排模块
// ============================================

import { buildSampleSelectionMessages } from '@/lib/ai/prompts';
import type { SemanticSlice, RepresentativeSample } from '@/types';

/** 解析 AI 输出的样本 markdown 为 RepresentativeSample[] */
export function parseSampleOutput(raw: string): RepresentativeSample[] {
  const samples: RepresentativeSample[] = [];
  const sections = raw.split(/^## 样本 /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split('\n');
    const headerLine = lines[0] ?? '';
    const titleMatch = headerLine.match(/^\d+:\s*(.+)/);

    let sliceIndex = 0;
    let selectionReason = '';
    let contentStartIndex = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('- 场景类型:') || line.startsWith('- 选取理由:')) {
        if (line.startsWith('- 选取理由:')) {
          selectionReason = line.replace('- 选取理由:', '').trim();
        }
      } else if (line === '---' || (line && !line.startsWith('-') && contentStartIndex === 0)) {
        if (contentStartIndex === 0) contentStartIndex = i;
        break;
      }
    }

    if (contentStartIndex === 0) {
      contentStartIndex = lines.findIndex((l, i) => i > 0 && !l.startsWith('-') && l.trim() !== '' && l.trim() !== '---');
      if (contentStartIndex === -1) contentStartIndex = lines.length;
    }

    const content = lines.slice(contentStartIndex).join('\n').replace(/^---\s*/m, '').trim();

    if (content) {
      samples.push({
        sliceId: `sample-${samples.length}`,
        sliceIndex: samples.length,
        title: titleMatch?.[1]?.trim() ?? `样本${samples.length + 1}`,
        content,
        selectionReason,
      });
    }
  }

  return samples;
}

/** 获取样本选取 API 的请求体 */
export function getSampleSelectionRequestBody(
  slices: SemanticSlice[],
  styleProfile: string,
  plotReport: string,
  apiKey: string,
  model: string,
  baseURL: string,
) {
  // 只传切片摘要，不传全文（节省 token）
  const slicesSummary = slices
    .map((s) => `- ${s.title} (${s.charCount}字) [${s.semanticTags.join(', ')}] ${s.emotionalTone}`)
    .join('\n');

  const { systemPrompt, userMessage } = buildSampleSelectionMessages(slicesSummary, styleProfile, plotReport);

  return {
    systemPrompt,
    userMessage,
    apiKey,
    model,
    baseURL,
  };
}
