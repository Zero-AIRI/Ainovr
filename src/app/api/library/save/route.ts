// ============================================
// POST /api/library/save — 保存处理结果到素材库
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';
import { atomicWriteJson, atomicWriteText } from '@/lib/atomic-write';
import type { SourceNovel } from '@/types';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'source_library');

export async function POST(req: NextRequest) {
  try {
    const sourceNovel: SourceNovel = await req.json();

    if (!sourceNovel.id || !sourceNovel.title) {
      return NextResponse.json({ error: '缺少 id 或 title' }, { status: 400 });
    }

    const novelDir = safeJoin(LIBRARY_DIR, sourceNovel.id);
    const { mkdir } = await import('fs/promises');
    await mkdir(novelDir, { recursive: true });

    // meta.json（不含大体积字段）
    const meta = {
      id: sourceNovel.id,
      title: sourceNovel.title,
      totalChars: sourceNovel.totalChars,
      importConfig: sourceNovel.importConfig,
      status: sourceNovel.status,
      createdAt: sourceNovel.createdAt,
      processedAt: sourceNovel.processedAt,
      sliceCount: sourceNovel.slices?.length ?? 0,
      hasStyleProfile: !!sourceNovel.styleProfile,
      hasPlotReport: !!sourceNovel.plotReport,
      hasCharacterDynamics: !!sourceNovel.characterDynamics,
      hasReaderExperience: !!sourceNovel.readerExperience,
      hasNarrativeConstraints: !!sourceNovel.narrativeConstraints,
      hasNovelDna: !!sourceNovel.novelDna,
      sampleCount: sourceNovel.representativeSamples?.length ?? 0,
    };
    await atomicWriteJson(path.join(novelDir, 'meta.json'), meta);

    // slices.json
    if (sourceNovel.slices) {
      await atomicWriteJson(path.join(novelDir, 'slices.json'), sourceNovel.slices);
    }

    // style_profile.md
    if (sourceNovel.styleProfile) {
      await atomicWriteText(path.join(novelDir, 'style_profile.md'), sourceNovel.styleProfile);
    }

    // plot_report.md
    if (sourceNovel.plotReport) {
      await atomicWriteText(path.join(novelDir, 'plot_report.md'), sourceNovel.plotReport);
    }

    // character_dynamics.md
    if (sourceNovel.characterDynamics) {
      await atomicWriteText(path.join(novelDir, 'character_dynamics.md'), sourceNovel.characterDynamics);
    }

    // reader_experience.md
    if (sourceNovel.readerExperience) {
      await atomicWriteText(path.join(novelDir, 'reader_experience.md'), sourceNovel.readerExperience);
    }

    // narrative_constraints.md
    if (sourceNovel.narrativeConstraints) {
      await atomicWriteText(path.join(novelDir, 'narrative_constraints.md'), sourceNovel.narrativeConstraints);
    }

    // novel_dna.yaml
    if (sourceNovel.novelDna) {
      await atomicWriteText(path.join(novelDir, 'novel_dna.yaml'), sourceNovel.novelDna);
    }

    // samples.json
    if (sourceNovel.representativeSamples) {
      await atomicWriteJson(path.join(novelDir, 'samples.json'), sourceNovel.representativeSamples);
    }

    return NextResponse.json({ success: true, id: sourceNovel.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存素材失败';
    console.error('Save library error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
