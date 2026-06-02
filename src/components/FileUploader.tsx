// ============================================
// 文件上传组件 — 拖拽/点击上传 TXT
// ============================================

'use client';

import { useCallback, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { parseTxtFile, formatCharCount } from '@/lib/file-parser';
import { useAppStore } from '@/lib/store';
import type { ParsedNovel } from '@/types';

export function FileUploader() {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const addNovel = useAppStore((s) => s.addNovel);
  const novels = useAppStore((s) => s.novels);
  const removeNovel = useAppStore((s) => s.removeNovel);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsLoading(true);
      try {
        const fileArr = Array.from(files);
        for (const file of fileArr) {
          if (!file.name.endsWith('.txt')) {
            alert(`"${file.name}" 不是 TXT 文件，已跳过`);
            continue;
          }
          // 检查重复
          if (novels.some((n) => n.title === file.name.replace(/\.txt$/i, ''))) {
            alert(`"${file.name}" 已存在，跳过`);
            continue;
          }
          const novel = await parseTxtFile(file);
          addNovel(novel);
        }
      } catch (err) {
        alert(`文件解析失败: ${err instanceof Error ? err.message : '未知错误'}`);
      } finally {
        setIsLoading(false);
      }
    },
    [addNovel, novels],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="space-y-4">
      {/* 上传区域 */}
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          flex flex-col items-center justify-center gap-3
          w-full h-48 rounded-xl border-2 border-dashed cursor-pointer
          transition-all duration-200
          ${isDragging
            ? 'border-violet-400 bg-violet-500/10'
            : 'border-gray-600 hover:border-gray-400 bg-gray-800/50'
          }
          ${isLoading ? 'pointer-events-none opacity-50' : ''}
        `}
      >
        <input
          type="file"
          accept=".txt"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <Upload className={`w-10 h-10 ${isDragging ? 'text-violet-400' : 'text-gray-500'}`} />
        <div className="text-center">
          <p className="text-gray-300 text-sm">
            {isLoading ? '正在解析...' : '拖拽或点击上传小说'}
          </p>
          <p className="text-gray-500 text-xs mt-1">支持 .txt 文件，可同时上传多本</p>
        </div>
      </label>

      {/* 已上传列表 */}
      {novels.length > 0 && (
        <div className="space-y-2">
          {novels.map((novel) => (
            <div
              key={novel.id}
              className="flex items-center gap-3 px-4 py-3 bg-gray-800/60 rounded-lg group"
            >
              <FileText className="w-5 h-5 text-violet-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">《{novel.title}》</p>
                <p className="text-xs text-gray-500">{formatCharCount(novel.totalChars)}</p>
              </div>
              <button
                onClick={() => removeNovel(novel.id)}
                className="text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                title="移除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
