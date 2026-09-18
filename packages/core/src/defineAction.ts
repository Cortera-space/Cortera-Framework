import { z } from "zod";
import {
  ActionValidationError,
  ActionPermissionError,
  ActionPendingApprovalError,
  ActionPendingIrreversibleConfirmationError,
  ActionContainmentError,
  type InsertActionEvent,
  type InsertActionApproval,
  type RiskTier,
  type RiskMode,
  type DelayedExecutionResult,
  type InsertPendingDelayedAction,
  type DbClient,
  type ActionContext,
  type DefinedAction,
  type ActionResult,
  type ActionExecutionResult,
  type DryRunResult,
  type PermissionEngine,
  type ExecuteOptions,
  type ActionConfig,
  type TriggerReason,
} from "./types";
import { recordEvent, updateEvent } from "./event-log";
import { checkActorContainment, checkBlastRadius } from "./containment";
import { requestIrreversibleConfirmation } from "./irreversible-confirmation";
import { computeOutputProvenance, resolveInputProvenance, recordOutputProvenance, hasUntrustedInput, getUntrustedSourceInfo } from "./provenance";

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
  permissionEngine: PermissionEngine | undefined,
  dryRun = false
): Promise<"allow" | "deny" | "approval_required"> {
  if (dbClient) {
    try {
      await checkActorContainment(dbClient, ctx.actor, ctx.workspaceId, dryRun);
    } catch (error) {
      if (error instanceof ActionContainmentError) {
        throw error;
      }
      throw error;
    }

    await checkBlastRadius(dbClient, ctx, action, dryRun);
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
  config: ActionConfig<any, unknown>,
  startedAt: Date,
  dryRun: boolean,
  riskMode?: string
): Promise<ActionExecutionResult<unknown>> {
  const permissionResult = await runFullChecks(dbClient, ctx, { name: config.name, permission: config.permission, blastRadius: config.blastRadius } as DefinedAction<any>, permissionEngine, dryRun);

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
        dryRun,
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
      dryRun,
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
        dryRun,
      };
      await recordEvent(dbClient, insertEvent);
    }

    throw new ActionValidationError(
      `Invalid input for action "${config.name}"`,
      result.error.issues
    );
  }

  let eventId: string | undefined;

  // Resolve input provenance from parent event
  let inputProvenance: Map<string, "trusted" | "untrusted-external"> = new Map();
  if (dbClient) {
    const rawInputObj = rawInput as Record<string, unknown> ?? {};
    inputProvenance = await resolveInputProvenance(dbClient, ctx.parentEventId, rawInputObj);
  }

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
      dryRun,
    };
    const { id } = await recordEvent(dbClient, insertEvent);
    eventId = id;
  }

  if (dryRun) {
    return { wouldSucceed: true as const, eventId };
  }

  // Taint enforcement check (Stage 14c): if any input is untrusted-external and riskMode is guarded,
  // force through out-of-band confirmation like an irreversible action
  // EXCEPTION: if the action has sanitizes: true, it can clean the taint and execute without confirmation
  const effectiveRiskMode = riskMode ?? (config as any).riskMode ?? "guarded";
  if (effectiveRiskMode === "guarded" && hasUntrustedInput(inputProvenance) && !config.sanitizes) {
    if (!dbClient || !eventId) {
      throw new Error("Taint enforcement requires dbClient and eventId");
    }

    // Get untrusted source info for the confirmation notification
    const untrustedSourceInfo = await getUntrustedSourceInfo(dbClient, inputProvenance);

    // Use the same confirmation flow as irreversible actions, but with trigger_reason 'untrusted_provenance'
    const contactResolver = (globalThis as any).__TERA_CONTACT_RESOLVER__;
    if (!contactResolver) {
      throw new Error("Workspace contact resolver not configured for taint enforcement");
    }

    const confirmationTtlMs = config.confirmationTtlMs ?? 15 * 60 * 1000;

    const confirmationResult = await requestIrreversibleConfirmation(
      eventId,
      { name: config.name, permission: config.permission, blastRadius: config.blastRadius } as DefinedAction<any>,
      ctx.actor,
      rawInput,
      ctx.workspaceId,
      dbClient,
      contactResolver,
      confirmationTtlMs,
      "untrusted_provenance",
      untrustedSourceInfo ?? undefined
    );

    throw new ActionPendingIrreversibleConfirmationError(
      `Action requires confirmation due to untrusted provenance (id: ${confirmationResult.confirmationId})`,
      confirmationResult.confirmationId
    );
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

      // Compute and record output provenance
      const outputLabel = computeOutputProvenance(inputProvenance, config.sanitizes ?? false);
      await recordOutputProvenance(dbClient, eventId, outputLabel, ctx.parentEventId ?? null);
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
  config: ActionConfig<any, unknown>,
  startedAt: Date
): Promise<ActionExecutionResult<unknown> | DelayedExecutionResult> {
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

  // Resolve input provenance from parent event
  let inputProvenance: Map<string, "trusted" | "untrusted-external"> = new Map();
  if (dbClient) {
    const rawInputObj = rawInput as Record<string, unknown> ?? {};
    inputProvenance = await resolveInputProvenance(dbClient, ctx.parentEventId, rawInputObj);
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
  config: ActionConfig<any, unknown>,
  startedAt: Date
): Promise<ActionExecutionResult<unknown> | DelayedExecutionResult> {
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

  // Resolve input provenance from parent event
  let inputProvenance: Map<string, "trusted" | "untrusted-external"> = new Map();
  if (dbClient) {
    const rawInputObj = rawInput as Record<string, unknown> ?? {};
    inputProvenance = await resolveInputProvenance(dbClient, ctx.parentEventId, rawInputObj);
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
  const { id: actionEventId } = await recordEvent(dbClient, insertEvent);

  const contactResolver = (globalThis as any).__TERA_CONTACT_RESOLVER__;
  if (!contactResolver) {
    throw new Error("Workspace contact resolver not configured for irreversible actions");
  }

  const confirmationTtlMs = config.confirmationTtlMs ?? 15 * 60 * 1000;

  const confirmationResult = await requestIrreversibleConfirmation(
    actionEventId,
    { name: config.name, permission: config.permission, blastRadius: config.blastRadius } as DefinedAction<any>,
    ctx.actor,
    rawInput,
    ctx.workspaceId,
    dbClient,
    contactResolver,
    confirmationTtlMs,
    "declared_irreversible"
  );

  throw new ActionPendingIrreversibleConfirmationError(
    `Irreversible action requires confirmation (id: ${confirmationResult.confirmationId})`,
    confirmationResult.confirmationId
  );
}

export function defineAction<TInput extends z.ZodTypeAny, TOutput = unknown>(
  config: ActionConfig<TInput, TOutput>
): DefinedAction<TInput, TOutput> {
  if (!config.description || config.description.trim() === "") {
    throw new Error(`Action "${config.name}" must have a non-empty description`);
  }

  if (config.blastRadius === undefined) {
    console.warn(
      `Action "${config.name}" has no blastRadius declared — recommend setting blastRadius to restrict the scope of downstream actions this action may trigger`
    );
  }

  const riskTier = config.riskTier ?? "instant";
  const confirmationTtlMs = config.confirmationTtlMs ?? 15 * 60 * 1000;

  const execute = async (
    rawInput: unknown,
    ctx: ActionContext,
    dbClient?: DbClient,
    permissionEngine?: PermissionEngine,
    options?: ExecuteOptions
  ): Promise<ActionExecutionResult<unknown> | DelayedExecutionResult> => {
    const dryRun = options?.dryRun ?? false;
    const startedAt = new Date();

    // Early exit for autonomous mode - skip all tiering
    // Check options first (for per-call override), then config (for per-action default)
    const riskMode = options?.riskMode ?? (config as any).riskMode ?? "guarded";
    if (riskMode === "autonomous") {
      return executeImmediate(rawInput, ctx, dbClient, permissionEngine, config as ActionConfig<any, unknown>, startedAt, dryRun, riskMode);
    }

    // Guarded mode - apply tiering
    const tier = riskTier;

    if (tier === "instant") {
      return executeImmediate(rawInput, ctx, dbClient, permissionEngine, config as ActionConfig<any, unknown>, startedAt, dryRun, riskMode);
    }

    if (tier === "delayed") {
      return executeDelayed(rawInput, ctx, dbClient, permissionEngine, config as ActionConfig<any, unknown>, startedAt);
    }

    if (tier === "irreversible") {
      return executeIrreversible(rawInput, ctx, dbClient, permissionEngine, config as ActionConfig<any, unknown>, startedAt);
    }

    // Fallback - should never reach here
    return executeImmediate(rawInput, ctx, dbClient, permissionEngine, config as ActionConfig<any, unknown>, startedAt, dryRun, riskMode);
  };

  const self: DefinedAction<TInput, TOutput> = {
    name: config.name,
    description: config.description,
    permission: config.permission,
    input: config.inputSchema,
    blastRadius: config.blastRadius,
    riskTier,
    confirmationTtlMs,
    delayWindowMs: config.delayWindowMs,
    rollback: config.rollback,
    handler: config.handler,
    execute,
  };

  return self;
}