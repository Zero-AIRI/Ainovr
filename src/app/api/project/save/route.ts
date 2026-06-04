// ============================================
// POST /api/project/save — 保存项目全量状态
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';

const PROJECTS_DIR = path.join(process.cwd(), 'data', 'projects');

export async function POST(req: NextRequest) {
  try {
    const project = await req.json();

    if (!project?.id) {
      return NextResponse.json({ error: '缺少项目 id' }, { status: 400 });
    }

    const projectDir = safeJoin(PROJECTS_DIR, project.id);
    await fs.mkdir(projectDir, { recursive: true });

    await fs.writeFile(
      path.join(projectDir, 'project.json'),
      JSON.stringify(project, null, 2),
      'utf-8',
    );

    return NextResponse.json({ success: true, id: project.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存项目失败';
    console.error('Save project error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
