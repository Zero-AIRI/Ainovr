import { createStreamRoute } from '@/lib/api/stream-route';
import { buildPhaseFrameworkMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '阶段框架生成',
  promptBuilder: (b) => buildPhaseFrameworkMessages(b.outline as string, b.plotGuide as string),
});
