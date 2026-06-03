// ============================================
// POST /api/novels/delete — 从 data/novels/ 删除小说
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeFilename } from '@/lib/utils';

const NOVELS_DIR = path.join(process.cwd(), 'data', 'novels');

export async function POST(req: NextRequest) {
  try {
    const { title } = await req.json();
    if (!title) {
      return NextResponse.json({ error: '缺少 title' }, { status: 400 });
    }

    // 列出匹配书名的所有文件（可能有不同 id 后缀的变体）
    let files: string[];
    try {
      files = await fs.readdir(NOVELS_DIR);
    } catch {
      // 目录不存在 → 没有可删除的文件
      return NextResponse.json({ success: true });
    }

    const safeName = safeFilename(title);
    const matching = files.filter(
      (f) => f === `${safeName}.txt` || f.startsWith(`${safeName}_`),
    );

    for (const f of matching) {
      try {
        await fs.unlink(path.join(NOVELS_DIR, f));
      } catch (err: unknown) {
        // 只忽略 ENOENT（文件不存在），其他错误向上传播
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '删除失败';
    console.error('Delete novel error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
