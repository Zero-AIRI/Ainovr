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

export function HierarchyTree({ outline, phases, volumes, chapterSets, chapterPlans }: HierarchyTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
      <div className="mb-1">
        <div
          onClick={() => toggle('outline')}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer"
        >
          {expanded.has('outline') ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <FileText className="w-3 h-3 text-primary" />
          <span className="font-medium">全书大纲</span>
        </div>
        {expanded.has('outline') && (
          <div className="ml-6 p-2 text-muted-foreground whitespace-pre-wrap line-clamp-4">
            {outline.content}
          </div>
        )}
      </div>

      {/* Layer 2: 阶段 */}
      {phases?.map((phase) => (
        <div key={phase.id} className="ml-2">
          <div
            onClick={() => toggle(phase.id)}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer"
          >
            {expanded.has(phase.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span>{phase.title}</span>
          </div>

          {expanded.has(phase.id) && (
            <div className="ml-4">
              <div className="px-2 py-1 text-muted-foreground whitespace-pre-wrap line-clamp-3">
                {phase.content}
              </div>

              {/* Layer 3: 卷 */}
              {phasesForVolume(phase.id).map((vol) => (
                <div key={vol.id} className="ml-2">
                  <div
                    onClick={() => toggle(vol.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer"
                  >
                    {expanded.has(vol.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>{vol.title}</span>
                  </div>

                  {expanded.has(vol.id) && (
                    <div className="ml-4">
                      <div className="px-2 py-1 text-muted-foreground whitespace-pre-wrap line-clamp-3">
                        {vol.content}
                      </div>

                      {/* Layer 4: 章节集合 */}
                      {setsForVolume(vol.id).map((set) => (
                        <div key={set.id} className="ml-2">
                          <div
                            onClick={() => toggle(set.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer"
                          >
                            {expanded.has(set.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            <span>{set.title}</span>
                          </div>

                          {expanded.has(set.id) && (
                            <div className="ml-4">
                              <div className="px-2 py-1 text-muted-foreground whitespace-pre-wrap line-clamp-2">
                                {set.content}
                              </div>

                              {/* Layer 5: 章节计划 */}
                              {plansForSet(set.id).map((plan) => (
                                <div key={plan.id} className="ml-2 px-2 py-0.5 text-muted-foreground">
                                  <FileText className="w-3 h-3 inline mr-1" />
                                  {plan.title}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
