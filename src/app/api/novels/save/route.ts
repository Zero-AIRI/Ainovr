// ============================================
// POST /api/novels/save — 保存小说到 data/novels/{id}/
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const NOVELS_DIR = path.join(process.cwd(), 'data', 'novels');

export async function POST(req: NextRequest) {
  try {
    const { id, title, fullText, chunks } = await req.json();

    if (!id || !title || typeof fullText !== 'string') {
      return NextResponse.json(
        { error: '缺少必要字段 id / title / fullText' },
        { status: 400 },
      );
    }

    const bookDir = path.join(NOVELS_DIR, id);
    await fs.mkdir(bookDir, { recursive: true });

    // 元数据
    const meta = {
      id,
      title,
      totalChars: fullText.length,
      chunkCount: chunks?.length ?? 0,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(bookDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

    // 全文
    await fs.writeFile(path.join(bookDir, 'full.txt'), fullText, 'utf-8');

    // 分块索引和内容
    if (chunks && chunks.length > 0) {
      const chunksMeta = chunks.map((c: { id: string; index: number; title: string; charCount: number }, i: number) => ({
        id: c.id,
        index: c.index ?? i,
        title: c.title,
        charCount: c.charCount,
        filename: `chunk_${String(i + 1).padStart(4, '0')}.txt`,
      }));
      await fs.writeFile(path.join(bookDir, 'chunks.json'), JSON.stringify(chunksMeta, null, 2), 'utf-8');

      const chunksDir = path.join(bookDir, 'chunks');
      await fs.mkdir(chunksDir, { recursive: true });
      for (const [i, chunk] of chunks.entries()) {
        const filename = `chunk_${String(i + 1).padStart(4, '0')}.txt`;
        await fs.writeFile(path.join(chunksDir, filename), chunk.content, 'utf-8');
      }
    }

    return NextResponse.json({ success: true, id, title });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存失败';
    console.error('Save novel error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
