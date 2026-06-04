// ============================================
// GET /api/library/get?id=xxx — 读取单个源小说全量数据
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'source_library');

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });
    }

    const novelDir = safeJoin(LIBRARY_DIR, id);

    // 读取 meta.json
    const metaRaw = await fs.readFile(path.join(novelDir, 'meta.json'), 'utf-8');
    const meta = JSON.parse(metaRaw);

    // 读取 raw.txt（可能不存在）
    let rawText: string | null = null;
    try {
      rawText = await fs.readFile(path.join(novelDir, 'raw.txt'), 'utf-8');
    } catch { /* raw.txt 可能不存在 */ }

    // 读取 slices.json
    let slices = null;
    try {
      const slicesRaw = await fs.readFile(path.join(novelDir, 'slices.json'), 'utf-8');
      slices = JSON.parse(slicesRaw);
    } catch { /* slices 可能不存在 */ }

    // 读取 style_profile.md
    let styleProfile: string | null = null;
    try {
      styleProfile = await fs.readFile(path.join(novelDir, 'style_profile.md'), 'utf-8');
    } catch { /* style_profile 可能不存在 */ }

    // 读取 plot_report.md
    let plotReport: string | null = null;
    try {
      plotReport = await fs.readFile(path.join(novelDir, 'plot_report.md'), 'utf-8');
    } catch { /* plot_report 可能不存在 */ }

    // 读取 samples.json
    let samples = null;
    try {
      const samplesRaw = await fs.readFile(path.join(novelDir, 'samples.json'), 'utf-8');
      samples = JSON.parse(samplesRaw);
    } catch { /* samples 可能不存在 */ }

    return NextResponse.json({
      ...meta,
      rawText,
      slices,
      styleProfile,
      plotReport,
      representativeSamples: samples,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '读取源小说失败';
    console.error('Get library item error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
