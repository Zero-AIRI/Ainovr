import { describe, expect, it } from "vitest";
import { createEnvironmentSecretStore, providerEnvironmentVariableName } from "@/runtime/secret-store";

describe("Environment SecretStore", () => {
  it("为大小写和分隔符不同的 Provider ID 生成不碰撞的环境变量名", async () => {
    const names = ["a-b", "a_b", "A-B"].map(providerEnvironmentVariableName);
    expect(new Set(names).size).toBe(3);
    const store = createEnvironmentSecretStore({
      [names[0]]: "secret-a-b",
      [names[1]]: "secret-a_b",
      [names[2]]: "secret-A-B",
    });
    await expect(store.get("a-b")).resolves.toBe("secret-a-b");
    await expect(store.get("a_b")).resolves.toBe("secret-a_b");
    await expect(store.get("A-B")).resolves.toBe("secret-A-B");
  });
});
