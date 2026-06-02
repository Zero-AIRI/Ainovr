// ============================================
// 欢迎视图 — 文学感引导页
// ============================================

'use client';

import { BookOpen, Sparkles, PenTool } from 'lucide-react';

const steps = [
  {
    icon: BookOpen,
    title: '导入小说',
    desc: '在左侧边栏上传 .txt 格式的参考小说',
  },
  {
    icon: Sparkles,
    title: '风格分析',
    desc: 'AI 从文风、剧情、人物、技巧等维度深入分析',
  },
  {
    icon: PenTool,
    title: '风格仿写',
    desc: '设定题材和梗概，AI 仿照参考风格创作新故事',
  },
];

export function WelcomeView() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md space-y-10 text-center">
        {/* 标题 */}
        <div className="space-y-3">
          <h1 className="text-4xl font-bold text-foreground tracking-tight">
            Ainovr
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            上传你喜欢的小说，AI 分析文风、剧情、人物塑造等特征，
            然后以相同的风格仿写全新的故事。
          </p>
        </div>

        {/* 步骤 */}
        <div className="space-y-5 text-left">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <step.icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground/60">
          从左侧边栏开始 — 导入小说文件，然后选择分析或仿写
        </p>
      </div>
    </div>
  );
}
