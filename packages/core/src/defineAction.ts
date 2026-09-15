import { z } from "zod";
import {
  ActionValidationError,
  ActionPermissionError,
  ActionPendingApprovalError,
  ActionContainmentError,
  type InsertActionEvent,
  type InsertActionApproval,
  type RiskTier,
  type RiskMode,
  type DelayedExecutionResult,
  type InsertPendingDelayedAction,
} from "./types";
import type { ActionConfig, DefinedAction, ActionContext, DbClient, PermissionEngine, ActionResult } from "./types";
import { recordEvent, updateEvent } from "./event-log";
import { checkActorContainment, checkBlastRadius } from "./containment";

async function runSchedulingChecks(
  dbClient: DbClient | undefined,
  ctx: ActionContext,
  action: DefinedAction<any>,
  permissionEngine: PermissionEngine | undefined
): Promise<"allow" | "deny" | "approval_required"> {
  if (dbClient) {
    try {
      await checkActorContainment(dbClient, ctx.actor, ctx.workspaceId);
    } catch (error) {
      if (error instanceof ActionContainmentError) {
        throw error;
      }
      throw error;
    }
    // NOTE: We intentionally SKIP checkBlastRadius here for delayed actions.
    // Blast radius is re-checked at execution time in the sweep.
  }

  const permissionResult = permissionEngine
    ? await permissionEngine.check(
        ctx.actor,
        action,
        undefined,
        ctx.workspaceId
      )
    : "allow";

  return permissionResult;
}

async function runFullChecks(
  dbClient: DbClient | undefined,
  ctx: ActionContext,
  action: DefinedAction<any>,
  permissionEngine: PermissionEngine | undefined
): Promise<"allow" | "deny" | "approval_required"> {
  if (dbClient) {
    try {
      await checkActorContainment(dbClient, ctx.actor, ctx.workspaceId);
    } catch (error) {
      if (error instanceof ActionContainmentError) {
        throw error;
      }
      throw error;
    }

    await checkBlastRadius(dbClient, ctx, action);
  }

  const permissionResult = permissionEngine
    ? await permissionEngine.check(
        ctx.actor,
        action,
        undefined,
        ctx.workspaceId
      )
    : "allow";

  return permissionResult;
}

