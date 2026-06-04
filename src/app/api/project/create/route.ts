// ============================================
// POST /api/project/create — 创建写作项目
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';
import type { WritingProject } from '@/types';

const PROJECTS_DIR = path.join(process.cwd(), 'data', 'projects');

export async function POST(req: NextRequest) {
  try {
    const { id, title, sourceNovelIds, sourceRoles } = await req.json();

    if (!id || !title) {
      return NextResponse.json({ error: '缺少 id 或 title' }, { status: 400 });
    }

    const projectDir = safeJoin(PROJECTS_DIR, id);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, 'chapters'), { recursive: true });

    const now = new Date().toISOString();
    const project: WritingProject = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      sourceNovelIds: sourceNovelIds ?? [],
      sourceRoles: sourceRoles ?? [],
      outline: null,
      phases: null,
      volumes: null,
      chapterSets: null,
      chapterPlans: null,
      chapters: [],
      currentLayer: 0,
    };

    await fs.writeFile(
      path.join(projectDir, 'project.json'),
      JSON.stringify(project, null, 2),
      'utf-8',
    );

    return NextResponse.json({ success: true, project });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '创建项目失败';
    console.error('Create project error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
