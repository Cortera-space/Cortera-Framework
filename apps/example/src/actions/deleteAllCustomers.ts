import { z } from "zod";
import { defineAction } from "@cortera/core";

export const deleteAllCustomersAction = defineAction({
  name: "deleteAllCustomers",
  description: "Deletes all customers — outside notes blast radius",
  permission: "customers.delete",
  inputSchema: z.object({
    reason: z.string().optional(),
  }),
  handler: async (input) => {
    return { deleted: true, reason: input.reason };
  },
});
