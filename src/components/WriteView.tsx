// ============================================
// 仿写视图 — 输入设定，AI 风格仿写
// ============================================

'use client';

import { useState, useEffect } from 'react';
import { Download, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
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
import { useStreamingFetch } from '@/lib/hooks/use-streaming-fetch';
import { needsApiKey, type WriteLength } from '@/types';

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
  const providerType = useAppStore((s) => s.providerType);
  const apiKey = useAppStore((s) => s.apiKey);
  const model = useAppStore((s) => s.model);
  const baseURL = useAppStore((s) => s.baseURL);
  const thinkingMode = useAppStore((s) => s.thinkingMode);
  const thinkingEffort = useAppStore((s) => s.thinkingEffort);
  const customProviders = useAppStore((s) => s.customProviders);
  const isWriting = useAppStore((s) => s.isWriting);
  const writeResult = useAppStore((s) => s.writeResult);
  const setIsWriting = useAppStore((s) => s.setIsWriting);
  const setWriteResult = useAppStore((s) => s.setWriteResult);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const [genre, setGenre] = useState('玄幻');
  const [length, setLength] = useState<WriteLength>('chapter');
  const [synopsis, setSynopsis] = useState('');
  const [extraRequirements, setExtraRequirements] = useState('');

  const { streamContent, isStreaming, error, startFetch, setStreamContent, abortRef } = useStreamingFetch();

  // 组件挂载时从 store 恢复已有写作结果
  useEffect(() => {
    if (writeResult) {
      setStreamContent(writeResult);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 同步 streaming 状态到 store
  useEffect(() => {
    setIsWriting(isStreaming);
  }, [isStreaming, setIsWriting]);

  // 显示错误 toast
  useEffect(() => {
    if (error) {
      toast.error(`仿写失败: ${error}`);
    }
  }, [error]);

  // ollama/custom 不强制要求 apiKey
  const canWrite = synopsis.trim().length > 0 && !!analysisReport && (!needsApiKey(providerType) || !!apiKey);

  // 构造通用 AI 参数（仅在请求时构建，避免作为 useCallback 依赖导致每次 render 重建）
  const buildAIBody = () => ({
    provider: providerType,
    apiKey,
    model,
    baseURL: baseURL || undefined,
    thinkingMode,
    thinkingEffort,
    customProviders,
  });

  const startWriting = async () => {
    if (!canWrite) return;

    const fullText = await startFetch('/api/write', {
      mode: 'write',
      analysisReport,
      genre,
      length,
      synopsis,
      extraRequirements: extraRequirements || undefined,
      ...buildAIBody(),
    });

    if (fullText) {
      setWriteResult(fullText);
    }
  };

  const handleContinue = async () => {
    if (!streamContent || !analysisReport) return;

    // 续写需要特殊处理：使用 setStreamContent 追加而非覆盖
    // 所以不走 startFetch，直接手写（但带 AbortController）
    const controller = new AbortController();
    abortRef.current = controller; // 让 hook 的 unmount cleanup 能 abort 这次请求

    setIsWriting(true);

    try {
      const response = await fetch('/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'continue',
          analysisReport,
          existingText: streamContent.slice(-3000),
          ...buildAIBody(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || '续写请求失败');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let continuation = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        continuation += chunk;
        setStreamContent((prev) => prev + chunk);
      }

      setWriteResult(streamContent + continuation);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error(`续写失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsWriting(false);
    }
  };

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
