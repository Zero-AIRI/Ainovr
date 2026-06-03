// ============================================
// AI 设置弹窗
// ============================================

'use client';

import { useState } from 'react';
import { nanoid } from 'nanoid';
import { Plus, Trash2 } from 'lucide-react';
import {
  type AIProviderType,
  type CustomProvider,
  type ThinkingEffort,
  isCustomProvider,
  getCustomId,
  needsApiKey,
} from '@/types';
import { useAppStore } from '@/lib/store';
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
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const providerType = useAppStore((s) => s.providerType);
  const apiKey = useAppStore((s) => s.apiKey);
  const model = useAppStore((s) => s.model);
  const baseURL = useAppStore((s) => s.baseURL);
  const thinkingMode = useAppStore((s) => s.thinkingMode);
  const thinkingEffort = useAppStore((s) => s.thinkingEffort);
  const customProviders = useAppStore((s) => s.customProviders);
  const setAISettings = useAppStore((s) => s.setAISettings);
  const setCustomProviders = useAppStore((s) => s.setCustomProviders);

  const [newLabel, setNewLabel] = useState('');
  const [newBaseURL, setNewBaseURL] = useState('');
  const [newModel, setNewModel] = useState('');

  const isCustom = isCustomProvider(providerType);
  const activeCustom = isCustom
    ? customProviders.find((p) => p.id === getCustomId(providerType))
    : null;

  const handleAddCustom = () => {
    if (!newLabel.trim() || !newBaseURL.trim()) return;
    const newProvider: CustomProvider = {
      id: nanoid(8),
      label: newLabel.trim(),
      baseURL: newBaseURL.trim(),
      model: newModel.trim() || 'default',
    };
    setCustomProviders([...customProviders, newProvider]);
    setAISettings({
      providerType: `custom:${newProvider.id}` as AIProviderType,
      model: newProvider.model,
      baseURL: newProvider.baseURL,
    });
    setNewLabel('');
    setNewBaseURL('');
    setNewModel('');
  };

  const handleRemoveCustom = (id: string) => {
    const next = customProviders.filter((p) => p.id !== id);
    setCustomProviders(next);
    if (isCustom && getCustomId(providerType) === id) {
      setAISettings({
        providerType: 'deepseek',
        model: 'deepseek-chat',
        baseURL: '',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
                if (!v) return;
                const newType = v as AIProviderType;

                if (isCustomProvider(newType)) {
                  const cp = customProviders.find((p) => p.id === getCustomId(newType));
                  if (cp) {
                    setAISettings({
                      providerType: newType,
                      model: cp.model,
                      baseURL: cp.baseURL,
                    });
                  }
                } else {
                  setAISettings({
                    providerType: newType,
                    model: 'deepseek-chat',
                    baseURL: '',
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                {customProviders.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">自定义</div>
                    {customProviders.map((p) => (
                      <SelectItem key={p.id} value={`custom:${p.id}`}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* 自定义供应商编辑区 */}
          {isCustom && activeCustom && (
            <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Input
                  value={activeCustom.label}
                  onChange={(e) => {
                    const next = customProviders.map((p) =>
                      p.id === activeCustom.id ? { ...p, label: e.target.value } : p
                    );
                    setCustomProviders(next);
                  }}
                  className="h-7 text-sm font-medium border-none bg-transparent px-0 focus-visible:ring-0"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveCustom(activeCustom.id)}
                  className="h-7 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Base URL</Label>
                <Input
                  value={activeCustom.baseURL}
                  onChange={(e) => {
                    const next = customProviders.map((p) =>
                      p.id === activeCustom.id ? { ...p, baseURL: e.target.value } : p
                    );
                    setCustomProviders(next);
                    setAISettings({ baseURL: e.target.value });
                  }}
                  placeholder="https://api.example.com/v1"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">模型</Label>
                <Input
                  value={activeCustom.model}
                  onChange={(e) => {
                    const next = customProviders.map((p) =>
                      p.id === activeCustom.id ? { ...p, model: e.target.value } : p
                    );
                    setCustomProviders(next);
                    setAISettings({ model: e.target.value });
                  }}
                  placeholder="model-name"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          )}

          {/* API Key */}
          {needsApiKey(providerType) && (
            <div className="space-y-2">
              <Label>API Key {isCustom && <span className="text-muted-foreground font-normal">(可选)</span>}</Label>
              <Input
                type="password"
                placeholder={isCustom ? '如需要可填入' : '输入你的 API Key'}
                value={apiKey}
                onChange={(e) => setAISettings({ apiKey: e.target.value })}
              />
              {!isCustom && (
                <p className="text-xs text-muted-foreground">密钥仅保存在本地浏览器中</p>
              )}
            </div>
          )}

          {/* 模型名称（DeepSeek 或未选中自定义时） */}
          {!isCustom && (
            <div className="space-y-2">
              <Label>模型</Label>
              <Input
                value={model}
                onChange={(e) => setAISettings({ model: e.target.value })}
              />
            </div>
          )}

          {/* DeepSeek 思考模式 */}
          {providerType === 'deepseek' && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>思考模式</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    启用后模型会先进行推理再回答，提升分析准确性
                  </p>
                </div>
                <Switch
                  checked={thinkingMode}
                  onCheckedChange={(v) => setAISettings({ thinkingMode: v })}
                />
              </div>

              {thinkingMode && (
                <div className="space-y-2">
                  <Label className="text-xs">思考强度</Label>
                  <Select
                    value={thinkingEffort}
                    onValueChange={(v) => {
                      if (v) setAISettings({ thinkingEffort: v as ThinkingEffort });
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">
                        High — 平衡速度与质量
                      </SelectItem>
                      <SelectItem value="max">
                        Max — 最深度思考（较慢）
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    使用思考模式时建议切换模型为 deepseek-reasoner 或 deepseek-v4-pro
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 添加自定义供应商 */}
          <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
            <Label className="text-xs text-muted-foreground">添加自定义供应商（OpenAI 兼容接口）</Label>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                placeholder="名称"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="h-8 text-sm"
              />
              <Input
                placeholder="https://api.xxx.com/v1"
                value={newBaseURL}
                onChange={(e) => setNewBaseURL(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddCustom}
                disabled={!newLabel.trim() || !newBaseURL.trim()}
                className="h-8 px-2"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <Input
              placeholder="模型名称（可选）"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              className="h-8 text-sm"
            />

            {/* 已添加的自定义供应商列表 */}
            {customProviders.length > 0 && (
              <div className="space-y-1 pt-1">
                {customProviders.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-md text-sm ${
                      isCustom && getCustomId(providerType) === p.id
                        ? 'bg-primary/10 font-medium'
                        : 'bg-background'
                    }`}
                  >
                    <div className="min-w-0">
                      <span>{p.label}</span>
                      <span className="text-muted-foreground text-xs ml-2 truncate">
                        {p.baseURL}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveCustom(p.id)}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
