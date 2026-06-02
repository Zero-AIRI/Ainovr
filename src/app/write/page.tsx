// ============================================
// 仿写页 — 输入设定，AI 风格仿写
// ============================================

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, RefreshCw, Sparkles } from 'lucide-react';
import { saveAs } from 'file-saver';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Navbar } from '@/components/Navbar';
import { SettingsDialog } from '@/components/SettingsDialog';
import { StreamingText } from '@/components/StreamingText';
import { useAppStore } from '@/lib/store';
import type { WriteLength } from '@/types';

const GENRE_OPTIONS = [
  '玄幻', '仙侠', '都市', '历史', '科幻',
  '悬疑', '奇幻', '武侠', '言情', '游戏',
  '末世', '灵异', '军事', '校园', '其他',
];

const LENGTH_OPTIONS: { value: WriteLength; label: string; desc: string }[] = [
  { value: 'fragment', label: '片段', desc: '约500-1000字' },
  { value: 'chapter', label: '章节', desc: '约2000-4000字' },
  { value: 'short', label: '短篇', desc: '约3000-8000字' },
];

export default function WritePage() {
  const router = useRouter();
  const novels = useAppStore((s) => s.novels);
  const analysisReport = useAppStore((s) => s.analysisReport);
  const apiKey = useAppStore((s) => s.apiKey);
  const model = useAppStore((s) => s.model);
  const providerType = useAppStore((s) => s.providerType);
  const baseURL = useAppStore((s) => s.baseURL);
  const isWriting = useAppStore((s) => s.isWriting);
  const setIsWriting = useAppStore((s) => s.setIsWriting);

  const [genre, setGenre] = useState('玄幻');
  const [length, setLength] = useState<WriteLength>('chapter');
  const [synopsis, setSynopsis] = useState('');
  const [extraRequirements, setExtraRequirements] = useState('');
  const [streamContent, setStreamContent] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const canWrite = synopsis.trim().length > 0 && analysisReport && apiKey;

  const startWriting = useCallback(async () => {
    if (!canWrite) return;

    setIsWriting(true);
    setStreamContent('');

    try {
      const response = await fetch('/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'write',
          analysisReport,
          genre,
          length,
          synopsis,
          extraRequirements: extraRequirements || undefined,
          provider: providerType,
          apiKey,
          model,
          baseURL: baseURL || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || '仿写请求失败');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamContent(fullText);
      }
    } catch (err) {
      alert(`仿写失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsWriting(false);
    }
  }, [canWrite, analysisReport, genre, length, synopsis, extraRequirements, providerType, apiKey, model, baseURL, setIsWriting]);

  const handleContinue = useCallback(async () => {
    if (!streamContent || !analysisReport) return;

    setIsWriting(true);

    try {
      const response = await fetch('/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'continue',
          analysisReport,
          existingText: streamContent.slice(-3000), // 送入最后3000字
          provider: providerType,
          apiKey,
          model,
          baseURL: baseURL || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || '续写请求失败');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let appended = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        appended += chunk;
        setStreamContent((prev) => prev + chunk);
        appended = '';
      }
    } catch (err) {
      alert(`续写失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsWriting(false);
    }
  }, [streamContent, analysisReport, providerType, apiKey, model, baseURL, setIsWriting]);

  const handleExport = () => {
    if (!streamContent) return;
    const blob = new Blob([streamContent], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `仿写_${genre}_${Date.now()}.txt`);
  };

  // 没有分析报告，引导去分析页
  if (!analysisReport) {
    return (
      <div className="flex flex-col min-h-screen">
        <Navbar onSettingsClick={() => setSettingsOpen(true)} />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-4">
            <Sparkles className="w-12 h-12 text-violet-500/50 mx-auto" />
            <p className="text-gray-400">请先上传并分析小说风格</p>
            <Button
              onClick={() => router.push('/')}
              className="bg-violet-600 hover:bg-violet-500"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              去上传
            </Button>
          </div>
        </main>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar onSettingsClick={() => setSettingsOpen(true)} />

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* 参考风格提示 */}
          <div className="text-sm text-gray-500">
            参考风格：{novels.map((n) => `《${n.title}》`).join('、')}
          </div>

          {/* 创作设定 */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* 故事类型 */}
              <div className="space-y-2">
                <Label className="text-gray-300">故事类型</Label>
                <Select value={genre} onValueChange={(v) => v !== null && setGenre(v)}>
                  <SelectTrigger className="bg-gray-800 border-gray-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-600">
                    {GENRE_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 篇幅 */}
              <div className="space-y-2">
                <Label className="text-gray-300">篇幅</Label>
                <Select value={length} onValueChange={(v) => v !== null && setLength(v as WriteLength)}>
                  <SelectTrigger className="bg-gray-800 border-gray-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-600">
                    {LENGTH_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}（{opt.desc}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 故事梗概 */}
            <div className="space-y-2">
              <Label className="text-gray-300">故事梗概</Label>
              <Textarea
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="描述你想写的故事，例如：一个少年偶然获得上古传承，在修仙世界中步步为营..."
                rows={3}
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 resize-none"
              />
            </div>

            {/* 额外要求 */}
            <div className="space-y-2">
              <Label className="text-gray-300">
                额外要求 <span className="text-gray-600">（可选）</span>
              </Label>
              <Input
                value={extraRequirements}
                onChange={(e) => setExtraRequirements(e.target.value)}
                placeholder="例如：主角性格冷酷、多用古风词汇、节奏偏快..."
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500"
              />
            </div>
          </div>

          {/* 仿写结果 */}
          {streamContent ? (
            <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-6 max-h-[50vh] overflow-y-auto">
              <StreamingText content={streamContent} isStreaming={isWriting} />
            </div>
          ) : isWriting ? (
            <div className="bg-gray-900/60 rounded-xl border border-gray-800 p-6 min-h-[200px] flex items-center justify-center">
              <div className="flex items-center gap-2 text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                AI 正在创作中...
              </div>
            </div>
          ) : null}

          {/* 操作按钮 */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => router.push('/analyze')}
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              返回
            </Button>

            <Button
              onClick={startWriting}
              disabled={!canWrite || isWriting}
              className="bg-violet-600 hover:bg-violet-500 flex-1"
            >
              {isWriting ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                  创作中...
                </>
              ) : streamContent ? '重新创作' : '开始仿写'}
            </Button>

            {streamContent && !isWriting && (
              <>
                <Button
                  onClick={handleContinue}
                  variant="outline"
                  className="border-violet-700 text-violet-300 hover:bg-violet-900/30"
                >
                  继续写
                </Button>
                <Button
                  onClick={handleExport}
                  variant="outline"
                  className="border-gray-700 text-gray-300 hover:bg-gray-800"
                >
                  <Download className="w-4 h-4 mr-1" />
                  导出
                </Button>
              </>
            )}
          </div>
        </div>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
