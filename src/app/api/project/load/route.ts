// ============================================
// GET /api/project/load?id=xxx — 读取项目状态
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';

const PROJECTS_DIR = path.join(process.cwd(), 'data', 'projects');

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });
    }

    const projectPath = path.join(safeJoin(PROJECTS_DIR, id), 'project.json');
    const raw = await fs.readFile(projectPath, 'utf-8');
    const project = JSON.parse(raw);

    return NextResponse.json({ project });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '加载项目失败';
    console.error('Load project error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
