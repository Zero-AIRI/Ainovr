// ============================================
// 首页 — Sidebar + 条件渲染视图
// ============================================

'use client';

import { useEffect } from 'react';
import { useProjectStore } from '@/lib/store/project';
import { useNavigationStore } from '@/lib/store/navigation';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { Sidebar } from '@/components/Sidebar';
import { SourceLibraryView } from '@/components/source/SourceLibraryView';
import { SourceNovelDetailView } from '@/components/source/SourceNovelDetailView';

import { WritingProjectView } from '@/components/project/WritingProjectView';
import { PromptManagementView } from '@/components/prompts/PromptManagementView';

export default function HomePage() {
  const activeView = useNavigationStore((s) => s.activeView);
  const loadSourceNovels = useSourceLibraryStore((s) => s.loadSourceNovels);
  const loadProjects = useProjectStore((s) => s.loadProjects);

  useEffect(() => {
    loadSourceNovels();
    loadProjects();
  }, [loadSourceNovels, loadProjects]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        {activeView === 'source-library' && <SourceLibraryView />}
        {activeView === 'source-detail' && <SourceNovelDetailView />}
        {activeView === 'writing-project' && <WritingProjectView />}
        {activeView === 'prompt-management' && <PromptManagementView />}
      </main>
    </div>
  );
}
