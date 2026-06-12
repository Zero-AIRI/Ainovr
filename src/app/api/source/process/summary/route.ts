import { createStreamRoute } from '@/lib/api/stream-route';

export const POST = createStreamRoute({ label: '汇总报告', maxTokens: 65536 });
