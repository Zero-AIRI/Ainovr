import { createStreamRoute } from '@/lib/api/stream-route';

export const POST = createStreamRoute({ label: '深度分析', maxTokens: 32768 });
