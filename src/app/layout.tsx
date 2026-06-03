import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ainovr — AI 小说风格仿写',
  description: '上传你喜欢的小说，AI 分析风格后仿写全新故事',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-full overflow-hidden" style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif' }}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
