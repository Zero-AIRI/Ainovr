// ============================================
// GET /api/prompts/list — 返回所有提示词（默认 + 自定义）
// 默认值直接从 prompt 模块导入，单一数据源
// ============================================

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  DEFAULT_SLICING,
  DEFAULT_ENTITY_CLASSIFICATION,
  DEFAULT_STYLE, DEFAULT_STYLE_SUPPLEMENT,
  DEFAULT_PLOT, DEFAULT_PLOT_SUPPLEMENT,
  DEFAULT_CHARACTER_DYNAMICS, DEFAULT_CHARACTER_DYNAMICS_SUPPLEMENT,
  DEFAULT_READER_EXPERIENCE, DEFAULT_READER_EXPERIENCE_SUPPLEMENT,
  DEFAULT_NARRATIVE_CONSTRAINTS, DEFAULT_NARRATIVE_CONSTRAINTS_SUPPLEMENT,
  DEFAULT_DNA_COMPRESSION,
  DEFAULT_SAMPLES,
  DEFAULT_EXPERIENCE_ANNOTATION, DEFAULT_ABLATION_TESTING, DEFAULT_TENSION_TRACKING, DEFAULT_EVENT_EXTRACTION,
  DEFAULT_OUTLINE,
  DEFAULT_PHASE_FRAMEWORK, DEFAULT_PHASE_DETAIL,
  DEFAULT_VOLUME_FRAMEWORK, DEFAULT_VOLUME_DETAIL,
  DEFAULT_CHAPTER_SET_FRAMEWORK, DEFAULT_CHAPTER_SET_DETAIL,
  DEFAULT_CHAPTER_PLAN_FRAMEWORK, DEFAULT_CHAPTER_PLAN_DETAIL,
  DEFAULT_CHAPTER_WRITING, DEFAULT_CHAPTER_REVIEW, DEFAULT_CHAPTER_REVISION,
} from '@/lib/ai/prompts';

const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOM_PROMPTS_PATH = path.join(DATA_DIR, 'prompts.json');

// 默认提示词 — 单一数据源，从各 prompt 模块导入
const DEFAULTS: Record<string, string> = {
  'entity-classification': DEFAULT_ENTITY_CLASSIFICATION,
  'source-slicing': DEFAULT_SLICING,
  'source-style': DEFAULT_STYLE,
  'source-style-supplement': DEFAULT_STYLE_SUPPLEMENT,
  'source-plot': DEFAULT_PLOT,
  'source-plot-supplement': DEFAULT_PLOT_SUPPLEMENT,
  'source-character-dynamics': DEFAULT_CHARACTER_DYNAMICS,
  'source-character-dynamics-supplement': DEFAULT_CHARACTER_DYNAMICS_SUPPLEMENT,
  'source-reader-experience': DEFAULT_READER_EXPERIENCE,
  'source-reader-experience-supplement': DEFAULT_READER_EXPERIENCE_SUPPLEMENT,
  'source-narrative-constraints': DEFAULT_NARRATIVE_CONSTRAINTS,
  'source-narrative-constraints-supplement': DEFAULT_NARRATIVE_CONSTRAINTS_SUPPLEMENT,
  'source-dna-compression': DEFAULT_DNA_COMPRESSION,
  'source-samples': DEFAULT_SAMPLES,
  'experience-annotation': DEFAULT_EXPERIENCE_ANNOTATION,
  'ablation-testing': DEFAULT_ABLATION_TESTING,
  'tension-tracking': DEFAULT_TENSION_TRACKING,
  'event-extraction': DEFAULT_EVENT_EXTRACTION,
  'outline': DEFAULT_OUTLINE,
  'phase-framework': DEFAULT_PHASE_FRAMEWORK,
  'phase-detail': DEFAULT_PHASE_DETAIL,
  'volume-framework': DEFAULT_VOLUME_FRAMEWORK,
  'volume-detail': DEFAULT_VOLUME_DETAIL,
  'chapter-set-framework': DEFAULT_CHAPTER_SET_FRAMEWORK,
  'chapter-set-detail': DEFAULT_CHAPTER_SET_DETAIL,
  'chapter-plan-framework': DEFAULT_CHAPTER_PLAN_FRAMEWORK,
  'chapter-plan-detail': DEFAULT_CHAPTER_PLAN_DETAIL,
  'chapter-writing': DEFAULT_CHAPTER_WRITING,
  'chapter-review': DEFAULT_CHAPTER_REVIEW,
  'chapter-revision': DEFAULT_CHAPTER_REVISION,
};

export async function GET() {
  try {
    // 读取自定义覆盖
    let custom: Record<string, string> = {};
    try {
      const raw = await fs.readFile(CUSTOM_PROMPTS_PATH, 'utf-8');
      custom = JSON.parse(raw);
    } catch {
      // 文件不存在，使用空自定义
    }

    return NextResponse.json({
      defaults: DEFAULTS,
      custom,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '读取提示词失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
