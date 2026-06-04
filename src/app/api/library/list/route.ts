// ============================================
// GET /api/library/list — 列出素材库中所有源小说
// ============================================

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'source_library');

export async function GET() {
  try {
    await fs.mkdir(LIBRARY_DIR, { recursive: true });
    const entries = await fs.readdir(LIBRARY_DIR, { withFileTypes: true });

    const novels = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(LIBRARY_DIR, entry.name, 'meta.json');
      try {
        const raw = await fs.readFile(metaPath, 'utf-8');
        novels.push(JSON.parse(raw));
      } catch {
        // 跳过没有 meta.json 的目录
      }
    }

    return NextResponse.json({ novels });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '读取素材库失败';
    console.error('List library error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
