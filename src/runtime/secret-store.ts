/** Runtime-only credential seam. Implementations must never persist, log, or
 * return keys to Application Service projections. */
export interface SecretStore { get(providerProfileId: string): Promise<string | null>; }

/** Node CLI/MCP opt-in source. It never reads data/settings.json; operators
 * provide `AINOVR_PROVIDER_<PROFILE_ID>_API_KEY` only to the launched process. */
export function createEnvironmentSecretStore(environment: Record<string, string | undefined> = process.env): SecretStore {
  return {
    async get(providerProfileId) {
      const name = `AINOVR_PROVIDER_${providerProfileId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY`;
      const value = environment[name];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    },
  };
}
