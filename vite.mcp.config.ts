import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    ssr: "src/mcp/server.ts",
    outDir: "dist-mcp",
    emptyOutDir: true,
    target: "node24",
    rollupOptions: {
      external: ["better-sqlite3"],
      output: { entryFileNames: "ainovr-mcp.mjs", format: "es" },
    },
  },
});
