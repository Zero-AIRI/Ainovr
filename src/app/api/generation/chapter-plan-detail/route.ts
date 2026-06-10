import { createStreamRoute } from '@/lib/api/stream-route';
import { buildChapterPlanDetailMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '每章计划详细生成',
  promptBuilder: (b) => buildChapterPlanDetailMessages(b.setContent as string, b.planFramework as string, b.chapterIndex as number, b.minorPlotPatterns as string),
});
