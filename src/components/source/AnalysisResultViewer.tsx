// ============================================
// 分析结果中文结构化展示
// 替代 raw JSON pre，用中文标签和可视化呈现
// ============================================

'use client';

import { FileText, Users, Link2, AlertTriangle, Activity, BarChart3, Zap, Shield } from 'lucide-react';
import type { GenerationRulesDNA, SummaryReport, FullEventGraph } from '@/lib/source-processing/pipeline-types';

// ---- 辅助 ----

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function num(n: number | null | undefined, suffix = ''): string {
  if (n === null || n === undefined || n === 0) return '—';
  return `${n}${suffix}`;
}

function arr<T>(a: T[] | null | undefined): T[] {
  return a ?? [];
}

// ---- 卡片容器 ----

function Card({ title, icon: Icon, children, accent = 'border-border' }: {
  title: string;
  icon?: typeof FileText;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className={`rounded-lg border ${accent} bg-card overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
        <h3 className="text-xs font-semibold text-foreground tracking-wide">{title}</h3>
      </div>
      <div className="px-4 py-3 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-xs text-muted-foreground shrink-0 w-20">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono text-xs' : 'text-foreground'}`}>{value || '—'}</span>
    </div>
  );
}

function Tag({ label, color = 'default' }: { label: string; color?: 'default' | 'green' | 'red' | 'blue' | 'yellow' }) {
  const colors: Record<string, string> = {
    default: 'bg-muted text-muted-foreground',
    green: 'bg-green-500/10 text-green-600',
    red: 'bg-red-500/10 text-red-500',
    blue: 'bg-blue-500/10 text-blue-600',
    yellow: 'bg-yellow-500/10 text-yellow-600',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {label}
    </span>
  );
}

// ---- 刺激类型颜色映射 ----

const STIM_COLORS: Record<string, 'green' | 'red' | 'blue' | 'yellow' | 'default'> = {
  '冲突升级': 'red',
  '信息释放': 'blue',
  '关系变化': 'yellow',
  '实力跃迁': 'green',
  '悬念建立': 'yellow',
  '日常过渡': 'default',
};

// ============================================
// DNA 查看器
// ============================================

