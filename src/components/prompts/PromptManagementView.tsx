// ============================================
// 提示词管理视图 — 左侧列表 + 右侧编辑
// ============================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, ChevronRight, ChevronDown, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { usePromptStore, PROMPT_REGISTRY } from '@/lib/store/prompts';

/** 按分类分组 */
const CATEGORIES = ['素材处理', '进阶分析', '层级生成', '章节写作'];

export function PromptManagementView() {
  const { loadPrompts, defaultPrompts, customPrompts, saveCustomPrompt, loaded } = usePromptStore();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(CATEGORIES));
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!loaded) loadPrompts();
  }, [loaded, loadPrompts]);

  const isCustom = selectedKey ? !!customPrompts[selectedKey] : false;

  // 选择提示词
  const handleSelect = useCallback((key: string) => {
    if (hasChanges && selectedKey) {
      // 有未保存的修改，提示
      const ok = confirm('当前修改未保存，确定切换吗？');
      if (!ok) return;
    }
    setSelectedKey(key);
    setEditContent(usePromptStore.getState().getPrompt(key));
    setHasChanges(false);
  }, [hasChanges, selectedKey]);

  // 保存
  const handleSave = useCallback(async () => {
    if (!selectedKey) return;
    await saveCustomPrompt(selectedKey, editContent);
    setHasChanges(false);
    toast.success('提示词已保存');
  }, [selectedKey, editContent, saveCustomPrompt]);

  // 恢复默认
  const handleReset = useCallback(async () => {
    if (!selectedKey) return;
    const ok = confirm('确定恢复为默认提示词吗？');
    if (!ok) return;
    await saveCustomPrompt(selectedKey, ''); // 空内容 = 删除自定义
    const defaultContent = defaultPrompts[selectedKey] ?? '';
    setEditContent(defaultContent);
    setHasChanges(false);
    toast.success('已恢复默认');
  }, [selectedKey, defaultPrompts, saveCustomPrompt]);

  // 内容修改
  function handleEdit(value: string) {
    setEditContent(value);
    setHasChanges(true);
  }

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧：提示词列表 */}
      <div className="w-72 border-r border-border overflow-y-auto p-3 shrink-0">
        <h2 className="text-sm font-bold text-foreground mb-3">提示词管理</h2>
        <p className="text-xs text-muted-foreground mb-4">
          共 {PROMPT_REGISTRY.length} 个提示词 · 修改后实时生效
        </p>

        {CATEGORIES.map((cat) => {
          const items = PROMPT_REGISTRY.filter((p) => p.category === cat);
          const isExpanded = expandedCategories.has(cat);

          return (
            <div key={cat} className="mb-2">
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {cat}
                <span className="ml-auto text-[10px] opacity-50">{items.length}</span>
              </button>

              {isExpanded && items.map((item) => {
                const isActive = selectedKey === item.key;
                const hasCustom = !!customPrompts[item.key];

                return (
                  <button
                    key={item.key}
                    onClick={() => handleSelect(item.key)}
                    className={`
                      w-full text-left pl-6 pr-2 py-1.5 rounded text-xs mb-0.5 transition-colors flex items-center gap-1.5
                      ${isActive ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'}
                    `}
                  >
                    {hasCustom && <Pencil className="w-2.5 h-2.5 text-primary shrink-0" />}
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* 右侧：编辑区 */}
      <div className="flex-1 flex flex-col overflow-hidden p-6">
        {selectedKey ? (
          <>
            {/* 头部 */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-foreground">
                  {PROMPT_REGISTRY.find((p) => p.key === selectedKey)?.label}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {PROMPT_REGISTRY.find((p) => p.key === selectedKey)?.description}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isCustom && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">已自定义</span>
                )}
                <button
                  onClick={handleReset}
                  disabled={!isCustom && !hasChanges}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  恢复默认
                </button>
                <button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors"
                >
                  <Save className="w-3 h-3" />
                  保存
                </button>
              </div>
            </div>

            {/* 编辑器 */}
            <div className="flex-1 overflow-hidden">
              <textarea
                value={editContent}
                onChange={(e) => handleEdit(e.target.value)}
                className="w-full h-full px-4 py-3 rounded-lg border border-border bg-card text-sm font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="输入提示词内容..."
                spellCheck={false}
              />
            </div>

            {/* 状态栏 */}
            <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
              <span>{editContent.length} 字符</span>
              {hasChanges && <span className="text-amber-500">未保存</span>}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <Pencil className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">选择左侧的提示词进行编辑</p>
            <p className="text-xs mt-1 opacity-60">修改后保存即生效，不影响默认值，可随时恢复</p>
          </div>
        )}
      </div>
    </div>
  );
}
