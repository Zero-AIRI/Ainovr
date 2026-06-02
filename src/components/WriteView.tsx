// ============================================
// 仿写视图 — 输入设定，AI 风格仿写
// ============================================

'use client';

import { useState, useCallback } from 'react';
import { Download, RefreshCw, Sparkles } from 'lucide-react';
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

export function WriteView() {
  const novels = useAppStore((s) => s.novels);
  const analysisReport = useAppStore((s) => s.analysisReport);
  const apiKey = useAppStore((s) => s.apiKey);
  const model = useAppStore((s) => s.model);
  const providerType = useAppStore((s) => s.providerType);
  const baseURL = useAppStore((s) => s.baseURL);
  const isWriting = useAppStore((s) => s.isWriting);
  const setIsWriting = useAppStore((s) => s.setIsWriting);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const [genre, setGenre] = useState('玄幻');
  const [length, setLength] = useState<WriteLength>('chapter');
  const [synopsis, setSynopsis] = useState('');
  const [extraRequirements, setExtraRequirements] = useState('');
  const [streamContent, setStreamContent] = useState('');

  const canWrite = synopsis.trim().length > 0 && !!analysisReport && !!apiKey;

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
          existingText: streamContent.slice(-3000),
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        setStreamContent((prev) => prev + chunk);
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

  // 没有分析报告
  if (!analysisReport) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <Sparkles className="w-12 h-12 text-primary/40 mx-auto" />
          <p className="text-muted-foreground">请先在左侧完成风格分析</p>
          <Button
            variant="outline"
            onClick={() => setActiveView('analyze')}
          >
            去分析
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 参考风格提示 */}
        <div className="text-sm text-muted-foreground">
          参考风格：{novels.map((n) => `《${n.title}》`).join('、')}
        </div>

        {/* 创作设定 */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* 故事类型 */}
            <div className="space-y-2">
              <Label>故事类型</Label>
              <Select value={genre} onValueChange={(v) => v !== null && setGenre(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENRE_OPTIONS.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 篇幅 */}
            <div className="space-y-2">
              <Label>篇幅</Label>
              <Select value={length} onValueChange={(v) => v !== null && setLength(v as WriteLength)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
            <Label>故事梗概</Label>
            <Textarea
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="描述你想写的故事，例如：一个少年偶然获得上古传承，在修仙世界中步步为营..."
              rows={3}
              className="resize-none"
            />
          </div>

          {/* 额外要求 */}
          <div className="space-y-2">
            <Label>
              额外要求 <span className="text-muted-foreground/60 font-normal">（可选）</span>
            </Label>
            <Input
              value={extraRequirements}
              onChange={(e) => setExtraRequirements(e.target.value)}
              placeholder="例如：主角性格冷酷、多用古风词汇、节奏偏快..."
            />
          </div>
        </div>

        {/* 仿写结果 */}
        {streamContent ? (
          <div className="rounded-xl border border-border bg-card p-6 max-h-[50vh] overflow-y-auto">
            <StreamingText content={streamContent} isStreaming={isWriting} />
          </div>
        ) : isWriting ? (
          <div className="rounded-xl border border-border bg-card p-6 min-h-[200px] flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" />
              AI 正在创作中...
            </div>
          </div>
        ) : null}

        {/* 操作按钮 */}
        <div className="flex items-center gap-3">
          <Button
            onClick={startWriting}
            disabled={!canWrite || isWriting}
            className="flex-1"
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
              >
                继续写
              </Button>
              <Button
                onClick={handleExport}
                variant="outline"
              >
                <Download className="w-4 h-4 mr-1" />
                导出
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
