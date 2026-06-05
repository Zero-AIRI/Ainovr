// ============================================
// POST /api/prompts/save — 保存自定义提示词
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOM_PROMPTS_PATH = path.join(DATA_DIR, 'prompts.json');

export async function POST(req: NextRequest) {
  try {
    const { key, content } = await req.json();

    if (!key || typeof content !== 'string') {
      return NextResponse.json({ error: '缺少 key 或 content' }, { status: 400 });
    }

    // 确保 data 目录存在
    await fs.mkdir(DATA_DIR, { recursive: true });

    // 读取现有自定义提示词
    let custom: Record<string, string> = {};
    try {
      const raw = await fs.readFile(CUSTOM_PROMPTS_PATH, 'utf-8');
      custom = JSON.parse(raw);
    } catch {
      // 文件不存在
    }

    if (content.trim() === '') {
      // 空内容 = 删除自定义，恢复默认
      delete custom[key];
    } else {
      custom[key] = content;
    }

    await fs.writeFile(CUSTOM_PROMPTS_PATH, JSON.stringify(custom, null, 2), 'utf-8');

    return NextResponse.json({ success: true, key });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存提示词失败';
    console.error('Save prompt error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
