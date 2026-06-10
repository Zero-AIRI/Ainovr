import { createStreamRoute } from '@/lib/api/stream-route';
import { buildChapterWritingMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '章节生成',
  promptBuilder: (b) => buildChapterWritingMessages(
    (b.styleGuide ?? '') as string, (b.hierarchyContext ?? '') as string, (b.chapterTask ?? '') as string,
    (b.previousState ?? '') as string, b.daoContext as string | undefined, b.rhythmPrescription as string | undefined,
  ),
});
