import type {
  DbClient,
  ActionContext,
  Actor,
  DefinedAction,
  InsertPendingDelayedAction,
  PendingDelayedAction,
  InsertActionEvent,
  BehavioralDriftConfig,
} from "./types";
import { ActionContainmentError, ActionPermissionError, ActionValidationError } from "./types";
import { checkActorContainment, checkBlastRadius, containActorForBehavioralDrift } from "./containment";
import { recordEvent, updateEvent } from "./event-log";
import { runAllDetectors, DEFAULT_BEHAVIORAL_DRIFT_CONFIG } from "./behavioral-drift";

export async function cancelDelayedAction(
  dbClient: DbClient,
  pendingId: string,
  cancelingActorId: string
): Promise<void> {
  const pending = await dbClient.findPendingDelayedActionById(pendingId);
  if (!pending) {
    throw new Error(`Pending delayed action not found: ${pendingId}`);
  }

  if (pending.status !== "pending") {
    throw new Error(`Cannot cancel delayed action: status is ${pending.status}`);
  }

  if (pending.scheduledRunAt <= new Date()) {
    throw new Error(`Cannot cancel delayed action: scheduled run time has passed`);
  }

  await dbClient.updatePendingDelayedAction(pendingId, { status: "canceled" });

  // Write action_events row for the cancellation
  const insertEvent: InsertActionEvent = {
    actionName: pending.actionName,
    actorType: "system",
    actorId: cancelingActorId,
    input: pending.input,
    output: null,
    error: "canceled during delay window",
    permissionResult: "deny",
    approvedBy: cancelingActorId,
    parentEventId: pending.actionEventId,
    startedAt: new Date(),
    durationMs: 0,
    workspaceId: pending.workspaceId,
    blastRadius: null,
  };
  await dbClient.insertActionEvent(insertEvent);
}

export async function processPendingDelayedActions(
  dbClient: DbClient,
  workspaceId: string,
  permissionEngine: any,
  actionRegistry: { get(name: string): DefinedAction<any> | undefined }
): Promise<number> {
  const dueActions = await dbClient.findPendingDelayedActionsDue(workspaceId);
  let processed = 0;

  for (const pending of dueActions) {
    // Skip if not pending (could have been canceled between query and now)
    if (pending.status !== "pending") {
      continue;
    }

    const action = actionRegistry.get(pending.actionName);
    if (!action) {
      // Action no longer exists - mark as canceled
      await dbClient.updatePendingDelayedAction(pending.id, { status: "canceled" });
      continue;
    }

    // Use the original actor for permission/containment checks
    const originalActor: Actor = { actorType: "human", actorId: pending.actorId };
    const ctx: ActionContext = {
      actor: originalActor,
      workspaceId: pending.workspaceId,
      parentEventId: pending.actionEventId,
    };

    // RE-RUN all checks (containment, blast radius, permission, behavioral drift) at execution time
    try {
      await checkActorContainment(dbClient, ctx.actor, ctx.workspaceId);
      await checkBlastRadius(dbClient, ctx, action);

      // Behavioral drift detection at execution time (only if action has behavioralDriftConfig and dbClient supports it)
      const driftConfig: BehavioralDriftConfig = (action as any).behavioralDriftConfig ?? DEFAULT_BEHAVIORAL_DRIFT_CONFIG;
      const hasBehavioralDriftConfig = !!(action as any).behavioralDriftConfig;
      const dbClientSupportsHistory = dbClient && typeof (dbClient as any).findActorCallHistory === "function";
      
      if (hasBehavioralDriftConfig && dbClientSupportsHistory) {
        const driftMatches = await runAllDetectors(dbClient, ctx.actor.actorId, ctx.workspaceId, driftConfig, new Date(), action.permission);
        if (driftMatches.length > 0) {
          await containActorForBehavioralDrift(dbClient, ctx, action, driftMatches);
        }
      }
    } catch (error) {
      if (error instanceof ActionContainmentError) {
        // Use the actual error code from the containment error
        await handleDelayedFailure(dbClient, pending, error.errorCode, error.message);
        continue;
      }
      if (error instanceof ActionPermissionError) {
        await handleDelayedFailure(dbClient, pending, "BLAST_RADIUS_EXCEEDED", error.message);
        continue;
      }
      throw error;
    }

    // Check permission again using the original actor
    const permissionResult = permissionEngine
      ? await permissionEngine.check(ctx.actor, action, pending.input, ctx.workspaceId)
      : "allow";

    if (permissionResult === "deny") {
      await handleDelayedFailure(dbClient, pending, "PERMISSION_DENIED", `actor lacks permission: ${action.permission}`);
      continue;
    }

    if (permissionResult === "approval_required") {
      // For delayed actions, if it now requires approval, cancel it
      // (The original check passed, so this would be a race condition)
      await handleDelayedFailure(dbClient, pending, "APPROVAL_REQUIRED", "action now requires approval");
      continue;
    }

    // All checks passed - execute the handler
    const result = action.input.safeParse(pending.input);
    if (!result.success) {
      await handleDelayedFailure(dbClient, pending, "VALIDATION_ERROR", "input validation failed at execution time");
      continue;
    }

    try {
      const handlerResult = await action.handler(result.data, { ...ctx, eventId: pending.actionEventId });

      await dbClient.updateActionEvent(pending.actionEventId, {
        output: handlerResult,
        durationMs: 0,
        permissionResult: "allow",
      });

      await dbClient.updatePendingDelayedAction(pending.id, { status: "executed" });
      processed++;
    } catch (error) {
      await handleDelayedFailure(dbClient, pending, "HANDLER_ERROR", error instanceof Error ? error.message : String(error));
    }
  }

  return processed;
}

async function handleDelayedFailure(
  dbClient: DbClient,
  pending: PendingDelayedAction,
  errorCode: string,
  message: string
): Promise<void> {
  await dbClient.updatePendingDelayedAction(pending.id, { status: "canceled" });

  await dbClient.updateActionEvent(pending.actionEventId, {
    permissionResult: "deny",
    error: { code: errorCode, message },
    durationMs: 0,
  });

  const insertEvent: InsertActionEvent = {
    actionName: pending.actionName,
    actorType: "system",
    actorId: pending.actorId,
    input: pending.input,
    output: null,
    error: { code: errorCode, message },
    permissionResult: "deny",
    approvedBy: null,
    parentEventId: pending.actionEventId,
    startedAt: new Date(),
    durationMs: 0,
    workspaceId: pending.workspaceId,
    blastRadius: null,
  };
  await dbClient.insertActionEvent(insertEvent);
}