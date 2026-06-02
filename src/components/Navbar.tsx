// ============================================
// 极简导航栏
// ============================================

'use client';

import { Settings, BookOpen, PenTool, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Navbar({ onSettingsClick }: { onSettingsClick: () => void }) {
  const pathname = usePathname();

  const links = [
    { href: '/', label: '上传', icon: BookOpen },
    { href: '/analyze', label: '分析', icon: Sparkles },
    { href: '/write', label: '仿写', icon: PenTool },
  ];

  return (
    <nav className="flex items-center justify-between px-6 py-3 bg-gray-900/80 backdrop-blur border-b border-gray-800">
      <div className="flex items-center gap-2">
        <span className="text-xl">✦</span>
        <span className="text-lg font-bold text-gray-100">墨韵仿写</span>
      </div>

      <div className="flex items-center gap-1">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors
              ${pathname === href
                ? 'bg-violet-600/20 text-violet-300'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }
            `}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </div>

      <button
        onClick={onSettingsClick}
        className="p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        title="AI 设置"
      >
        <Settings className="w-5 h-5" />
      </button>
    </nav>
  );
}
