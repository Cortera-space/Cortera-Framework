import { z } from "zod";
import { defineAction } from "@cortera/core";

export const testActionAction = defineAction({
  name: "testAction",
  description: "TODO: Describe what this action does",
  permission: "TODO:permission.key",
  inputSchema: z.object({
    exampleField: z.string().describe("TODO: Describe this field"),
  }),
  // approvalTtlMs: 24 * 60 * 60 * 1000, // Optional: custom approval TTL (default: 24h)
  // blastRadius: ["permission.pattern*"], // Optional: restrict downstream actions
  handler: async (input) => {
    // TODO: Implement action logic
    return { success: true, ...input };
  },
});
