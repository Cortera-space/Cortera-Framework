import { randomBytes } from "crypto";
import {
  ActionPermissionError,
  ActionContainmentError,
} from "./types";
import type {
  DbClient,
  ActionContext,
  Actor,
  InsertIrreversibleConfirmation,
  DefinedAction,
  ActionResult,
  PermissionEngine,
} from "./types";
import { checkActorContainment, checkBlastRadius } from "./containment";

export interface WorkspaceContact {
  channel: "email" | "sms";
  destination: string;
}

export interface WorkspaceContactResolver {
  getContact(workspaceId: string): Promise<WorkspaceContact | null>;
}

const DEFAULT_CONFIRMATION_TTL_MS = 15 * 60 * 1000;

function generateConfirmationToken(): string {
  return randomBytes(32).toString("hex");
}

function maskDestination(destination: string, channel: string): string {
  if (channel === "email") {
    const [local, domain] = destination.split("@");
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (channel === "sms") {
    if (destination.length <= 4) return `***${destination.slice(-1)}`;
    return `***${destination.slice(-4)}`;
  }
  return "***";
}

export async function requestIrreversibleConfirmation(
  actionEventId: string,
  action: DefinedAction<any>,
  actor: Actor,
  input: unknown,
  workspaceId: string,
  dbClient: DbClient,
  contactResolver: WorkspaceContactResolver,
  confirmationTtlMs: number = DEFAULT_CONFIRMATION_TTL_MS
): Promise<{ status: "awaiting_confirmation"; confirmationId: string }> {
  const contact = await contactResolver.getContact(workspaceId);
  if (!contact) {
    throw new Error(`No registered contact found for workspace ${workspaceId} — cannot send irreversible confirmation`);
  }

  const confirmationToken = generateConfirmationToken();
  const expiresAt = new Date(Date.now() + confirmationTtlMs);
  const sentToMasked = maskDestination(contact.destination, contact.channel);

  const insertConfirmation: InsertIrreversibleConfirmation = {
    actionEventId,
    actionName: action.name,
    input,
    actorId: actor.actorId,
    workspaceId,
    confirmationToken,
    channel: contact.channel,
    sentTo: sentToMasked,
    status: "pending",
    expiresAt,
    confirmedAt: null,
  };

  const { id: confirmationId } = await dbClient.insertIrreversibleConfirmation(insertConfirmation);

  await sendConfirmation(contact, confirmationToken, action.name, expiresAt);

  return { status: "awaiting_confirmation", confirmationId };
}

async function sendConfirmation(
  contact: WorkspaceContact,
  token: string,
  actionName: string,
  expiresAt: Date
): Promise<void> {
  const confirmUrl = `${process.env.TERA_CONFIRMATION_BASE_URL || "https://app.example.com"}/confirm/${token}`;
  const message = `Please confirm the irreversible action "${actionName}" by clicking: ${confirmUrl}\nThis link expires at ${expiresAt.toISOString()}.`;

  if (contact.channel === "email") {
    await sendEmail(contact.destination, `Confirm irreversible action: ${actionName}`, message);
  } else if (contact.channel === "sms") {
    await sendSms(contact.destination, message);
  }
}

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.log(`[MOCK EMAIL] To: ${to}, Subject: ${subject}, Body: ${body}`);
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.TERA_EMAIL_FROM || "Tera <noreply@tera.local>",
        to,
        subject,
        text: body,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to send email: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Failed to send confirmation email:", error);
    throw error;
  }
}

