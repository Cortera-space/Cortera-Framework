import type {
  DbClient,
  ActionContext,
  Actor,
  ActionEvent,
  RollbackFn,
  DefinedAction,
  ActionResult,
} from "./types";
import { recordEvent } from "./event-log";

export class ActionRollbackError extends Error {
  constructor(
    message: string,
    public readonly originalEventId: string,
    public readonly rollbackEventId: string | null = null
  ) {
    super(message);
    this.name = "ActionRollbackError";
  }
}

export async function rollbackAction(
  actionEventId: string,
  requestingActorId: string,
  dbClient: DbClient,
  actionRegistry: { get(name: string): DefinedAction<any> | undefined }
): Promise<ActionResult<unknown>> {
  const originalEvent = await dbClient.findEventById(actionEventId);
  if (!originalEvent) {
    throw new ActionRollbackError(`Original event not found: ${actionEventId}`, actionEventId);
  }

  const action = actionRegistry.get(originalEvent.actionName);
  if (!action) {
    throw new ActionRollbackError(`Action not found: ${originalEvent.actionName}`, actionEventId);
  }

  if (!action.rollback) {
    throw new ActionRollbackError(
      `Action "${action.name}" does not have a rollback function defined — cannot be rolled back`,
      actionEventId
    );
  }

  const originalEventDetails = await getEventDetails(actionEventId, dbClient);
  if (!originalEventDetails) {
    throw new ActionRollbackError(`Original event details not found: ${actionEventId}`, actionEventId);
  }

  if (originalEventDetails.permissionResult !== "allow") {
    throw new ActionRollbackError(
      `Original event was not executed successfully (permissionResult: ${originalEventDetails.permissionResult})`,
      actionEventId
    );
  }

  const rollbackCtx: ActionContext = {
    actor: { actorType: "human", actorId: requestingActorId },
    workspaceId: originalEventDetails.workspaceId,
    parentEventId: actionEventId,
  };

  const rollbackResult = await action.rollback(originalEventDetails.output, rollbackCtx);

  const rollbackEventId = await recordRollbackEvent(
    dbClient,
    action.name,
    requestingActorId,
    originalEventDetails.workspaceId,
    actionEventId,
    rollbackResult
  );

  return { result: rollbackResult, eventId: rollbackEventId };
}

async function getEventDetails(actionEventId: string, dbClient: DbClient): Promise<{
  actionName: string;
  workspaceId: string;
  output: unknown;
  permissionResult: string;
} | null> {
  const { rows } = await (dbClient as any).pool?.query?.(
    `SELECT action_name, workspace_id, output, permission_result
     FROM action_events
     WHERE id = $1`,
    [actionEventId]
  );

  if (rows && rows.length > 0) {
    return {
      actionName: rows[0].action_name,
      workspaceId: rows[0].workspace_id,
      output: rows[0].output ? JSON.parse(rows[0].output) : null,
      permissionResult: rows[0].permission_result,
    };
  }

  const events = (dbClient as any).events;
  if (events) {
    const event = events.find((e: any) => e.id === actionEventId);
    if (event) {
      return {
        actionName: event.actionName,
        workspaceId: event.workspaceId,
        output: event.output,
        permissionResult: event.permissionResult,
      };
    }
  }

  return null;
}

async function recordRollbackEvent(
  dbClient: DbClient,
  actionName: string,
  actorId: string,
  workspaceId: string,
  parentEventId: string,
  output: unknown
): Promise<string> {
  const insertEvent = {
    actionName: `${actionName}.rollback`,
    actorType: "human" as const,
    actorId,
    input: { parentEventId },
    output,
    error: null,
    permissionResult: "allow" as const,
    approvedBy: actorId,
    parentEventId,
    startedAt: new Date(),
    durationMs: null,
    workspaceId,
    blastRadius: null,
  };

  const { id } = await dbClient.insertActionEvent(insertEvent as any);
  return id;
}