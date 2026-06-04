// ============================================
// 导入设置弹窗 — 清洗预设 + 分块大小
// ============================================

'use client';

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type {
  CleaningPreset,
  CleaningStepId,
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

const PRESET_OPTIONS: { value: CleaningPreset; label: string }[] = [
  { value: 'aggressive', label: '激进 — 清理全部 10 个步骤' },
  { value: 'standard', label: '标准 — 跳过广告和作者碎碎念' },
  { value: 'light', label: '轻度 — 仅编码、标点、空行' },
  { value: 'none', label: '手动 — 自行选择步骤' },
];

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
  const [maxChunkSize, setMaxChunkSize] = useState(DEFAULT_IMPORT_CONFIG.maxChunkSize);

  const [isReprocessing, setIsReprocessing] = useState(false);

  /** 将 ImportConfig 同步到本地状态 */
  const loadConfig = (src: ImportConfig | null | undefined) => {
    const safe = src ?? DEFAULT_IMPORT_CONFIG;
    setCleaningPreset(safe.cleaning?.preset ?? DEFAULT_IMPORT_CONFIG.cleaning.preset);
    setEnabledSteps(safe.cleaning?.enabledSteps ?? []);
    setMaxChunkSize(safe.maxChunkSize ?? DEFAULT_IMPORT_CONFIG.maxChunkSize);
    setIsReprocessing(false);
  };

  // 弹窗打开时初始化本地状态
  useEffect(() => {
    if (!open) return;

    const src = novelId
      ? (novels.find((n) => n.id === novelId)?.importConfig ?? DEFAULT_IMPORT_CONFIG)
      : (storeImportConfig ?? DEFAULT_IMPORT_CONFIG);

    loadConfig(src);
  }, [open, novelId, novels, storeImportConfig]);

  /** 构建当前配置 */
  const buildConfig = (): ImportConfig => ({
    cleaning: {
      preset: cleaningPreset,
      enabledSteps: cleaningPreset === 'none' ? enabledSteps : [],
    },
    maxChunkSize,
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
                  onValueChange={(v) => {
                    if (!v) return;
                    setCleaningPreset(v as CleaningPreset);
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
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

            {/* ======== 分块配置 ======== */}
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold">分块配置</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  控制小说按章节分块后的每块最大字符数
                </p>
              </div>

              <div className="space-y-2 rounded-lg border border-border p-3">
                <Label className="text-xs">分块大小上限（字符）</Label>
                <Input
                  type="number"
                  min={1000}
                  max={50000}
                  step={1000}
                  value={maxChunkSize}
                  onChange={(e) => setMaxChunkSize(safeInt(e.target.value, 8000))}
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  超过 {maxChunkSize.toLocaleString()} 字符的章节将在段落边界自动分割成更小的块
                </p>
              </div>
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
