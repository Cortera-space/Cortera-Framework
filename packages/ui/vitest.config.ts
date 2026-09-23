import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@cortera/core": path.resolve(__dirname, "../core/src/index.ts"),
      "@cortera/ui": path.resolve(__dirname, "src/index.ts"),
    },
  },
});
