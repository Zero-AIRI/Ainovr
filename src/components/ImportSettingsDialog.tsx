// ============================================
// 导入设置弹窗 — 清洗预设 + 采样策略
// ============================================

'use client';

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type {
  CleaningPreset,
  CleaningStepId,
  SamplingStrategy,
  ImportConfig,
} from '@/types';
import { ALL_CLEANING_STEPS, resolveCleaningSteps } from '@/lib/text-cleaner';
import { DEFAULT_IMPORT_CONFIG } from '@/lib/file-parser';
import { useAppStore } from '@/lib/store';
import { safeInt } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ImportSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 如果提供，则进入"重新处理此小说"模式 */
  novelId?: string;
}

/** 清洗步骤中文标签 */
const STEP_LABELS: Record<CleaningStepId, string> = {
  encoding: '编码清理（BOM / 零宽字符 / 混合换行）',
  urls: 'URL 行',
  promos: '广告推广行（笔趣阁、最新章节等）',
  authorNotes: '作者碎碎念（PS、求月票等）',
  watermarks: '水印 / 来源行',
  nav: '导航行（上一章、下一章等）',
  separators: '分隔线（====、---- 等）',
  toc: '目录块（连续章节标题）',
  punctuation: '标点规范化（半角 → 全角）',
  blankLines: '空行整理',
};

const PRESET_LABELS: Record<CleaningPreset, string> = {
  aggressive: '激进 — 清理全部 10 个步骤',
  standard: '标准 — 跳过广告和作者碎碎念',
  light: '轻度 — 仅编码、标点、空行',
  none: '手动 — 自行选择步骤',
};

const STRATEGY_LABELS: Record<SamplingStrategy, string> = {
  full: '全文保留',
  chapter: '章节采样',
  fixedLength: '固定长度采样',
  customLimit: '自定义字数上限',
};

