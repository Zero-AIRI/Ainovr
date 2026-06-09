// ============================================
// API 设置弹窗
// ============================================

'use client';

import { useState } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const storeApiKey = useSettingsStore((s) => s.apiKey);
  const storeModel = useSettingsStore((s) => s.model);
  const storeBaseURL = useSettingsStore((s) => s.baseURL);
  const storeMaxContextTokens = useSettingsStore((s) => s.maxContextTokens);
  const setAISettings = useSettingsStore((s) => s.setAISettings);

  // 本地编辑状态
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [maxContextTokens, setMaxContextTokens] = useState(1000000);

  // 弹窗打开时从 store 同步到本地编辑状态
  function handleOpenChange(isOpen: boolean) {
    if (isOpen) {
      setApiKey(storeApiKey);
      setModel(storeModel);
      setBaseURL(storeBaseURL);
      setMaxContextTokens(storeMaxContextTokens);
    }
    onOpenChange(isOpen);
  }

  const handleSave = () => {
    setAISettings({
      apiKey: apiKey.trim(),
      model: model.trim() || DEFAULT_MODEL,
      baseURL: baseURL.trim() || DEFAULT_BASE_URL,
      maxContextTokens: maxContextTokens > 0 ? maxContextTokens : 1000000,
    });
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            <p className="text-xs text-muted-foreground">密钥保存在本地浏览器，也可通过环境变量 NEXT_PUBLIC_DEEPSEEK_API_KEY 配置</p>
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

          {/* 最大上下文长度 */}
          <div className="space-y-2">
            <Label>最大上下文长度（Token）</Label>
            <Input
              type="number"
              min={1000}
              value={maxContextTokens}
              onChange={(e) => setMaxContextTokens(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">控制分析长篇小说时的分批大小，需为模型支持的最大上下文长度</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
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
