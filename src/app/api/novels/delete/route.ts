// ============================================
// POST /api/novels/delete — 删除 data/novels/{id}/ 目录
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const NOVELS_DIR = path.join(process.cwd(), 'data', 'novels');

async function removeDir(dirPath: string) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await removeDir(full);
      } else {
        await fs.unlink(full);
      }
    }
    await fs.rmdir(dirPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    const bookDir = path.join(NOVELS_DIR, id);
    await removeDir(bookDir);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '删除失败';
    console.error('Delete novel error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
