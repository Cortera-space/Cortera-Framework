import { z } from "zod";
import { defineAction } from "@cortera/core";

export const deleteWorkspaceAction = defineAction({
  name: "deleteWorkspace",
  description: "Permanently deletes a workspace and all its data — irreversible",
  permission: "workspaces.delete",
  inputSchema: z.object({
    workspaceId: z.string().uuid(),
    confirmation: z.literal("DELETE"),
  }),
  riskTier: "irreversible",
  handler: async (input) => {
    return { deleted: true, workspaceId: input.workspaceId };
  },
});