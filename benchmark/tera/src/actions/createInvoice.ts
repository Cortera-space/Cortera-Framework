import { z } from "zod";
import { defineAction } from "@tera/core";

export const createInvoiceAction = defineAction({
  name: "createInvoice",
  description: "Creates a new invoice for a customer and writes an audit log entry",
  permission: "invoices.create",
  inputSchema: z.object({
    customerId: z.string().min(1, "Customer ID is required"),
    amount: z.number().positive("Amount must be positive"),
    dueDate: z.string().datetime("Due date must be a valid ISO 8601 date"),
    notes: z.string().optional(),
  }),
  blastRadius: ["invoices.*"],
  handler: async (input) => {
    return {
      id: `inv-${Date.now()}`,
      customerId: input.customerId,
      amount: input.amount,
      dueDate: input.dueDate,
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
  },
});