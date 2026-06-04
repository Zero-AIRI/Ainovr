// ============================================
// 首页 — Sidebar + 条件渲染视图
// ============================================

'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Sidebar } from '@/components/Sidebar';
import { WelcomeView } from '@/components/WelcomeView';
import { ChatView } from '@/components/ChatView';
import { AnalyzeView } from '@/components/AnalyzeView';
import { WriteView } from '@/components/WriteView';
export default function HomePage() {
  const activeView = useAppStore((s) => s.activeView);
  const loadNovelsFromIDB = useAppStore((s) => s.loadNovelsFromIDB);
  const addNovel = useAppStore((s) => s.addNovel);

  // 启动时从 IndexedDB 恢复小说数据，然后检测服务端 data/ 文件夹中的新书
  useEffect(() => {
    const init = async () => {
      await loadNovelsFromIDB();

      // 自动检测 data/novels/ 中的小说（用户直接复制到 data 文件夹的文件）
      try {
        const listRes = await fetch('/api/novels/list');
        if (!listRes.ok) return;
        const { novels: serverNovels } = await listRes.json();
        if (!serverNovels?.length) return;

        const existingIds = new Set(useAppStore.getState().novels.map((n) => n.id));

        for (const info of serverNovels) {
          if (existingIds.has(info.id)) continue;

          // 加载完整小说数据
          const detailRes = await fetch(`/api/novels/detail?id=${encodeURIComponent(info.id)}`);
          if (!detailRes.ok) continue;
          const { novel } = await detailRes.json();
          if (novel) {
            addNovel(novel);
          }
        }
      } catch (err) {
        console.error('自动检测 data/ 文件夹失败:', err);
      }
    };

    init();
  }, [loadNovelsFromIDB, addNovel]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        {activeView === 'welcome' && <WelcomeView />}
        {activeView === 'chat' && <ChatView />}
        {activeView === 'analyze' && <AnalyzeView />}
        {activeView === 'write' && <WriteView />}
      </main>
    </div>
  );
}
