// ============================================
// POST /api/library/delete — 删除源小说
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'source_library');

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    const novelDir = safeJoin(LIBRARY_DIR, id);
    await fs.rm(novelDir, { recursive: true, force: true });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '删除失败';
    console.error('Delete library error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
