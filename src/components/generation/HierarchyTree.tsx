// ============================================
// 层级树 — 可视化大纲/阶段/卷/集合/章的层级
// ============================================

'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText } from 'lucide-react';
import type { Phase, Volume, ChapterSet, ChapterPlan, BookOutline } from '@/types';

interface HierarchyTreeProps {
  outline: BookOutline | null;
  phases: Phase[] | null;
  volumes: Volume[] | null;
  chapterSets: ChapterSet[] | null;
  chapterPlans: ChapterPlan[] | null;
}

/** 可折叠的树节点 */
function TreeNode({
  label,
  icon,
  children,
  defaultExpanded = false,
  content,
}: {
  label: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
  content?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [contentExpanded, setContentExpanded] = useState(false);
  const hasLongContent = !!(content && content.length > 100);

  return (
    <div className="mb-1">
      {/* 标题行：展开全文按钮紧跟标题 */}
      <div
        onClick={() => { setExpanded((e) => !e); if (!expanded) setContentExpanded(false); }}
        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer"
      >
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        {icon}
        <span className="font-medium truncate">{label}</span>
        {hasLongContent && expanded && !contentExpanded && (
          <button
            onClick={(e) => { e.stopPropagation(); setContentExpanded(true); }}
            className="shrink-0 text-primary hover:underline text-xs ml-1"
          >
            展开全文
          </button>
        )}
      </div>

      {expanded && (
        <div className="ml-4 relative">
          {content && (
            <div className="px-2 py-1 text-muted-foreground whitespace-pre-wrap">
              <span className={contentExpanded ? '' : 'line-clamp-3'}>{content}</span>
            </div>
          )}
          {/* 展开后 sticky 收起按钮，跟随滚动 */}
          {hasLongContent && contentExpanded && (
            <div className="sticky bottom-0 flex justify-center py-1 bg-background/80 backdrop-blur-sm border-t border-border/50">
              <button
                onClick={(e) => { e.stopPropagation(); setContentExpanded(false); }}
                className="px-3 py-0.5 rounded text-xs text-primary hover:bg-primary/10 transition-colors"
              >
                收起全文
              </button>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export function HierarchyTree({ outline, phases, volumes, chapterSets, chapterPlans }: HierarchyTreeProps) {
  if (!outline) {
    return (
      <div className="p-3 text-xs text-muted-foreground text-center">
        尚未生成大纲
      </div>
    );
  }

  const phasesForVolume = (phaseId: string) => volumes?.filter((v) => v.phaseId === phaseId) ?? [];
  const setsForVolume = (volumeId: string) => chapterSets?.filter((s) => s.volumeId === volumeId) ?? [];
  const plansForSet = (setId: string) => chapterPlans?.filter((p) => p.chapterSetId === setId) ?? [];

  return (
    <div className="text-xs">
      {/* Layer 1: 大纲 */}
      <TreeNode
        label="全书大纲"
        icon={<FileText className="w-3 h-3 text-primary shrink-0" />}
        defaultExpanded={false}
        content={outline.content}
      />

      {/* Layer 2: 阶段 */}
      {phases?.map((phase) => (
        <div key={phase.id} className="ml-2">
          <TreeNode
            label={phase.title}
            content={phase.content}
          >
            {/* Layer 3: 卷 */}
            {phasesForVolume(phase.id).map((vol) => (
              <div key={vol.id} className="ml-2">
                <TreeNode
                  label={vol.title}
                  content={vol.content}
                >
                  {/* Layer 4: 章节集合 */}
                  {setsForVolume(vol.id).map((set) => (
                    <div key={set.id} className="ml-2">
                      <TreeNode
                        label={set.title}
                        content={set.content}
                      >
                        {/* Layer 5: 章节计划 */}
                        {plansForSet(set.id).map((plan) => (
                          <div key={plan.id} className="ml-2 px-2 py-0.5 text-muted-foreground">
                            <FileText className="w-3 h-3 inline mr-1" />
                            {plan.title}
                          </div>
                        ))}
                      </TreeNode>
                    </div>
                  ))}
                </TreeNode>
              </div>
            ))}
          </TreeNode>
        </div>
      ))}
    </div>
  );
}