async function executeImmediate(
  rawInput: unknown,
  ctx: ActionContext,
  dbClient: DbClient | undefined,
  permissionEngine: PermissionEngine | undefined,
  config: ActionConfig<any>,
  startedAt: Date
): Promise<ActionResult<unknown>> {
  const permissionResult = await runFullChecks(dbClient, ctx, { name: config.name, permission: config.permission, blastRadius: config.blastRadius } as DefinedAction<any>, permissionEngine);

  if (permissionResult === "deny") {
    if (dbClient) {
      const insertEvent: InsertActionEvent = {
        actionName: config.name,
        actorType: ctx.actor.actorType,
        actorId: ctx.actor.actorId,
        input: rawInput,
        output: null,
        error: `actor lacks permission: ${config.permission}`,
        permissionResult: "deny",
        approvedBy: null,
        parentEventId: ctx.parentEventId ?? null,
        startedAt,
        durationMs: null,
        workspaceId: ctx.workspaceId,
        blastRadius: config.blastRadius ?? null,
      };
      await recordEvent(dbClient, insertEvent);
    }

    throw new ActionPermissionError(
      `actor lacks permission: ${config.permission}`,
      config.permission,
      "deny"
    );
  }

  if (permissionResult === "approval_required") {
    if (!dbClient) {
      throw new ActionPendingApprovalError(
        `Action requires approval but no dbClient provided: ${config.name}`,
        config.permission,
        ""
      );
    }

    const insertEvent: InsertActionEvent = {
      actionName: config.name,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input: rawInput,
      output: null,
      error: null,
      permissionResult: "approval_required",
      approvedBy: null,
      parentEventId: ctx.parentEventId ?? null,
      startedAt,
      durationMs: null,
      workspaceId: ctx.workspaceId,
      blastRadius: config.blastRadius ?? null,
    };
    const { id: eventId } = await recordEvent(dbClient, insertEvent);

    const approvalTtlMs = config.approvalTtlMs ?? 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + approvalTtlMs);

    const insertApproval: InsertActionApproval = {
      actionEventId: eventId,
      actionName: config.name,
      input: rawInput,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      workspaceId: ctx.workspaceId,
      status: "pending",
      requestedAt: new Date(),
      expiresAt,
      resolvedAt: null,
      approvedBy: null,
    };
    const { id: approvalId } = await dbClient.insertActionApproval(insertApproval);

    throw new ActionPendingApprovalError(
      `Action requires approval (id: ${approvalId})`,
      config.permission,
      approvalId
    );
  }

  const result = config.inputSchema.safeParse(rawInput);
  if (!result.success) {
    const errorPayload = {
      issues: result.error.issues,
      message: `Invalid input for action "${config.name}"`,
    };

    if (dbClient) {
      const insertEvent: InsertActionEvent = {
        actionName: config.name,
        actorType: ctx.actor.actorType,
        actorId: ctx.actor.actorId,
        input: rawInput,
        output: null,
        error: errorPayload,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: ctx.parentEventId ?? null,
        startedAt,
        durationMs: null,
        workspaceId: ctx.workspaceId,
        blastRadius: config.blastRadius ?? null,
      };
      await recordEvent(dbClient, insertEvent);
    }

    throw new ActionValidationError(
      `Invalid input for action "${config.name}"`,
      result.error.issues
    );
  }

  let eventId: string | undefined;

  if (dbClient) {
    const insertEvent: InsertActionEvent = {
      actionName: config.name,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input: result.data,
      output: null,
      error: null,
      permissionResult: "allow",
      approvedBy: null,
      parentEventId: ctx.parentEventId ?? null,
      startedAt,
      durationMs: null,
      workspaceId: ctx.workspaceId,
      blastRadius: config.blastRadius ?? null,
    };
    const { id } = await recordEvent(dbClient, insertEvent);
    eventId = id;
  }

  try {
    const handlerResult = await config.handler(result.data, {
      ...ctx,
      eventId,
    });

    if (dbClient && eventId) {
      const endAt = new Date();
      const durationMs = endAt.getTime() - startedAt.getTime();
      await updateEvent(dbClient, eventId, {
        output: handlerResult,
        durationMs,
      });
    }

    return { result: handlerResult, eventId: eventId ?? "" };
  } catch (error) {
    if (dbClient && eventId) {
      const endAt = new Date();
      const durationMs = endAt.getTime() - startedAt.getTime();
      await updateEvent(dbClient, eventId, {
        output: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        durationMs,
      });
    }

    throw error;
  }
}

