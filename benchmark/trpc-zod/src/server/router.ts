import { initTRPC, TRPCError } from "@trpc/server";
import { createInvoiceInputSchema, type CreateInvoiceInput } from "./types";
import { db } from "./db";
import { checkPermission, type Actor } from "./permissions";

export interface Context {
  actor: Actor;
}

const t = initTRPC.context<Context>().create();

export const permissionMiddleware = t.middleware(async ({ ctx, next }) => {
  const permissionResult = checkPermission(ctx.actor, "invoices.create");
  if (permissionResult === "deny") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "actor lacks permission: invoices.create",
    });
  }
  return next();
});

export const createInvoiceProcedure = t.procedure
  .input(createInvoiceInputSchema)
  .use(permissionMiddleware)
  .mutation(async ({ input, ctx }): Promise<CreateInvoiceInput & { id: string; createdAt: string }> => {
    const startedAt = new Date().toISOString();

    const invoice = db.invoices.create({
      customerId: input.customerId,
      amount: input.amount,
      dueDate: input.dueDate,
      notes: input.notes,
    });

    const output = {
      id: invoice.id,
      customerId: invoice.customerId,
      amount: invoice.amount,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
      createdAt: invoice.createdAt,
    };

    const durationMs = Date.now() - new Date(startedAt).getTime();

    await db.auditLog.write({
      actionName: "createInvoice",
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input,
      output,
      error: null,
      permissionResult: "allow",
      approvedBy: null,
      parentEventId: null,
      startedAt,
      durationMs,
      workspaceId: "default-workspace",
      blastRadius: ["invoices.*"],
      dryRun: false,
    });

    return output;
  });

export const appRouter = t.router({
  createInvoice: createInvoiceProcedure,
});

export type AppRouter = typeof appRouter;