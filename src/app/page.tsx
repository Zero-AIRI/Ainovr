// ============================================
// 首页 — Sidebar + 条件渲染视图
// ============================================

'use client';

import { useAppStore } from '@/lib/store';
import { Sidebar } from '@/components/Sidebar';
import { WelcomeView } from '@/components/WelcomeView';
import { ChatView } from '@/components/ChatView';
import { AnalyzeView } from '@/components/AnalyzeView';
import { WriteView } from '@/components/WriteView';
import { SyncProvider } from '@/lib/sync/sync-provider';

export default function HomePage() {
  const activeView = useAppStore((s) => s.activeView);

  return (
    <SyncProvider>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden bg-background">
          {activeView === 'welcome' && <WelcomeView />}
          {activeView === 'chat' && <ChatView />}
          {activeView === 'analyze' && <AnalyzeView />}
          {activeView === 'write' && <WriteView />}
        </main>
      </div>
    </SyncProvider>
  );
}
