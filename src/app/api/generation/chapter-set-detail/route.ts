import { createStreamRoute } from '@/lib/api/stream-route';
import { buildChapterSetDetailMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '章节集合详细生成',
  promptBuilder: (b) => buildChapterSetDetailMessages(b.volumeContent as string, b.setFramework as string, b.setIndex as number, b.minorPlotPatterns as string),
});
