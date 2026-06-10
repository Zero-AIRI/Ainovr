import { createStreamRoute } from '@/lib/api/stream-route';
import { buildPhaseDetailMessages } from '@/lib/ai/prompts';

export const POST = createStreamRoute({
  label: '阶段详细生成',
  promptBuilder: (b) => buildPhaseDetailMessages(b.outline as string, b.phaseFramework as string, b.phaseIndex as number, b.plotGuide as string),
});
