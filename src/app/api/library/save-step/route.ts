// ============================================
// POST /api/library/save-step — 增量保存单步处理结果
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { safeJoin } from '@/lib/safe-path';
import { atomicWriteJson, atomicWriteText } from '@/lib/atomic-write';

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
    // 统一管线（7步）：step 0-6
    // 旧管线：step 0-7（向后兼容）
    switch (step) {
      // ── 统一管线 ──
      case 0: { // 小切片
        if (data.smallSlices) {
          await atomicWriteJson(
            path.join(novelDir, 'small_slices.json'),
            data.smallSlices,
          );
          meta = { ...meta, smallSliceCount: data.smallSlices.length, status: 'slicing' };
        } else if (data.slices) {
          // 旧管线兼容
          await atomicWriteJson(
            path.join(novelDir, 'slices.json'),
            data.slices,
          );
          meta = { ...meta, sliceCount: data.slices.length, status: 'slicing' };
        }
        break;
      }
      case 1: { // 事件提取（统一） / 文风（旧）
        if (data.sliceExtractions) {
          await atomicWriteJson(
            path.join(novelDir, 'slice_extractions.json'),
            data.sliceExtractions,
          );
          meta = { ...meta, hasSliceExtractions: true, status: 'extracting_events' };
        } else if (data.styleProfile) {
          await atomicWriteText(
            path.join(novelDir, 'style_profile.md'),
            data.styleProfile,
          );
          meta = { ...meta, hasStyleProfile: true, status: 'extracting' };
        }
        break;
      }
      case 2: { // 事件对齐（统一） / 叙事动力学（旧）
        if (data.eventGraph) {
          await atomicWriteJson(
            path.join(novelDir, 'event_graph.json'),
            data.eventGraph,
          );
          meta = { ...meta, hasEventGraph: true, status: 'aligning_events' };
        } else if (data.plotReport) {
          await atomicWriteText(
            path.join(novelDir, 'plot_report.md'),
            data.plotReport,
          );
          meta = { ...meta, hasPlotReport: true, hasNarrativeDynamics: true };
        }
        break;
      }
      case 3: { // 大切片（统一） / 角色动力学（旧）
        if (data.largeSlices) {
          await atomicWriteJson(
            path.join(novelDir, 'large_slices.json'),
            data.largeSlices,
          );
          meta = { ...meta, largeSliceCount: data.largeSlices.length };
        } else if (data.characterDynamics) {
          await atomicWriteText(
            path.join(novelDir, 'character_dynamics.md'),
            data.characterDynamics,
          );
          meta = { ...meta, hasCharacterDynamics: true, status: 'character_dynamics' };
        }
        break;
      }
      case 4: { // 深度分析（统一） / 读者体验（旧）
        if (data.sliceAnalyses) {
          await atomicWriteJson(
            path.join(novelDir, 'slice_analyses.json'),
            data.sliceAnalyses,
          );
          meta = { ...meta, hasSliceAnalyses: true, status: 'deep_analysis' };
        } else if (data.readerExperience) {
          await atomicWriteText(
            path.join(novelDir, 'reader_experience.md'),
            data.readerExperience,
          );
          meta = { ...meta, hasReaderExperience: true };
        }
        break;
      }
      case 5: { // 汇总报告（统一） / 叙事约束（旧）
        if (data.summaryReport) {
          await atomicWriteJson(
            path.join(novelDir, 'summary_report.json'),
            data.summaryReport,
          );
          meta = { ...meta, hasSummaryReport: true };
        } else if (data.narrativeConstraints) {
          await atomicWriteText(
            path.join(novelDir, 'narrative_constraints.md'),
            data.narrativeConstraints,
          );
          meta = { ...meta, hasNarrativeConstraints: true };
        }
        break;
      }
      case 6: { // DNA 压缩（统一） / 样本选取（旧）
        if (data.dna) {
          await atomicWriteJson(
            path.join(novelDir, 'generation_rules_dna.json'),
            data.dna,
          );
          meta = {
            ...meta,
            hasGenerationRulesDna: true,
            status: data.status || 'ready',
            processedAt: data.processedAt || new Date().toISOString(),
          };
        } else if (data.representativeSamples) {
          await atomicWriteJson(
            path.join(novelDir, 'samples.json'),
            data.representativeSamples,
          );
          meta = {
            ...meta,
            sampleCount: data.representativeSamples.length,
          };
        }
        break;
      }
      case 7: { // DNA 压缩（旧管线）
        if (data.novelDna) {
          await atomicWriteText(
            path.join(novelDir, 'novel_dna.yaml'),
            data.novelDna,
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

    // 更新 meta.json（原子写入防止崩溃时损坏）
    await atomicWriteJson(metaPath, meta);

    return NextResponse.json({ success: true, id, step });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存步骤失败';
    console.error('Save step error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