export function ImportSettingsDialog({
  open,
  onOpenChange,
  novelId,
}: ImportSettingsDialogProps) {
  const storeImportConfig = useAppStore((s) => s.importConfig);
  const novels = useAppStore((s) => s.novels);
  const updateImportConfig = useAppStore((s) => s.updateImportConfig);
  const reprocessNovel = useAppStore((s) => s.reprocessNovel);
  const reprocessAllNovels = useAppStore((s) => s.reprocessAllNovels);

  // ---- 本地编辑状态（提交时才写入 store） ----

  const [cleaningPreset, setCleaningPreset] = useState<CleaningPreset>(
    DEFAULT_IMPORT_CONFIG.cleaning.preset,
  );
  const [enabledSteps, setEnabledSteps] = useState<CleaningStepId[]>(
    DEFAULT_IMPORT_CONFIG.cleaning.enabledSteps,
  );
  const [samplingStrategy, setSamplingStrategy] = useState<SamplingStrategy>(
    DEFAULT_IMPORT_CONFIG.sampling.strategy,
  );
  const [headCount, setHeadCount] = useState(DEFAULT_IMPORT_CONFIG.sampling.chapter.headCount);
  const [midCount, setMidCount] = useState(DEFAULT_IMPORT_CONFIG.sampling.chapter.midCount);
  const [tailCount, setTailCount] = useState(DEFAULT_IMPORT_CONFIG.sampling.chapter.tailCount);
  const [randomCount, setRandomCount] = useState(DEFAULT_IMPORT_CONFIG.sampling.chapter.randomCount);
  const [headRatio, setHeadRatio] = useState(DEFAULT_IMPORT_CONFIG.sampling.fixedLength.headRatio);
  const [midRatio, setMidRatio] = useState(DEFAULT_IMPORT_CONFIG.sampling.fixedLength.midRatio);
  const [tailRatio, setTailRatio] = useState(DEFAULT_IMPORT_CONFIG.sampling.fixedLength.tailRatio);
  const [customCharLimit, setCustomCharLimit] = useState(
    DEFAULT_IMPORT_CONFIG.sampling.customCharLimit,
  );
  const [maxCharsOverride, setMaxCharsOverride] = useState<number | null>(
    DEFAULT_IMPORT_CONFIG.sampling.maxCharsOverride,
  );

  const [isReprocessing, setIsReprocessing] = useState(false);

  /** 将 ImportConfig 同步到本地状态 */
  const loadConfig = (src: ImportConfig) => {
    setCleaningPreset(src.cleaning.preset);
    setEnabledSteps(src.cleaning.enabledSteps);
    setSamplingStrategy(src.sampling.strategy);
    setHeadCount(src.sampling.chapter.headCount);
    setMidCount(src.sampling.chapter.midCount);
    setTailCount(src.sampling.chapter.tailCount);
    setRandomCount(src.sampling.chapter.randomCount);
    setHeadRatio(src.sampling.fixedLength.headRatio);
    setMidRatio(src.sampling.fixedLength.midRatio);
    setTailRatio(src.sampling.fixedLength.tailRatio);
    setCustomCharLimit(src.sampling.customCharLimit);
    setMaxCharsOverride(src.sampling.maxCharsOverride);
    setIsReprocessing(false);
  };

  // 弹窗打开时初始化本地状态
  useEffect(() => {
    if (!open) return;

    const src = novelId
      ? (novels.find((n) => n.id === novelId)?.importConfig ?? DEFAULT_IMPORT_CONFIG)
      : storeImportConfig;

    loadConfig(src);
  }, [open, novelId, novels, storeImportConfig]);

  /** 构建当前配置 */
  const buildConfig = (): ImportConfig => ({
    cleaning: {
      preset: cleaningPreset,
      enabledSteps: cleaningPreset === 'none' ? enabledSteps : [],
    },
    sampling: {
      strategy: samplingStrategy,
      chapter: { headCount, midCount, tailCount, randomCount },
      fixedLength: { headRatio, midRatio, tailRatio },
      customCharLimit,
      maxCharsOverride,
    },
  });

  /** 切换手动步骤 */
  const toggleStep = (step: CleaningStepId) => {
    setEnabledSteps((prev) =>
      prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step],
    );
  };

  /** 应用配置（不重新处理） */
  const handleApply = () => {
    updateImportConfig(buildConfig());
    onOpenChange(false);
  };

  /** 重新处理当前小说 */
  const handleReprocessNovel = async () => {
    if (!novelId) return;
    updateImportConfig(buildConfig());
    setIsReprocessing(true);
    try {
      await reprocessNovel(novelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重新处理失败');
    } finally {
      setIsReprocessing(false);
      onOpenChange(false);
    }
  };

  /** 重新处理全部小说 */
  const handleReprocessAll = async () => {
    updateImportConfig(buildConfig());
    setIsReprocessing(true);
    try {
      await reprocessAllNovels();
    } catch {
      // 每个小说的错误已单独处理
    } finally {
      setIsReprocessing(false);
      onOpenChange(false);
    }
  };

  // Badge 展示用：非 none 预设时从 resolveCleaningSteps 获取激活步骤
  const activeSteps = useMemo(
    () =>
      cleaningPreset === 'none'
        ? enabledSteps
        : resolveCleaningSteps({ preset: cleaningPreset, enabledSteps: [] }),
    [cleaningPreset, enabledSteps],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {novelId ? '重新处理小说' : '导入设置'}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-5 py-2 px-1">
            {/* ======== 清洗配置 ======== */}
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold">清洗配置</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  清洗网络小说中的广告、水印、导航等噪声
                </p>
              </div>

              {/* 预设选择 */}
              <div className="space-y-2">
                <Label className="text-xs">预设方案</Label>
                <Select
                  value={cleaningPreset}
                  onValueChange={(v) => setCleaningPreset(v as CleaningPreset)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(PRESET_LABELS) as [CleaningPreset, string][]
                    ).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 手动步骤勾选（仅 none） */}
              {cleaningPreset === 'none' && (
                <div className="space-y-1.5 rounded-lg border border-border p-3">
                  {ALL_CLEANING_STEPS.map((step) => (
                    <label
                      key={step}
                      className="flex items-center gap-2.5 text-sm cursor-pointer py-0.5"
                    >
                      <Switch
                        size="sm"
                        checked={enabledSteps.includes(step)}
                        onCheckedChange={() => toggleStep(step)}
                      />
                      <span>{STEP_LABELS[step]}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Badge 摘要（非 none） */}
              {cleaningPreset !== 'none' && (
                <div className="flex flex-wrap gap-1">
                  {ALL_CLEANING_STEPS.map((step) => {
                    const isActive = activeSteps.includes(step);
                    return (
                      <Badge
                        key={step}
                        variant={isActive ? 'default' : 'outline'}
                        className="text-xs"
                      >
                        {STEP_LABELS[step].split('（')[0]}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator />

            {/* ======== 采样配置 ======== */}
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold">采样配置</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  控制送入 AI 的文本长度和选取方式
                </p>
              </div>

              {/* 策略选择 */}
              <div className="space-y-2">
                <Label className="text-xs">采样策略</Label>
                <Select
                  value={samplingStrategy}
                  onValueChange={(v) => setSamplingStrategy(v as SamplingStrategy)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(STRATEGY_LABELS) as [SamplingStrategy, string][]
                    ).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 章节采样参数 */}
              {samplingStrategy === 'chapter' && (
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">开头章节数</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={headCount}
                      onChange={(e) => setHeadCount(safeInt(e.target.value, 3))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">中间章节数</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={midCount}
                      onChange={(e) => setMidCount(safeInt(e.target.value, 3))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">结尾章节数</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={tailCount}
                      onChange={(e) => setTailCount(safeInt(e.target.value, 3))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">随机章节数</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={randomCount}
                      onChange={(e) => setRandomCount(safeInt(e.target.value, 2))}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              )}

              {/* 固定长度采样参数 */}
              {samplingStrategy === 'fixedLength' && (
                <div className="space-y-4 rounded-lg border border-border p-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">头部比例</Label>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.round(headRatio * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[headRatio]}
                      onValueChange={(v) => setHeadRatio(Array.isArray(v) ? v[0] : v)}
                      min={0.05}
                      max={0.7}
                      step={0.05}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">中部比例</Label>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.round(midRatio * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[midRatio]}
                      onValueChange={(v) => setMidRatio(Array.isArray(v) ? v[0] : v)}
                      min={0.05}
                      max={0.5}
                      step={0.05}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">尾部比例</Label>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.round(tailRatio * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[tailRatio]}
                      onValueChange={(v) => setTailRatio(Array.isArray(v) ? v[0] : v)}
                      min={0.05}
                      max={0.5}
                      step={0.05}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    总比例: {Math.round((headRatio + midRatio + tailRatio) * 100)}%
                    {headRatio + midRatio + tailRatio > 1.0 && (
                      <span className="text-amber-500 ml-1">（将自动归一化）</span>
                    )}
                  </p>
                </div>
              )}

              {/* 自定义字数上限参数 */}
              {samplingStrategy === 'customLimit' && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <Label className="text-xs">字数上限</Label>
                  <Input
                    type="number"
                    min={1000}
                    max={1000000}
                    step={1000}
                    value={customCharLimit}
                    onChange={(e) => setCustomCharLimit(safeInt(e.target.value, 80000))}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    超过 {customCharLimit.toLocaleString()} 字的部分将被截断
                  </p>
                </div>
              )}

              {/* 策略说明 */}
              <p className="text-xs text-muted-foreground">
                当前策略：{STRATEGY_LABELS[samplingStrategy]}
                {samplingStrategy === 'full' && ' — 全文送入 AI（适合短篇）'}
                {samplingStrategy === 'customLimit' &&
                  ` — 上限 ${customCharLimit.toLocaleString()} 字`}
                {samplingStrategy === 'chapter' &&
                  ` — 开头${headCount}+中间${midCount}+结尾${tailCount}+随机${randomCount} 章`}
                {samplingStrategy === 'fixedLength' &&
                  ` — 头${Math.round(headRatio * 100)}% + 中${Math.round(midRatio * 100)}% + 尾${Math.round(tailRatio * 100)}%`}
              </p>
            </div>
          </div>
        </ScrollArea>

        <Separator className="mt-1" />

        {/* Footer */}
        <DialogFooter>
          <div className="flex items-center gap-2 w-full justify-between">
            <div className="flex gap-2">
              {novelId && (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleReprocessNovel}
                    disabled={isReprocessing}
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 mr-1 ${isReprocessing ? 'animate-spin' : ''}`}
                    />
                    重新处理此小说
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReprocessAll}
                    disabled={isReprocessing}
                  >
                    全部重新处理
                  </Button>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button size="sm" onClick={handleApply} disabled={isReprocessing}>
                应用
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
