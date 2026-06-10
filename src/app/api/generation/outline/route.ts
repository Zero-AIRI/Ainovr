import { createStreamRoute } from '@/lib/api/stream-route';
import { buildOutlineGenerationMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '大纲生成',
  promptBuilder: (b) => buildOutlineGenerationMessages(
    b.styleGuide as string, b.plotGuide as string, b.userConcept as string,
    b.daoContext as string | undefined, b.rhythmPrescription as string | undefined,
  ),
});
