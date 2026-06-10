import { createStreamRoute } from '@/lib/api/stream-route';

export const POST = createStreamRoute({ label: 'DNA 压缩', maxTokens: 4096 });
