import { createStreamRoute } from '@/lib/api/stream-route';

export const POST = createStreamRoute({ label: '实体分类', maxTokens: 2048 });
