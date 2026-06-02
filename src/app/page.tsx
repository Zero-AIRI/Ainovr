// ============================================
// 首页 — 上传小说
// ============================================

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { FileUploader } from '@/components/FileUploader';
import { Navbar } from '@/components/Navbar';
import { SettingsDialog } from '@/components/SettingsDialog';
import { useAppStore } from '@/lib/store';

export default function HomePage() {
  const router = useRouter();
  const novels = useAppStore((s) => s.novels);
  const apiKey = useAppStore((s) => s.apiKey);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const canAnalyze = novels.length > 0 && apiKey.trim().length > 0;

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar onSettingsClick={() => setSettingsOpen(true)} />

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-8">
          {/* 标题 */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-purple-300 bg-clip-text text-transparent">
              上传你喜欢的小说
            </h1>
            <p className="text-gray-500 text-sm">
              AI 将分析文风、剧情、人物塑造等特征，然后进行风格仿写
            </p>
          </div>

          {/* 上传区域 */}
          <FileUploader />

          {/* 开始分析按钮 */}
          <Button
            onClick={() => canAnalyze && router.push('/analyze')}
            disabled={!canAnalyze}
            className="w-full h-12 text-base bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-500 rounded-xl transition-all"
          >
            {novels.length === 0
              ? '请先上传小说'
              : !apiKey.trim()
                ? '请先配置 API Key ⚙️'
                : `分析 ${novels.length} 本小说的风格 →`}
          </Button>

          {novels.length > 0 && !apiKey.trim() && (
            <p className="text-center text-xs text-gray-600">
              点击右上角 ⚙️ 配置 AI 后端
            </p>
          )}
        </div>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
