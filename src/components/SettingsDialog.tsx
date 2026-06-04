// ============================================
// API 设置弹窗
// ============================================

'use client';

import { useState, useEffect } from 'react';
import type { ThinkingEffort } from '@/types';
import { useAppStore } from '@/lib/store';
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

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const storeApiKey = useAppStore((s) => s.apiKey);
  const storeModel = useAppStore((s) => s.model);
  const storeBaseURL = useAppStore((s) => s.baseURL);
  const storeThinkingMode = useAppStore((s) => s.thinkingMode);
  const storeThinkingEffort = useAppStore((s) => s.thinkingEffort);
  const setAISettings = useAppStore((s) => s.setAISettings);

  // 本地编辑状态
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [thinkingMode, setThinkingMode] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('high');

  // 弹窗打开时从 store 同步
  useEffect(() => {
    if (!open) return;
    setApiKey(storeApiKey);
    setModel(storeModel);
    setBaseURL(storeBaseURL);
    setThinkingMode(storeThinkingMode);
    setThinkingEffort(storeThinkingEffort);
  }, [open, storeApiKey, storeModel, storeBaseURL, storeThinkingMode, storeThinkingEffort]);

  const handleSave = () => {
    setAISettings({
      apiKey: apiKey.trim(),
      model: model.trim() || 'deepseek-v4-flash',
      baseURL: baseURL.trim() || 'https://api.deepseek.com',
      thinkingMode,
      thinkingEffort,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>API 设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* API Key */}
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">密钥仅保存在本地浏览器</p>
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input
              placeholder="https://api.deepseek.com"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">OpenAI 兼容接口地址</p>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <Label>模型</Label>
            <Input
              placeholder="deepseek-v4-flash"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>

          {/* 思考模式 */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>思考模式</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  启用后模型先推理再回答（需模型支持）
                </p>
              </div>
              <Switch
                checked={thinkingMode}
                onCheckedChange={(v) => setThinkingMode(v)}
              />
            </div>

            {thinkingMode && (
              <div className="space-y-2">
                <Label className="text-xs">思考强度</Label>
                <Select
                  value={thinkingEffort}
                  onValueChange={(v) => {
                    if (v) setThinkingEffort(v as ThinkingEffort);
                  }}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High — 平衡速度与质量</SelectItem>
                    <SelectItem value="max">Max — 最深度思考（较慢）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
