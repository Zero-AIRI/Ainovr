// ============================================
// POST /api/novels/save — 保存小说到 data/novels/
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeFilename } from '@/lib/utils';

const NOVELS_DIR = path.join(process.cwd(), 'data', 'novels');

export async function POST(req: NextRequest) {
  try {
    const { id, title, fullText } = await req.json();

    if (!title || typeof fullText !== 'string') {
      return NextResponse.json(
        { error: '缺少必要字段 title 或 fullText' },
        { status: 400 },
      );
    }

    await fs.mkdir(NOVELS_DIR, { recursive: true });

    // 文件名包含 id 前8位，避免同名小说互相覆盖
    const idSuffix = id ? `_${id.slice(0, 8)}` : '';
    await fs.writeFile(
      path.join(NOVELS_DIR, `${safeFilename(title)}${idSuffix}.txt`),
      fullText,
      'utf-8',
    );

    return NextResponse.json({ success: true, title });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存失败';
    console.error('Save novel error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
