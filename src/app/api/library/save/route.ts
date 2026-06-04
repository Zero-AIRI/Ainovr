// ============================================
// POST /api/library/save — 保存处理结果到素材库
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';
import type { SourceNovel } from '@/types';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'source_library');

export async function POST(req: NextRequest) {
  try {
    const sourceNovel: SourceNovel = await req.json();

    if (!sourceNovel.id || !sourceNovel.title) {
      return NextResponse.json({ error: '缺少 id 或 title' }, { status: 400 });
    }

    const novelDir = safeJoin(LIBRARY_DIR, sourceNovel.id);
    await fs.mkdir(novelDir, { recursive: true });

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
      sampleCount: sourceNovel.representativeSamples?.length ?? 0,
    };
    await fs.writeFile(
      path.join(novelDir, 'meta.json'),
      JSON.stringify(meta, null, 2),
      'utf-8',
    );

    // slices.json
    if (sourceNovel.slices) {
      await fs.writeFile(
        path.join(novelDir, 'slices.json'),
        JSON.stringify(sourceNovel.slices, null, 2),
        'utf-8',
      );
    }

    // style_profile.md
    if (sourceNovel.styleProfile) {
      await fs.writeFile(
        path.join(novelDir, 'style_profile.md'),
        sourceNovel.styleProfile,
        'utf-8',
      );
    }

    // plot_report.md
    if (sourceNovel.plotReport) {
      await fs.writeFile(
        path.join(novelDir, 'plot_report.md'),
        sourceNovel.plotReport,
        'utf-8',
      );
    }

    // samples.json
    if (sourceNovel.representativeSamples) {
      await fs.writeFile(
        path.join(novelDir, 'samples.json'),
        JSON.stringify(sourceNovel.representativeSamples, null, 2),
        'utf-8',
      );
    }

    return NextResponse.json({ success: true, id: sourceNovel.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存素材失败';
    console.error('Save library error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
