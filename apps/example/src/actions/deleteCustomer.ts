import { z } from "zod";
import { defineAction } from "@cortera/core";

export const deleteCustomerAction = defineAction({
  name: "deleteCustomer",
  description: "Deletes a customer by ID",
  permission: "customers.delete",
  inputSchema: z.object({
    id: z.string(),
    reason: z.string().optional(),
  }),
  handler: async (input) => {
    return { deleted: true, customerId: input.id };
  },
  approvalTtlMs: 24 * 60 * 60 * 1000,
});
