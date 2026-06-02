// ============================================
// AI 设置弹窗
// ============================================

'use client';

import { AI_PROVIDER_PRESETS, type AIProviderType } from '@/types';
import { useAppStore } from '@/lib/store';
import { getDefaultModel } from '@/lib/ai/providers';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const providerType = useAppStore((s) => s.providerType);
  const apiKey = useAppStore((s) => s.apiKey);
  const model = useAppStore((s) => s.model);
  const baseURL = useAppStore((s) => s.baseURL);
  const setAISettings = useAppStore((s) => s.setAISettings);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>AI 后端设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* 提供商选择 */}
          <div className="space-y-2">
            <Label>AI 提供商</Label>
            <Select
              value={providerType}
              onValueChange={(v) => {
                if (v === null) return;
                const newProvider = v as AIProviderType;
                setAISettings({
                  providerType: newProvider,
                  model: getDefaultModel(newProvider),
                  baseURL: newProvider === 'ollama' ? 'http://localhost:11434' : '',
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDER_PRESETS.map((p) => (
                  <SelectItem key={p.type} value={p.type}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API Key */}
          {providerType !== 'ollama' && (
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="输入你的 API Key"
                value={apiKey}
                onChange={(e) => setAISettings({ apiKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">密钥仅保存在本地浏览器中</p>
            </div>
          )}

          {/* 模型名称 */}
          <div className="space-y-2">
            <Label>模型</Label>
            <Input
              value={model}
              onChange={(e) => setAISettings({ model: e.target.value })}
            />
          </div>

          {/* Ollama 专用：baseURL */}
          {providerType === 'ollama' && (
            <div className="space-y-2">
              <Label>Ollama 地址</Label>
              <Input
                value={baseURL}
                onChange={(e) => setAISettings({ baseURL: e.target.value })}
                placeholder="http://localhost:11434"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
