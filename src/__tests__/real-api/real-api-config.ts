/** 真 API 测试只接受显式传入的进程环境变量，绝不读取本地配置文件。 */

export function getRealApiKey(): string {
  const envKey =
    (globalThis as unknown as { process?: { env?: Record<string, string> } })
      .process?.env?.DEEPSEEK_API_KEY || "";
  return envKey.trim();
}

export const REAL_API_KEY = getRealApiKey();
export const BASE_URL =
  (globalThis as unknown as { process?: { env?: Record<string, string> } })
    .process?.env?.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
