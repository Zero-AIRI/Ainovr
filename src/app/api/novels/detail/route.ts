// ============================================
// GET /api/novels/detail?id=xxx — 读取小说完整数据
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const NOVELS_DIR = path.join(process.cwd(), 'data', 'novels');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });
    }

    const bookDir = path.join(NOVELS_DIR, id);

    // 读取 meta.json
    const metaRaw = await fs.readFile(path.join(bookDir, 'meta.json'), 'utf-8');
    const meta = JSON.parse(metaRaw);

    // 读取 full.txt
    const fullText = await fs.readFile(path.join(bookDir, 'full.txt'), 'utf-8');

    // 读取 chunks
    let chunks: {
      id: string;
      index: number;
      title: string;
      charCount: number;
      content: string;
    }[] = [];

    try {
      const chunksMetaRaw = await fs.readFile(path.join(bookDir, 'chunks.json'), 'utf-8');
      const chunksMeta = JSON.parse(chunksMetaRaw);

      const chunksDir = path.join(bookDir, 'chunks');
      for (const cm of chunksMeta) {
        const content = await fs.readFile(path.join(chunksDir, cm.filename), 'utf-8');
        chunks.push({
          id: cm.id,
          index: cm.index,
          title: cm.title,
          charCount: cm.charCount,
          content,
        });
      }
    } catch {
      // chunks 目录可能不存在（旧格式或无章节小说）
      chunks = [];
    }

    return NextResponse.json({
      novel: {
        id: meta.id,
        title: meta.title,
        totalChars: meta.totalChars,
        fullText,
        chunks,
        rawText: null,
        importConfig: null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '读取失败';
    console.error('Detail novel error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
