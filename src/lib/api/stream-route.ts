// ============================================
// 统一流式路由工厂 — 消除 25+ 个 API route 的重复样板
// ============================================

import { chatCompletionStream } from '@/lib/ai/providers';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@/lib/constants';

interface StreamRouteConfig {
  /** 路由中文标签，用于错误信息 */
  label: string;
  /** maxTokens，默认 16384 */
  maxTokens?: number;
}

/**
 * 从请求中提取 AI 配置和提示词，调用 chatCompletionStream 返回流式响应。
 * 适用于 source/process/* 路由（客户端预构建 systemPrompt + userMessage）。
 */
export function handlePassThroughStream(
  req: Request,
  config: StreamRouteConfig,
): Promise<Response> {
  return handleStreamRequest(req, config, null);
}

/**
 * 从请求中提取 AI 配置和业务字段，调用 promptBuilder 构建 prompt，再调用 chatCompletionStream。
 * 适用于 generation/* 和 chapter/* 路由。
 */
export function handlePromptBuiltStream(
  req: Request,
  config: StreamRouteConfig,
  promptBuilder: (body: Record<string, unknown>) => { systemPrompt: string; userMessage: string },
): Promise<Response> {
  return handleStreamRequest(req, config, promptBuilder);
}

/**
 * 内部统一实现 — 异步包装
 */
async function handleStreamRequest(
  req: Request,
  config: StreamRouteConfig,
  promptBuilder: ((body: Record<string, unknown>) => { systemPrompt: string; userMessage: string }) | null,
): Promise<Response> {
  const body = await req.json() as Record<string, unknown>;
  const { apiKey, model, baseURL } = body;
  const thinkingMode = body.thinkingMode as boolean | undefined;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: '请先配置 API Key' }), { status: 400 });
  }

  let systemPrompt: string;
  let userMessage: string;

  if (promptBuilder) {
    ({ systemPrompt, userMessage } = promptBuilder(body));
  } else {
    systemPrompt = body.systemPrompt as string;
    userMessage = body.userMessage as string;
    if (!userMessage) {
      return new Response(JSON.stringify({ error: '缺少文本内容' }), { status: 400 });
    }
  }

  const stream = chatCompletionStream(
    { apiKey: apiKey as string, model: (model as string) || DEFAULT_MODEL, baseURL: (baseURL as string) || DEFAULT_BASE_URL, thinkingMode },
    { system: systemPrompt, messages: [{ role: 'user', content: userMessage }], maxTokens: config.maxTokens ?? 16384 },
  );

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

/**
 * 创建完整的 POST route handler，自动包 try/catch。
 *
 * 用法：
 * ```ts
 * // source/process/slice/route.ts
 * export const POST = createStreamRoute({ label: '智能切片' });
 *
 * // generation/outline/route.ts
 * export const POST = createStreamRoute({
 *   label: '大纲生成',
 *   promptBuilder: (body) => buildOutlineGenerationMessages(body.styleGuide, body.plotGuide, ...),
 * });
 * ```
 */
export function createStreamRoute(
  config: StreamRouteConfig & {
    /** 可选：prompt 构建函数。不传则为 pass-through 模式（客户端发 systemPrompt + userMessage） */
    promptBuilder?: (body: Record<string, unknown>) => { systemPrompt: string; userMessage: string };
  },
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      if (config.promptBuilder) {
        return await handlePromptBuiltStream(req, config, config.promptBuilder);
      }
      return await handlePassThroughStream(req, config);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `${config.label}失败`;
      console.error(`${config.label}错误:`, error);
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
  };
}
