/** Runtime-only credential seam. Implementations must never persist, log, or
 * return keys to Application Service projections. */
export interface SecretStore { get(providerProfileId: string): Promise<string | null>; }

/** Node CLI/MCP opt-in source. It never reads workspace files; operators
 * provide the encoded `AINOVR_PROVIDER_<PROFILE_ID_CODE>_API_KEY` only to the launched process. */
export function createEnvironmentSecretStore(environment: Record<string, string | undefined> = process.env): SecretStore {
  return {
    async get(providerProfileId) {
      const name = providerEnvironmentVariableName(providerProfileId);
      const value = environment[name];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    },
  };
}

/**
 * Encode every Unicode code point as hexadecimal instead of replacing
 * punctuation. This makes `a-b`, `a_b`, `A-B`, and non-ASCII IDs distinct even
 * on Windows, whose environment-variable lookup is case-insensitive.
 */
export function providerEnvironmentVariableName(providerProfileId: string): string {
  if (!providerProfileId.trim()) throw new Error("providerProfileId 必须是非空字符串。 ");
  const code = Array.from(providerProfileId, (character) => {
    const point = character.codePointAt(0);
    if (point === undefined) throw new Error("providerProfileId 包含无效字符。 ");
    return point.toString(16).padStart(6, "0");
  }).join("").toUpperCase();
  return `AINOVR_PROVIDER_${code}_API_KEY`;
}
