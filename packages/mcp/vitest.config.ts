import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@modelcontextprotocol/sdk": new URL(
        "../../node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/@modelcontextprotocol/sdk/dist/esm/index.js",
        import.meta.url
      ).pathname,
    },
  },
});
