// ============================================
// POST /api/library/save-step — 增量保存单步处理结果
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'source_library');

export async function POST(req: NextRequest) {
  try {
    const { id, step, data } = await req.json();

    if (!id || step === undefined || !data) {
      return NextResponse.json({ error: '缺少 id, step 或 data' }, { status: 400 });
    }

    const novelDir = safeJoin(LIBRARY_DIR, id);
    const metaPath = path.join(novelDir, 'meta.json');

    // 确保 meta.json 存在
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    } catch {
      return NextResponse.json({ error: '小说不存在' }, { status: 404 });
    }

    // 根据步骤保存对应文件
    switch (step) {
      case 0: { // 切片
        if (data.slices) {
          await fs.writeFile(
            path.join(novelDir, 'slices.json'),
            JSON.stringify(data.slices, null, 2),
            'utf-8',
          );
          meta = { ...meta, sliceCount: data.slices.length, status: 'slicing' };
        }
        break;
      }
      case 1: { // 文风
        if (data.styleProfile) {
          await fs.writeFile(
            path.join(novelDir, 'style_profile.md'),
            data.styleProfile,
            'utf-8',
          );
          meta = { ...meta, hasStyleProfile: true, status: 'extracting' };
        }
        break;
      }
      case 2: { // 叙事动力学（原情节提取）
        if (data.plotReport) {
          await fs.writeFile(
            path.join(novelDir, 'plot_report.md'),
            data.plotReport,
            'utf-8',
          );
          meta = { ...meta, hasPlotReport: true, hasNarrativeDynamics: true };
        }
        break;
      }
      case 3: { // 角色动力学
        if (data.characterDynamics) {
          await fs.writeFile(
            path.join(novelDir, 'character_dynamics.md'),
            data.characterDynamics,
            'utf-8',
          );
          meta = { ...meta, hasCharacterDynamics: true, status: 'character_dynamics' };
        }
        break;
      }
      case 4: { // 读者体验
        if (data.readerExperience) {
          await fs.writeFile(
            path.join(novelDir, 'reader_experience.md'),
            data.readerExperience,
            'utf-8',
          );
          meta = { ...meta, hasReaderExperience: true };
        }
        break;
      }
      case 5: { // 叙事约束
        if (data.narrativeConstraints) {
          await fs.writeFile(
            path.join(novelDir, 'narrative_constraints.md'),
            data.narrativeConstraints,
            'utf-8',
          );
          meta = { ...meta, hasNarrativeConstraints: true };
        }
        break;
      }
      case 6: { // 样本选取
        if (data.representativeSamples) {
          await fs.writeFile(
            path.join(novelDir, 'samples.json'),
            JSON.stringify(data.representativeSamples, null, 2),
            'utf-8',
          );
          meta = {
            ...meta,
            sampleCount: data.representativeSamples.length,
          };
        }
        break;
      }
      case 7: { // DNA 压缩
        if (data.novelDna) {
          await fs.writeFile(
            path.join(novelDir, 'novel_dna.yaml'),
            data.novelDna,
            'utf-8',
          );
          meta = {
            ...meta,
            hasNovelDna: true,
            status: data.status || 'ready',
            processedAt: data.processedAt || new Date().toISOString(),
          };
        }
        break;
      }
      default:
        return NextResponse.json({ error: `未知步骤: ${step}` }, { status: 400 });
    }

    // 更新 meta.json
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    return NextResponse.json({ success: true, id, step });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存步骤失败';
    console.error('Save step error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
