import { createStreamRoute } from '@/lib/api/stream-route';
import { buildChapterSetFrameworkMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '章节集合框架生成',
  promptBuilder: (b) => buildChapterSetFrameworkMessages(b.volumeContent as string, b.minorPlotPatterns as string),
});
