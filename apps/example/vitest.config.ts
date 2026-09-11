import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@tera/core": path.resolve("/workspace/d5429a8d-39c9-43ed-8ef9-c20d9fa99be4/sessions/agent_5fd81d81-643e-4a76-9792-97d59eb75c63/packages/core/src/index.ts"),
      "@tera/ui": path.resolve("/workspace/d5429a8d-39c9-43ed-8ef9-c20d9fa99be4/sessions/agent_5fd81d81-643e-4a76-9792-97d59eb75c63/packages/ui/src/index.ts"),
      "@tera/db": path.resolve("/workspace/d5429a8d-39c9-43ed-8ef9-c20d9fa99be4/sessions/agent_5fd81d81-643e-4a76-9792-97d59eb75c63/packages/db/src/index.ts"),
      "@tera/adapter-next": path.resolve("/workspace/d5429a8d-39c9-43ed-8ef9-c20d9fa99be4/sessions/agent_5fd81d81-643e-4a76-9792-97d59eb75c63/packages/adapter-next/src/index.ts"),
      "@tera/mcp": path.resolve("/workspace/d5429a8d-39c9-43ed-8ef9-c20d9fa99be4/sessions/agent_5fd81d81-643e-4a76-9792-97d59eb75c63/packages/mcp/src/index.ts"),
    },
  },
});
