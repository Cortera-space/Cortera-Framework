import { NextRequest, NextResponse } from "next/server";
import { createInvoiceInputSchema, type CreateInvoiceInput } from "./types";
import { db } from "./db";
import { checkPermission, type Actor } from "./permissions";

export async function POST(request: NextRequest) {
  const startedAt = new Date().toISOString();

  let rawInput: unknown;
  try {
    rawInput = await request.json();
  } catch {
    rawInput = {};
  }

  const validation = createInvoiceInputSchema.safeParse(rawInput);
  if (!validation.success) {
    const errorPayload = {
      issues: validation.error.issues,
      message: "Invalid input for createInvoice",
    };

    await db.auditLog.write({
      actionName: "createInvoice",
      actorType: "human",
      actorId: "unknown",
      input: rawInput,
      output: null,
      error: errorPayload,
      permissionResult: "allow",
      approvedBy: null,
      parentEventId: null,
      startedAt,
      durationMs: null,
      workspaceId: "default-workspace",
      blastRadius: null,
      dryRun: false,
    });

    return NextResponse.json(
      { error: "Validation failed", details: validation.error.issues },
      { status: 400 }
    );
  }

  const input = validation.data as CreateInvoiceInput;

  const authHeader = request.headers.get("authorization");
  const actor: Actor = authHeader?.startsWith("Bearer sk-agent-")
    ? { actorType: "agent", actorId: authHeader.replace("Bearer ", "").slice(0, 20) }
    : { actorType: "human", actorId: "user-123" };

  const permissionResult = checkPermission(actor, "invoices.create");
  if (permissionResult === "deny") {
    await db.auditLog.write({
      actionName: "createInvoice",
      actorType: actor.actorType,
      actorId: actor.actorId,
      input,
      output: null,
      error: `actor lacks permission: invoices.create`,
      permissionResult: "deny",
      approvedBy: null,
      parentEventId: null,
      startedAt,
      durationMs: null,
      workspaceId: "default-workspace",
      blastRadius: null,
      dryRun: false,
    });

    return NextResponse.json(
      { error: "actor lacks permission: invoices.create" },
      { status: 403 }
    );
  }

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
    actorType: actor.actorType,
    actorId: actor.actorId,
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

  return NextResponse.json({ result: output });
}

export async function GET() {
  return NextResponse.json({
    name: "createInvoice",
    description: "Creates a new invoice for a customer",
    permission: "invoices.create",
  });
}