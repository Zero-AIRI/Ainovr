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
      <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-100">AI 后端设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* 提供商选择 */}
          <div className="space-y-2">
            <Label className="text-gray-300">AI 提供商</Label>
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
              <SelectTrigger className="bg-gray-800 border-gray-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-600">
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
              <Label className="text-gray-300">API Key</Label>
              <Input
                type="password"
                placeholder="输入你的 API Key"
                value={apiKey}
                onChange={(e) => setAISettings({ apiKey: e.target.value })}
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500"
              />
              <p className="text-xs text-gray-500">密钥仅保存在本地浏览器中</p>
            </div>
          )}

          {/* 模型名称 */}
          <div className="space-y-2">
            <Label className="text-gray-300">模型</Label>
            <Input
              value={model}
              onChange={(e) => setAISettings({ model: e.target.value })}
              className="bg-gray-800 border-gray-600 text-gray-100"
            />
          </div>

          {/* Ollama 专用：baseURL */}
          {providerType === 'ollama' && (
            <div className="space-y-2">
              <Label className="text-gray-300">Ollama 地址</Label>
              <Input
                value={baseURL}
                onChange={(e) => setAISettings({ baseURL: e.target.value })}
                placeholder="http://localhost:11434"
                className="bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
