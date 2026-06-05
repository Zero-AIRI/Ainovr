// ============================================
// 素材库视图 — 双标签页（小说管理 | 文风/情节库）
// ============================================

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { parseTxtFile, formatCharCount } from '@/lib/file-parser';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useProjectStore } from '@/lib/store/project';
import { SourceNovelCard } from './SourceNovelCard';
import { StylePlotLibraryView } from './StylePlotLibraryView';
import type { SourceNovel } from '@/types';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function SourceLibraryView() {
  const { sourceNovels, loadSourceNovels, addSourceNovel, updateSourceNovel, setActiveSourceId } = useSourceLibraryStore();
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'novels' | 'library'>('novels');

  useEffect(() => {
    loadSourceNovels();
  }, [loadSourceNovels]);

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    setIsLoading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`"${file.name}" 超过 20MB 限制`);
          continue;
        }
        if (!file.name.endsWith('.txt')) {
          toast.error(`"${file.name}" 不是 TXT 文件`);
          continue;
        }

        const parsed = await parseTxtFile(file);

        const sourceNovel: SourceNovel = {
          id: parsed.id,
          title: parsed.title,
          totalChars: parsed.totalChars,
          importConfig: parsed.importConfig,
          status: 'raw',
          createdAt: new Date().toISOString(),
          processedAt: null,
          slices: null,
          styleProfile: null,
          plotReport: null,
          representativeSamples: null,
        };

        const res = await fetch('/api/library/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: sourceNovel.id,
            title: sourceNovel.title,
            rawText: parsed.fullText,
            totalChars: sourceNovel.totalChars,
            importConfig: sourceNovel.importConfig,
          }),
        });

        if (res.ok) {
          addSourceNovel(sourceNovel);
          toast.success(`《${sourceNovel.title}》已添加到素材库`);
        } else {
          toast.error(`上传《${sourceNovel.title}》失败`);
        }
      }
    } catch (err) {
      toast.error(`文件处理失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [addSourceNovel]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      useSourceLibraryStore.getState().removeSourceNovel(id);
      toast.success('已删除');
    } catch (err) {
      toast.error('删除失败');
    }
  }, []);

  const handleOpenDetail = useCallback((id: string) => {
    setActiveSourceId(id);
    setActiveView('source-detail');
  }, [setActiveSourceId, setActiveView]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      {/* 标题 + 标签切换 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-foreground">素材库</h1>

        {/* 上传按钮 */}
        <label
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleUpload(e.dataTransfer.files); }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer text-sm transition-colors
            ${isDragging ? 'bg-primary/10 text-primary border border-primary' : 'bg-primary/5 text-primary hover:bg-primary/10'}
            ${isLoading ? 'pointer-events-none opacity-50' : ''}
          `}
        >
          <input
            type="file"
            accept=".txt"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) handleUpload(e.target.files); e.target.value = ''; }}
          />
          <Upload className="w-4 h-4" />
          {isLoading ? '上传中...' : '添加小说'}
        </label>
      </div>

      {/* 标签页 */}
      <div className="flex gap-1 mb-4 border-b border-border">
        <button
          onClick={() => setActiveTab('novels')}
          className={`
            px-4 py-2 text-sm font-medium transition-colors relative
            ${activeTab === 'novels' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}
          `}
        >
          小说管理
          {activeTab === 'novels' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('library')}
          className={`
            px-4 py-2 text-sm font-medium transition-colors relative
            ${activeTab === 'library' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}
          `}
        >
          文风/情节库
          {activeTab === 'library' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
      </div>

      {/* 标签页内容 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'novels' && (
          <div className="h-full overflow-y-auto">
            {sourceNovels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Upload className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">拖拽或点击上传 .txt 小说文件</p>
                <p className="text-xs mt-1 opacity-60">添加到素材库后可进行文风和情节分析</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sourceNovels.map((novel) => (
                  <SourceNovelCard
                    key={novel.id}
                    novel={novel}
                    onClick={() => handleOpenDetail(novel.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === 'library' && (
          <StylePlotLibraryView />
        )}
      </div>
    </div>
  );
}
