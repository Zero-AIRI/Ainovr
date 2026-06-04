// ============================================
// POST /api/project/delete — 删除项目
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { safeJoin } from '@/lib/safe-path';
import path from 'path';

const PROJECTS_DIR = path.join(process.cwd(), 'data', 'projects');

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    const projectDir = safeJoin(PROJECTS_DIR, id);
    await fs.rm(projectDir, { recursive: true, force: true });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '删除项目失败';
    console.error('Delete project error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
