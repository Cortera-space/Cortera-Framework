import { z } from "zod";
import { defineAction } from "@cortera/core";

export const testAction = defineAction({
  name: "testAction",
  description: "A test action",
  permission: "test.permission",
  inputSchema: z.object({}),
  handler: async () => ({}),
});