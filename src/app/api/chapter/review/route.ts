import { createStreamRoute } from '@/lib/api/stream-route';
import { buildChapterReviewMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '审查',
  maxTokens: 4096,
  promptBuilder: (b) => buildChapterReviewMessages(
    b.chapterContent as string, (b.styleGuide ?? '') as string, (b.chapterTask ?? '') as string,
    b.daoContext as string | undefined,
  ),
});
