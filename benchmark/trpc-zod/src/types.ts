import { z } from "zod";

export const createInvoiceInputSchema = z.object({
  customerId: z.string().min(1, "Customer ID is required"),
  amount: z.number().positive("Amount must be positive"),
  dueDate: z.string().datetime("Due date must be a valid ISO 8601 date"),
  notes: z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;

export const createInvoiceOutputSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  amount: z.number(),
  dueDate: z.string(),
  notes: z.string().optional(),
  createdAt: z.string(),
});

export type CreateInvoiceOutput = z.infer<typeof createInvoiceOutputSchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  actionName: z.string(),
  actorType: z.enum(["human", "agent", "system"]),
  actorId: z.string(),
  input: z.unknown(),
  output: z.unknown().nullable(),
  error: z.unknown().nullable(),
  permissionResult: z.string(),
  approvedBy: z.string().nullable(),
  parentEventId: z.string().nullable(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  workspaceId: z.string(),
  blastRadius: z.array(z.string()).nullable(),
  dryRun: z.boolean().optional(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;