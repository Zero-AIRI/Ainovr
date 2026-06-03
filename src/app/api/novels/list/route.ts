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

    const files = await fs.readdir(NOVELS_DIR);
    const novels = files
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({
        title: f.replace(/\.txt$/, ''),
        filename: f,
      }));

    return NextResponse.json({ novels });
  } catch {
    return NextResponse.json({ novels: [] });
  }
}