async function executeDelayed(
  rawInput: unknown,
  ctx: ActionContext,
  dbClient: DbClient | undefined,
  permissionEngine: PermissionEngine | undefined,
  config: ActionConfig<any>,
  startedAt: Date
): Promise<ActionResult<unknown> | DelayedExecutionResult> {
  if (!dbClient) {
    throw new Error(`Delayed execution requires a dbClient: ${config.name}`);
  }

  // Run scheduling checks (containment + permission, but NOT blast radius)
  const permissionResult = await runSchedulingChecks(dbClient, ctx, { name: config.name, permission: config.permission, blastRadius: config.blastRadius } as DefinedAction<any>, permissionEngine);

  if (permissionResult === "deny") {
    const insertEvent: InsertActionEvent = {
      actionName: config.name,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input: rawInput,
      output: null,
      error: `actor lacks permission: ${config.permission}`,
      permissionResult: "deny",
      approvedBy: null,
      parentEventId: ctx.parentEventId ?? null,
      startedAt,
      durationMs: null,
      workspaceId: ctx.workspaceId,
      blastRadius: config.blastRadius ?? null,
    };
    await recordEvent(dbClient, insertEvent);

    throw new ActionPermissionError(
      `actor lacks permission: ${config.permission}`,
      config.permission,
      "deny"
    );
  }

  if (permissionResult === "approval_required") {
    const insertEvent: InsertActionEvent = {
      actionName: config.name,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input: rawInput,
      output: null,
      error: null,
      permissionResult: "approval_required",
      approvedBy: null,
      parentEventId: ctx.parentEventId ?? null,
      startedAt,
      durationMs: null,
      workspaceId: ctx.workspaceId,
      blastRadius: config.blastRadius ?? null,
    };
    const { id: eventId } = await recordEvent(dbClient, insertEvent);

    const approvalTtlMs = config.approvalTtlMs ?? 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + approvalTtlMs);

    const insertApproval: InsertActionApproval = {
      actionEventId: eventId,
      actionName: config.name,
      input: rawInput,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      workspaceId: ctx.workspaceId,
      status: "pending",
      requestedAt: new Date(),
      expiresAt,
      resolvedAt: null,
      approvedBy: null,
    };
    const { id: approvalId } = await dbClient.insertActionApproval(insertApproval);

    throw new ActionPendingApprovalError(
      `Action requires approval (id: ${approvalId})`,
      config.permission,
      approvalId
    );
  }

  const result = config.inputSchema.safeParse(rawInput);
  if (!result.success) {
    const errorPayload = {
      issues: result.error.issues,
      message: `Invalid input for action "${config.name}"`,
    };

    const insertEvent: InsertActionEvent = {
      actionName: config.name,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input: rawInput,
      output: null,
      error: errorPayload,
      permissionResult: "allow",
      approvedBy: null,
      parentEventId: ctx.parentEventId ?? null,
      startedAt,
      durationMs: null,
      workspaceId: ctx.workspaceId,
      blastRadius: config.blastRadius ?? null,
    };
    await recordEvent(dbClient, insertEvent);

    throw new ActionValidationError(
      `Invalid input for action "${config.name}"`,
      result.error.issues
    );
  }

  // Create action_events row with permission_result "delayed"
  const insertEvent: InsertActionEvent = {
    actionName: config.name,
    actorType: ctx.actor.actorType,
    actorId: ctx.actor.actorId,
    input: result.data,
    output: null,
    error: null,
    permissionResult: "delayed",
    approvedBy: null,
    parentEventId: ctx.parentEventId ?? null,
    startedAt,
    durationMs: null,
    workspaceId: ctx.workspaceId,
    blastRadius: config.blastRadius ?? null,
  };
  const { id: eventId } = await recordEvent(dbClient, insertEvent);

  // Schedule delayed execution
  const delayWindowMs = config.delayWindowMs ?? 5 * 60 * 1000; // Default 5 minutes
  const scheduledRunAt = new Date(Date.now() + delayWindowMs);

  const pendingAction: InsertPendingDelayedAction = {
    actionEventId: eventId,
    actionName: config.name,
    input: result.data,
    actorId: ctx.actor.actorId,
    workspaceId: ctx.workspaceId,
    scheduledRunAt,
    status: "pending",
  };
  const { id: pendingId } = await dbClient.insertPendingDelayedAction(pendingAction);

  return {
    status: "delayed",
    pendingId,
    scheduledRunAt,
  };
}