export function DNAViewer({ dna }: { dna: GenerationRulesDNA }) {
  const stimEntries = Object.entries(dna.stimulationDensity).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-4">
      {/* 句式参数 */}
      <Card title="📏 句式参数" icon={FileText}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Row label="平均句长" value={`${dna.sentenceLength.avg} 字`} />
          <Row label="标准差" value={`±${dna.sentenceLength.std} 字`} />
          <Row label="高潮句长" value={num(dna.sentenceLength.climax, ' 字')} />
          <Row label="平静句长" value={num(dna.sentenceLength.calm, ' 字')} />
        </div>
      </Card>

      {/* 内容配比 */}
      <Card title="💬 内容配比" icon={BarChart3}>
        <div className="space-y-2">
          {[
            { label: '对话占比', value: dna.dialogueRatio },
            { label: '描写占比', value: dna.descriptionRatio },
            { label: '动作占比', value: dna.actionRatio },
            { label: '内心独白', value: dna.internalMonologueRatio },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round(value * 100)}%` }}
                />
              </div>
              <span className="text-xs font-mono text-foreground w-10 text-right">{pct(value)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 节奏参数 */}
      <Card title="⏱️ 节奏参数" icon={Activity}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Row label="冲突间隔" value={num(dna.conflictInterval, ' 字')} />
          <Row label="高峰间隔" value={num(dna.peakInterval, ' 字')} />
          <Row label="冷却长度" value={num(dna.cooldownLength, ' 字')} />
        </div>
      </Card>

      {/* 刺激循环 */}
      {dna.stimulationCycle.length > 0 && (
        <Card title="🔄 刺激循环" icon={Zap}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {dna.stimulationCycle.map((s, i) => (
              <span key={i} className="flex items-center gap-1">
                <Tag label={s} color={STIM_COLORS[s] ?? 'default'} />
                {i < dna.stimulationCycle.length - 1 && (
                  <span className="text-muted-foreground/40 text-xs">→</span>
                )}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* 刺激密度 */}
      {stimEntries.length > 0 && (
        <Card title="📊 刺激密度" icon={BarChart3}>
          <div className="space-y-1.5">
            {stimEntries.map(([type, density]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">{type}</span>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round(density * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-foreground w-10 text-right">{pct(density)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 信息释放 */}
      <Card title="📡 信息释放" icon={Zap} accent={dna.informationRelease.avgSetupToHint > 0 ? 'border-blue-500/20' : 'border-border'}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Row label="设定→提示" value={num(dna.informationRelease.avgSetupToHint, ' 章')} />
          <Row label="提示→揭秘" value={num(dna.informationRelease.avgHintToReveal, ' 章')} />
          <Row label="揭秘密度" value={num(dna.informationRelease.revealDensity, ' /章')} />
        </div>
      </Card>

      {/* 角色规则 */}
      {dna.characterRules.length > 0 && (
        <Card title={`👥 角色规则（${dna.characterRules.length} 人）`} icon={Users}>
          <div className="space-y-3">
            {dna.characterRules.map((cr, i) => (
              <div key={i} className="p-2 rounded bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-foreground">{cr.name}</span>
                  <span className="text-xs text-muted-foreground">对话占比 {pct(cr.dialogRatio)}</span>
                </div>
                {cr.stimulusResponse.length > 0 && (
                  <div className="space-y-0.5">
                    {cr.stimulusResponse.slice(0, 5).map((sr, j) => (
                      <div key={j} className="text-xs flex gap-2">
                        <span className="text-muted-foreground shrink-0">刺激:</span>
                        <span className="text-foreground">{sr.stimulus}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground">{sr.response}</span>
                      </div>
                    ))}
                    {cr.stimulusResponse.length > 5 && (
                      <span className="text-xs text-muted-foreground">…还有 {cr.stimulusResponse.length - 5} 条</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 一致性参数 */}
      <Card title="⚠️ 一致性参数" icon={AlertTriangle}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Row label="设定偏移容忍" value={`${Math.round(dna.settingDriftTolerance * 100)}%`} />
          <Row label="未回收比例" value={`${Math.round(dna.unresolvedRatio * 100)}%`} />
          <Row label="文风一致性" value={dna.styleConsistencyRate > 0 ? pct(dna.styleConsistencyRate) : '—'} />
        </div>
      </Card>

      {/* 禁忌 */}
      {dna.taboos.length > 0 && (
        <Card title={`🚫 写作禁忌（${dna.taboos.length} 条）`} icon={Shield} accent="border-red-500/20">
          <ul className="space-y-1">
            {dna.taboos.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-red-400 shrink-0 mt-1">•</span>
                <span className="text-foreground">{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 定性备注 */}
      {dna.qualitativeNotes && (dna.qualitativeNotes.styleSignature || dna.qualitativeNotes.coreAppeal || dna.qualitativeNotes.riskNotes.length > 0) && (
        <Card title="📝 定性备注" icon={FileText} accent="border-yellow-500/20">
          {dna.qualitativeNotes.styleSignature && (
            <div className="mb-2">
              <span className="text-xs text-muted-foreground">风格签名：</span>
              <span className="text-sm text-foreground">{dna.qualitativeNotes.styleSignature}</span>
            </div>
          )}
          {dna.qualitativeNotes.coreAppeal && (
            <div className="mb-2">
              <span className="text-xs text-muted-foreground">核心吸引力：</span>
              <span className="text-sm text-foreground">{dna.qualitativeNotes.coreAppeal}</span>
            </div>
          )}
          {dna.qualitativeNotes.riskNotes.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground block mb-1">风险备注：</span>
              <ul className="space-y-0.5">
                {dna.qualitativeNotes.riskNotes.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-yellow-500 shrink-0">⚠</span>
                    <span className="text-muted-foreground">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* 元数据 */}
      <Card title="📋 元数据" icon={FileText}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <div>生成时间: {dna.meta.generatedAt ? new Date(dna.meta.generatedAt).toLocaleString('zh-CN') : '—'}</div>
          <div>使用模型: {dna.meta.modelUsed || '—'}</div>
          <div>小切片数: {dna.meta.totalSmallSlices}</div>
          <div>大切片数: {dna.meta.totalLargeSlices}</div>
          <div>事件总数: {dna.meta.totalEvents}</div>
          <div>实体总数: {dna.meta.totalEntities}</div>
        </div>
      </Card>
    </div>
  );
}

// ============================================
// 汇总报告查看器
// ============================================

export function SummaryViewer({ report }: { report: SummaryReport }) {
  const stimEntries = Object.entries(report.stimulationCycle.stimulationDensity ?? {})
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-4">
      {/* 文风演化 */}
      {arr(report.styleEvolution).length > 0 && (
        <Card title="📈 文风演化" icon={Activity}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">阶段</th>
                  <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">句长</th>
                  <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">对话占比</th>
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">主导刺激</th>
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">变化触发</th>
                </tr>
              </thead>
              <tbody>
                {report.styleEvolution.map((phase, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1 px-2 text-foreground">{phase.phase}</td>
                    <td className="py-1 px-2 text-right font-mono">{num(phase.sentenceLengthAvg)}</td>
                    <td className="py-1 px-2 text-right font-mono">{phase.dialogueRatio > 0 ? pct(phase.dialogueRatio) : '—'}</td>
                    <td className="py-1 px-2">{phase.dominantStimulation ? <Tag label={phase.dominantStimulation} color={STIM_COLORS[phase.dominantStimulation] ?? 'default'} /> : '—'}</td>
                    <td className="py-1 px-2 text-muted-foreground">{phase.shiftTrigger || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 刺激周期 */}
      <Card title="🔄 刺激周期" icon={Zap}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <Row label="高峰间隔" value={num(report.stimulationCycle.avgPeakInterval, ' 字')} />
            <Row label="冷却长度" value={num(report.stimulationCycle.avgCooldownLength, ' 字')} />
          </div>
          {report.stimulationCycle.cyclePattern.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground block mb-1">标准循环：</span>
              <div className="flex items-center gap-1 flex-wrap">
                {report.stimulationCycle.cyclePattern.map((s, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <Tag label={s} color={STIM_COLORS[s] ?? 'default'} />
                    {i < report.stimulationCycle.cyclePattern.length - 1 && (
                      <span className="text-muted-foreground/40 text-xs">→</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          {stimEntries.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground block mb-1">密度分布：</span>
              <div className="space-y-1">
                {stimEntries.map(([type, density]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16 shrink-0">{type}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(density * 100)}%` }} />
                    </div>
                    <span className="text-xs font-mono w-10 text-right">{pct(density)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* 一致性报告 */}
      <Card title="📋 一致性报告" icon={AlertTriangle}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <Row label="未回收伏笔" value={`${report.consistencyReport.unresolvedForeshadowing} / ${report.consistencyReport.totalForeshadowing}`} />
            <Row label="偏移率" value={report.consistencyReport.driftRate > 0 ? pct(report.consistencyReport.driftRate) : '0%'} />
            <Row label="文风一致性" value={report.consistencyReport.styleConsistencyRate > 0 ? pct(report.consistencyReport.styleConsistencyRate) : '—'} />
          </div>
          {arr(report.consistencyReport.settingConflicts).length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground block mb-1">
                设定冲突（{report.consistencyReport.settingConflicts.length} 处）：
              </span>
              <div className="space-y-2">
                {report.consistencyReport.settingConflicts.map((c, i) => (
                  <div key={i} className="p-2 rounded bg-red-500/5 border border-red-500/10">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-foreground">{c.setting}</span>
                      <Tag label={c.severity} color={c.severity === 'high' ? 'red' : c.severity === 'medium' ? 'yellow' : 'default'} />
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>v1 ({c.v1Location}): {c.v1}</div>
                      <div>v2 ({c.v2Location}): {c.v2}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* 信息释放 */}
      <Card title="📡 信息释放曲线" icon={Zap}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Row label="设定→提示" value={num(report.informationRelease.avgSetupToHint, ' 章')} />
          <Row label="提示→揭秘" value={num(report.informationRelease.avgHintToReveal, ' 章')} />
          <Row label="揭秘密度" value={num(report.informationRelease.revealDensity, ' /章')} />
        </div>
      </Card>

      {/* 事件功能 */}
      {arr(report.eventFunctions).length > 0 && (
        <Card title={`🎯 事件功能标注（${report.eventFunctions.length} 个）`} icon={Link2}>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {report.eventFunctions.slice(0, 20).map((ef, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground/70 shrink-0">{ef.eventId}</span>
                <span className="text-muted-foreground">→</span>
                <div className="flex gap-1">{ef.functions.map((f, j) => <Tag key={j} label={f} />)}</div>
              </div>
            ))}
            {report.eventFunctions.length > 20 && (
              <div className="text-xs text-muted-foreground">…还有 {report.eventFunctions.length - 20} 条</div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================
// 事件图谱查看器
// ============================================

export function EventGraphViewer({ graph }: { graph: FullEventGraph }) {
  const events = graph.events ?? [];
  const eventTypes = [...new Set(events.map(e => e.type))].filter(Boolean);

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <Card title="📊 图谱概览" icon={BarChart3}>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{events.length}</div>
            <div className="text-xs text-muted-foreground">事件总数</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{graph.entityMappings?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground">实体映射</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{graph.foreshadowingPairs?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground">伏笔配对</div>
          </div>
        </div>
      </Card>

      {/* 事件类型分布 */}
      {eventTypes.length > 0 && (
        <Card title="📂 事件类型分布" icon={Activity}>
          <div className="space-y-1.5">
            {eventTypes.map(type => {
              const count = events.filter(e => e.type === type).length;
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{type}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round((count / events.length) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono w-10 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 实体映射 */}
      {arr(graph.entityMappings).length > 0 && (
        <Card title={`🔗 实体映射（${graph.entityMappings.length} 个）`} icon={Link2}>
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">规范名</th>
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">别名</th>
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">类型</th>
                </tr>
              </thead>
              <tbody>
                {graph.entityMappings.map((em, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1 px-2 text-foreground font-medium">{em.canonical}</td>
                    <td className="py-1 px-2 text-muted-foreground">{em.aliases.join('、')}</td>
                    <td className="py-1 px-2"><Tag label={em.type} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 伏笔配对 */}
      {arr(graph.foreshadowingPairs).length > 0 && (
        <Card title={`🔮 伏笔配对（${graph.foreshadowingPairs.length} 对）`} icon={Zap} accent="border-yellow-500/20">
          <div className="max-h-60 overflow-y-auto space-y-1.5">
            {graph.foreshadowingPairs.map((fp, i) => (
              <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/20">
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                  fp.status === 'resolved' ? 'bg-green-500' : fp.status === 'open' ? 'bg-blue-500' : 'bg-yellow-500'
                }`} />
                <span className="font-mono text-muted-foreground shrink-0">{fp.setup}</span>
                <span className="text-muted-foreground/50">→</span>
                <span className={`font-mono ${fp.payoff ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                  {fp.payoff || '(未回收)'}
                </span>
                <span className="text-muted-foreground/50 ml-auto shrink-0">
                  {fp.distance > 0 ? `${fp.distance} 切片` : ''}
                </span>
                <Tag label={fp.status === 'resolved' ? '已回收' : fp.status === 'open' ? '进行中' : '悬空'} color={
                  fp.status === 'resolved' ? 'green' : fp.status === 'open' ? 'blue' : 'yellow'
                } />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 事件列表 */}
      <Card title={`📋 事件列表（${events.length} 个）`} icon={FileText}>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {events.slice(0, 30).map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-muted/30">
              <span className="font-mono text-muted-foreground/70 shrink-0 mt-0.5">{e.id}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-foreground font-medium">{e.description}</span>
                  <Tag label={e.type} />
                  <span className={`text-xs ${e.tensionChange > 0 ? 'text-red-500' : e.tensionChange < 0 ? 'text-green-500' : 'text-muted-foreground'}`}>
                    紧张{e.tensionChange > 0 ? '+' : ''}{e.tensionChange}
                  </span>
                </div>
                <div className="text-muted-foreground mt-0.5">
                  {e.participants.length > 0 && (
                    <span>👥 {e.participants.join('、')} · </span>
                  )}
                  <span>📍 {e.location}</span>
                  {e.emotion && <span> · 💭 {e.emotion}</span>}
                  {e.foreshadowingOf && <span> · 🔮 → {e.foreshadowingOf}</span>}
                </div>
              </div>
              <span className="text-muted-foreground/50 text-xs shrink-0">{Math.round(e.confidence * 100)}%</span>
            </div>
          ))}
          {events.length > 30 && (
            <div className="text-xs text-muted-foreground text-center py-2">…还有 {events.length - 30} 个事件</div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ============================================
// 统一入口
// ============================================

export function AnalysisResultViewer({
  type,
  data,
}: {
  type: 'dna' | 'summary' | 'event-graph';
  data: unknown;
}) {
  if (!data) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        暂无数据
      </div>
    );
  }

  // 简单验证数据结构是否基本正确
  const isValid = typeof data === 'object';
  if (!isValid) {
    return (
      <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        <p className="text-sm text-destructive">数据格式错误：无法解析为对象</p>
      </div>
    );
  }

  switch (type) {
    case 'dna':
      return <DNAViewer dna={data as GenerationRulesDNA} />;
    case 'summary':
      return <SummaryViewer report={data as SummaryReport} />;
    case 'event-graph':
      return <EventGraphViewer graph={data as FullEventGraph} />;
  }
}
