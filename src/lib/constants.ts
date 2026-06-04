// ============================================
// 共享常量 — 避免默认值在多处硬编码导致不一致
// ============================================

/** 默认模型名称 */
export const DEFAULT_MODEL = 'deepseek-v4-flash';

/** 默认 API Base URL */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';

/** 允许的 API 协议（防止 SSRF） */
export const ALLOWED_API_PROTOCOLS = ['https:', 'http:'] as const;