async function executeIrreversible(
  rawInput: unknown,
  ctx: ActionContext,
  dbClient: DbClient | undefined,
  permissionEngine: PermissionEngine | undefined,
  config: ActionConfig<any>,
  startedAt: Date
): Promise<ActionResult<unknown> | DelayedExecutionResult> {
  // For now, treat as delayed with a special status - full implementation
  // will be in the OUT-OF-BAND CONFIRMATION feature
  if (!dbClient) {
    throw new Error(`Irreversible execution requires a dbClient: ${config.name}`);
  }

  // Run scheduling checks (containment + permission, but NOT blast radius)
  const permissionResult = await runSchedulingChecks(dbClient, ctx, { name: config.name, permission: config.permission, blastRadius: config.blastRadius } as DefinedAction<any>, permissionEngine);

  if (permissionResult === "deny") {
    const insertEvent: InsertActionEvent = {
      actionName: config.name,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input: rawInput,
      output: null,
      error: `actor lacks permission: ${config.permission}`,
      permissionResult: "deny",
      approvedBy: null,
      parentEventId: ctx.parentEventId ?? null,
      startedAt,
      durationMs: null,
      workspaceId: ctx.workspaceId,
      blastRadius: config.blastRadius ?? null,
    };
    await recordEvent(dbClient, insertEvent);

    throw new ActionPermissionError(
      `actor lacks permission: ${config.permission}`,
      config.permission,
      "deny"
    );
  }

  if (permissionResult === "approval_required") {
    const insertEvent: InsertActionEvent = {
      actionName: config.name,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input: rawInput,
      output: null,
      error: null,
      permissionResult: "approval_required",
      approvedBy: null,
      parentEventId: ctx.parentEventId ?? null,
      startedAt,
      durationMs: null,
      workspaceId: ctx.workspaceId,
      blastRadius: config.blastRadius ?? null,
    };
    const { id: eventId } = await recordEvent(dbClient, insertEvent);

    const approvalTtlMs = config.approvalTtlMs ?? 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + approvalTtlMs);

    const insertApproval: InsertActionApproval = {
      actionEventId: eventId,
      actionName: config.name,
      input: rawInput,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      workspaceId: ctx.workspaceId,
      status: "pending",
      requestedAt: new Date(),
      expiresAt,
      resolvedAt: null,
      approvedBy: null,
    };
    const { id: approvalId } = await dbClient.insertActionApproval(insertApproval);

    throw new ActionPendingApprovalError(
      `Action requires approval (id: ${approvalId})`,
      config.permission,
      approvalId
    );
  }

  const result = config.inputSchema.safeParse(rawInput);
  if (!result.success) {
    const errorPayload = {
      issues: result.error.issues,
      message: `Invalid input for action "${config.name}"`,
    };

    const insertEvent: InsertActionEvent = {
      actionName: config.name,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      input: rawInput,
      output: null,
      error: errorPayload,
      permissionResult: "allow",
      approvedBy: null,
      parentEventId: ctx.parentEventId ?? null,
      startedAt,
      durationMs: null,
      workspaceId: ctx.workspaceId,
      blastRadius: config.blastRadius ?? null,
    };
    await recordEvent(dbClient, insertEvent);

    throw new ActionValidationError(
      `Invalid input for action "${config.name}"`,
      result.error.issues
    );
  }

  // Create action_events row with permission_result "pending_confirmation"
  const insertEvent: InsertActionEvent = {
    actionName: config.name,
    actorType: ctx.actor.actorType,
    actorId: ctx.actor.actorId,
    input: result.data,
    output: null,
    error: null,
    permissionResult: "pending_confirmation",
    approvedBy: null,
    parentEventId: ctx.parentEventId ?? null,
    startedAt,
    durationMs: null,
    workspaceId: ctx.workspaceId,
    blastRadius: config.blastRadius ?? null,
  };
  const { id: eventId } = await recordEvent(dbClient, insertEvent);

  // For now, just return a delayed-like response with special status
  // The OUT-OF-BAND CONFIRMATION feature will implement the actual confirmation flow
  const pendingAction: InsertPendingDelayedAction = {
    actionEventId: eventId,
    actionName: config.name,
    input: result.data,
    actorId: ctx.actor.actorId,
    workspaceId: ctx.workspaceId,
    scheduledRunAt: new Date(Date.now() + 86400000), // Far future - will be triggered by confirmation
    status: "pending",
  };
  const { id: pendingId } = await dbClient.insertPendingDelayedAction(pendingAction);

  return {
    status: "delayed",
    pendingId,
    scheduledRunAt: pendingAction.scheduledRunAt,
  };
}

export function defineAction<TInput extends z.ZodTypeAny>(
  config: ActionConfig<TInput>
): DefinedAction<TInput> {
  if (!config.description || config.description.trim() === "") {
    throw new Error(`Action "${config.name}" must have a non-empty description`);
  }

  if (config.blastRadius === undefined) {
    console.warn(
      `Action "${config.name}" has no blastRadius declared — recommend setting blastRadius to restrict the scope of downstream actions this action may trigger`
    );
  }

  return {
    name: config.name,
    description: config.description,
    permission: config.permission,
    input: config.inputSchema,
    blastRadius: config.blastRadius,
    riskTier: config.riskTier,
    delayWindowMs: config.delayWindowMs,
    handler: config.handler,
    async execute(
      rawInput: unknown,
      ctx: ActionContext,
      dbClient?: DbClient,
      permissionEngine?: PermissionEngine,
      riskMode: RiskMode = "guarded"
    ): Promise<ActionResult<unknown> | DelayedExecutionResult> {
      const startedAt = new Date();

      // Early exit for autonomous mode - skip all tiering
      if (riskMode === "autonomous") {
        return executeImmediate(
          rawInput,
          ctx,
          dbClient,
          permissionEngine,
          config,
          startedAt
        );
      }

      // Guarded mode - apply tiering
      const riskTier = config.riskTier ?? "instant";

      if (riskTier === "instant") {
        return executeImmediate(
          rawInput,
          ctx,
          dbClient,
          permissionEngine,
          config,
          startedAt
        );
      }

      if (riskTier === "delayed") {
        return executeDelayed(
          rawInput,
          ctx,
          dbClient,
          permissionEngine,
          config,
          startedAt
        );
      }

      if (riskTier === "irreversible") {
        return executeIrreversible(
          rawInput,
          ctx,
          dbClient,
          permissionEngine,
          config,
          startedAt
        );
      }

      // Fallback - should never reach here
      return executeImmediate(
        rawInput,
        ctx,
        dbClient,
        permissionEngine,
        config,
        startedAt
      );
    },
  };
}
