// ============================================
// POST /api/library/rename — 重命名源小说
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'source_library');

export async function POST(req: NextRequest) {
  try {
    const { id, title } = await req.json();
    if (!id || !title || typeof title !== 'string') {
      return NextResponse.json({ error: '缺少 id 或 title' }, { status: 400 });
    }

    const novelDir = safeJoin(LIBRARY_DIR, id);
    const metaPath = path.join(novelDir, 'meta.json');

    // 读取现有 meta
    const metaRaw = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaRaw);

    // 更新标题
    meta.title = title.trim();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    return NextResponse.json({ success: true, title: meta.title });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '重命名失败';
    console.error('Rename library error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
