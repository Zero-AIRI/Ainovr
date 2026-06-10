import { createStreamRoute } from '@/lib/api/stream-route';

export const POST = createStreamRoute({ label: '事件提取', maxTokens: 16384 });
