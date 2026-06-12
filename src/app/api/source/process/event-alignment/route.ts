import { createStreamRoute } from '@/lib/api/stream-route';

export const POST = createStreamRoute({ label: '事件对齐', maxTokens: 32768 });