async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[MOCK SMS] To: ${to}, Body: ${body}`);
    return;
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: fromNumber, To: to, Body: body }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to send SMS: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Failed to send confirmation SMS:", error);
    throw error;
  }
}

export async function confirmIrreversibleConfirmation(
  token: string,
  dbClient: DbClient,
  actionRegistry: { get(name: string): DefinedAction<any> | undefined },
  permissionEngine?: PermissionEngine
): Promise<ActionResult<unknown>> {
  const confirmation = await dbClient.findIrreversibleConfirmationByToken(token);
  if (!confirmation) {
    throw new Error(`Invalid confirmation token: ${token}`);
  }

  if (confirmation.status !== "pending") {
    throw new Error(`Confirmation is not pending: ${confirmation.status}`);
  }

  if (confirmation.expiresAt < new Date()) {
    await dbClient.updateIrreversibleConfirmation(confirmation.id, { status: "expired" });
    throw new Error(`Confirmation has expired: ${token}`);
  }

  const action = actionRegistry.get(confirmation.actionName);
  if (!action) {
    throw new Error(`Action not found: ${confirmation.actionName}`);
  }

  const actor: Actor = { actorType: "human", actorId: confirmation.actorId };
  const ctx: ActionContext = {
    actor,
    workspaceId: confirmation.workspaceId,
    parentEventId: confirmation.actionEventId,
  };

  if (permissionEngine) {
    const permissionResult = await permissionEngine.check(actor, action, confirmation.input, confirmation.workspaceId);
    if (permissionResult === "deny") {
      await dbClient.updateIrreversibleConfirmation(confirmation.id, { status: "rejected" });
      await dbClient.updateActionEvent(confirmation.actionEventId, {
        permissionResult: "deny",
        error: "permission_denied_at_confirmation",
      });
      throw new ActionPermissionError(
        `actor lacks permission at confirmation time: ${action.permission}`,
        action.permission,
        "deny"
      );
    }
  }

  if (dbClient) {
    try {
      await checkActorContainment(dbClient, actor, confirmation.workspaceId);
    } catch (error) {
      if (error instanceof ActionContainmentError) {
        await dbClient.updateIrreversibleConfirmation(confirmation.id, { status: "rejected" });
        await dbClient.updateActionEvent(confirmation.actionEventId, {
          permissionResult: "deny",
          error: "actor_contained_at_confirmation",
        });
        throw error;
      }
      throw error;
    }
    await checkBlastRadius(dbClient, ctx, action);
  }

  await dbClient.updateIrreversibleConfirmation(confirmation.id, {
    status: "confirmed",
    confirmedAt: new Date(),
  });

  await dbClient.updateActionEvent(confirmation.actionEventId, {
    permissionResult: "allow",
    approvedBy: confirmation.actorId,
  });

  const startedAt = new Date();
  try {
    // Directly call the handler to avoid re-entering the execute flow
    const handlerResult = await action.handler(confirmation.input, ctx);
    const endAt = new Date();
    const durationMs = endAt.getTime() - startedAt.getTime();

    await dbClient.updateActionEvent(confirmation.actionEventId, {
      output: handlerResult,
      durationMs,
    });

    return { result: handlerResult, eventId: confirmation.actionEventId };
  } catch (error) {
    const endAt = new Date();
    const durationMs = endAt.getTime() - startedAt.getTime();
    await dbClient.updateActionEvent(confirmation.actionEventId, {
      output: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      durationMs,
    });
    throw error;
  }
}

export async function rejectIrreversibleConfirmation(
  token: string,
  dbClient: DbClient
): Promise<void> {
  const confirmation = await dbClient.findIrreversibleConfirmationByToken(token);
  if (!confirmation) {
    throw new Error(`Invalid confirmation token: ${token}`);
  }

  if (confirmation.status !== "pending") {
    throw new Error(`Confirmation is not pending: ${confirmation.status}`);
  }

  await dbClient.updateIrreversibleConfirmation(confirmation.id, { status: "rejected" });

  await dbClient.updateActionEvent(confirmation.actionEventId, {
    permissionResult: "deny",
    error: "confirmation_rejected",
    durationMs: 0,
  });
}

export async function expirePendingIrreversibleConfirmations(dbClient: DbClient): Promise<void> {
  const now = new Date();
  const pendingConfirmations = await dbClient.findAllPendingIrreversibleConfirmations();

  for (const confirmation of pendingConfirmations) {
    if (confirmation.expiresAt < now) {
      await dbClient.updateIrreversibleConfirmation(confirmation.id, {
        status: "expired",
      });

      await dbClient.updateActionEvent(confirmation.actionEventId, {
        permissionResult: "deny",
        error: "confirmation_expired",
        durationMs: 0,
      });
    }
  }
}