import { createStreamRoute } from '@/lib/api/stream-route';
import { buildVolumeDetailMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '分卷详细生成',
  promptBuilder: (b) => buildVolumeDetailMessages(b.outline as string, b.phaseContent as string, b.volumeFramework as string, b.volumeIndex as number, b.minorPlotPatterns as string),
});
