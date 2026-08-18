import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    ssr: "src/cli/index.ts",
    outDir: "dist-cli",
    emptyOutDir: true,
    target: "node24",
    rollupOptions: { external: ["better-sqlite3"], output: { entryFileNames: "ainovr-cli.mjs", format: "es" } },
  },
});
