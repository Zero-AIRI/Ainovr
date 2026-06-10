import { createStreamRoute } from '@/lib/api/stream-route';
import { buildVolumeFrameworkMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '分卷框架生成',
  promptBuilder: (b) => buildVolumeFrameworkMessages(b.outline as string, b.phaseContent as string, b.minorPlotPatterns as string),
});
