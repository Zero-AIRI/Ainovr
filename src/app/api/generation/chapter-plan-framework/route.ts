import { createStreamRoute } from '@/lib/api/stream-route';
import { buildChapterPlanFrameworkMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '每章计划框架生成',
  promptBuilder: (b) => buildChapterPlanFrameworkMessages(b.setContent as string, b.minorPlotPatterns as string),
});
