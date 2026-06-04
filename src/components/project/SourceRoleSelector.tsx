// ============================================
// 源小说角色选择器
// ============================================

'use client';

import type { SourceRole } from '@/types';

interface SourceRoleSelectorProps {
  sourceTitle: string;
  role: SourceRole['role'];
  onChange: (role: SourceRole['role']) => void;
}

export function SourceRoleSelector({ sourceTitle, role, onChange }: SourceRoleSelectorProps) {
  const options: { value: SourceRole['role']; label: string }[] = [
    { value: 'style_and_plot', label: '文风 + 情节' },
    { value: 'style', label: '仅文风' },
    { value: 'plot', label: '仅情节' },
  ];

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border border-border">
      <span className="text-sm text-foreground flex-1 truncate">《{sourceTitle}》</span>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`
              px-2 py-1 rounded text-xs transition-colors
              ${role === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
              }
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
