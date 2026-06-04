// ============================================
// GET /api/novels/list — 列出 data/novels/ 下的全部小说
// ============================================

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const NOVELS_DIR = path.join(process.cwd(), 'data', 'novels');

export async function GET() {
  try {
    await fs.mkdir(NOVELS_DIR, { recursive: true });

    const entries = await fs.readdir(NOVELS_DIR, { withFileTypes: true });
    const novels: { id: string; title: string; totalChars: number; chunkCount: number }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        const metaPath = path.join(NOVELS_DIR, entry.name, 'meta.json');
        const metaRaw = await fs.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaRaw);
        novels.push({
          id: meta.id,
          title: meta.title,
          totalChars: meta.totalChars,
          chunkCount: meta.chunkCount,
        });
      } catch {
        // 跳过无 meta.json 的目录（可能是旧格式文件或损坏的目录）
        continue;
      }
    }

    return NextResponse.json({ novels });
  } catch {
    return NextResponse.json({ novels: [] });
  }
}
