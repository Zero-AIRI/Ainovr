import { createStreamRoute } from '@/lib/api/stream-route';
import { buildChapterRevisionMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '修正',
  promptBuilder: (b) => buildChapterRevisionMessages(
    b.chapterContent as string, (b.reviews ?? '') as string, (b.humanFeedback ?? null) as string | null,
    (b.styleGuide ?? '') as string, (b.chapterTask ?? '') as string, b.daoContext as string | undefined,
  ),
});
