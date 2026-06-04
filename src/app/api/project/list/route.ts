// ============================================
// GET /api/project/list — 列出所有项目
// ============================================

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const PROJECTS_DIR = path.join(process.cwd(), 'data', 'projects');

export async function GET() {
  try {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });

    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await fs.readFile(
          path.join(PROJECTS_DIR, entry.name, 'project.json'),
          'utf-8',
        );
        const project = JSON.parse(raw);
        // 只返回概要，不返回大体积字段
        projects.push({
          id: project.id,
          title: project.title,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          currentLayer: project.currentLayer,
          sourceNovelIds: project.sourceNovelIds,
          sourceRoles: project.sourceRoles,
          chapterCount: project.chapters?.length ?? 0,
        });
      } catch {
        // 跳过无效目录
      }
    }

    return NextResponse.json({ projects });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '读取项目列表失败';
    console.error('List projects error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
