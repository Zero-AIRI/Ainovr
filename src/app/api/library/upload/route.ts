// ============================================
// POST /api/library/upload — 上传清洗后文本到素材库
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'source_library');

/** 最大请求体大小：50MB（防止 OOM） */
const MAX_BODY_SIZE = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    // 检查 Content-Length 防止 OOM
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BODY_SIZE) {
      return NextResponse.json({ error: '文件过大，最大支持 50MB' }, { status: 413 });
    }
    const { id, title, rawText, totalChars, importConfig } = await req.json();

    if (!id || !title || typeof rawText !== 'string') {
      return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
    }

    const novelDir = safeJoin(LIBRARY_DIR, id);
    await fs.mkdir(novelDir, { recursive: true });

    // 保存清洗后原文
    await fs.writeFile(path.join(novelDir, 'raw.txt'), rawText, 'utf-8');

    // 保存 meta
    const meta = {
      id,
      title,
      totalChars: totalChars ?? rawText.length,
      importConfig: importConfig ?? null,
      status: 'raw',
      createdAt: new Date().toISOString(),
      processedAt: null,
      sliceCount: 0,
      hasStyleProfile: false,
      hasPlotReport: false,
      sampleCount: 0,
    };
    await fs.writeFile(path.join(novelDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

    return NextResponse.json({ success: true, id, title });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '上传失败';
    console.error('Upload to library error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
