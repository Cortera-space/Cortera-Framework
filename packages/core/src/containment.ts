import type {
  Actor,
  ActionContext,
  ActorState,
  InsertActorState,
  ActionEventLookup,
  DefinedAction,
  DbClient,
  ContainmentReason,
} from "./types";
import { ActionContainmentError } from "./types";

function matchesBlastRadius(permissionKey: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    if (regex.test(permissionKey)) {
      return true;
    }
  }
  return false;
}

async function walkToRootAction(
  dbClient: DbClient,
  parentEventId: string
): Promise<ActionEventLookup | null> {
  let currentId: string | null = parentEventId;
  let rootEvent: ActionEventLookup | null = null;

  while (currentId !== null) {
    const event = await dbClient.findEventById(currentId);
    if (!event) {
      break;
    }
    rootEvent = event;
    currentId = event.parentEventId;
  }

  return rootEvent;
}

export async function getActorState(
  dbClient: DbClient,
  actor: Actor,
  workspaceId: string
): Promise<ActorState | null> {
  return dbClient.findActorState(actor.actorId, workspaceId);
}

export async function checkActorContainment(
  dbClient: DbClient,
  actor: Actor,
  workspaceId: string,
  dryRun = false
): Promise<void> {
  const state = await getActorState(dbClient, actor, workspaceId);
  if (!state || state.status === "active") {
    return;
  }

  const errorCode = state.status === "contained" ? "ACTOR_CONTAINED" : "ACTOR_REVOKED";
  const containmentType = state.containmentReason ?? "unknown";
  const message =
    state.status === "contained"
      ? `actor is contained (${containmentType}): ${state.containedReason ?? "no reason provided"}`
      : "actor is revoked";

  if (dbClient && !dryRun) {
    const insertEvent = {
      actionName: "unknown",
      actorType: actor.actorType,
      actorId: actor.actorId,
      input: null,
      output: null,
      error: { code: errorCode, message, containmentReason: containmentType },
      permissionResult: "deny" as const,
      approvedBy: null,
      parentEventId: null,
      startedAt: new Date(),
      durationMs: null,
      workspaceId,
      blastRadius: null,
      dryRun,
    };

    await dbClient.insertActionEvent(insertEvent as any);
  }

  throw new ActionContainmentError(message, errorCode, "deny");
}

export async function checkBlastRadius(
  dbClient: DbClient,
  ctx: ActionContext,
  action: DefinedAction<any>,
  dryRun = false
): Promise<void> {
  if (!ctx.parentEventId) {
    return;
  }

  const rootEvent = await walkToRootAction(dbClient, ctx.parentEventId);
  if (!rootEvent || !rootEvent.blastRadius || rootEvent.blastRadius.length === 0) {
    return;
  }

  const permissionKey = action.permission;
  const withinBlastRadius = matchesBlastRadius(permissionKey, rootEvent.blastRadius);

  if (withinBlastRadius) {
    return;
  }

  const reason = `action "${action.name}" (${permissionKey}) exceeds blast radius of root action "${rootEvent.actionName}" (${rootEvent.blastRadius.join(", ")})`;

  if (!dryRun) {
    const now = new Date();
    const insertState: InsertActorState = {
      actorId: ctx.actor.actorId,
      workspaceId: ctx.workspaceId,
      status: "contained",
      containedAt: now,
      containedReason: reason,
      containmentReason: "blast_radius_violation",
      reviewedBy: null,
      reviewedAt: null,
    };

    await dbClient.upsertActorState(insertState);
  }

  const insertEvent = {
    actionName: action.name,
    actorType: ctx.actor.actorType,
    actorId: ctx.actor.actorId,
    input: null,
    output: null,
    error: {
      code: "BLAST_RADIUS_EXCEEDED",
      message: reason,
      rootAction: rootEvent.actionName,
      rootBlastRadius: rootEvent.blastRadius,
      violatingAction: action.name,
      violatingPermission: permissionKey,
      dryRun,
    },
    permissionResult: "deny" as const,
    approvedBy: null,
    parentEventId: ctx.parentEventId,
    startedAt: new Date(),
    durationMs: null,
    workspaceId: ctx.workspaceId,
    blastRadius: action.blastRadius ?? null,
    dryRun,
  };

  await dbClient.insertActionEvent(insertEvent as any);

  throw new ActionContainmentError(
    dryRun ? `would be contained: ${reason}` : reason,
    "BLAST_RADIUS_EXCEEDED",
    "deny"
  );
}

export async function reviewContainedActor(
  dbClient: DbClient,
  actorId: string,
  workspaceId: string,
  decision: "lift" | "revoke",
  reviewerActorId: string
): Promise<void> {
  const existing = await dbClient.findActorState(actorId, workspaceId);
  if (!existing) {
    return;
  }

  if (decision === "revoke") {
    await dbClient.upsertActorState({
      actorId,
      workspaceId,
      status: "revoked",
      containedAt: existing.containedAt,
      containedReason: existing.containedReason,
      containmentReason: existing.containmentReason,
      reviewedBy: reviewerActorId,
      reviewedAt: new Date(),
    });
    return;
  }

  if (decision === "lift") {
    if (existing.status === "revoked") {
      throw new Error(
        `cannot lift actor "${actorId}" in workspace "${workspaceId}": actor is revoked (permanent)`
      );
    }
    await dbClient.upsertActorState({
      actorId,
      workspaceId,
      status: "active",
      containedAt: null,
      containedReason: null,
      containmentReason: null,
      reviewedBy: reviewerActorId,
      reviewedAt: new Date(),
    });
  }
}

export async function containActorForBehavioralDrift(
  dbClient: DbClient,
  ctx: ActionContext,
  action: DefinedAction<any>,
  matches: Array<{ detector: string; explanation: string; severity: string }>,
  dryRun = false
): Promise<void> {
  const reason = `behavioral drift detected: ${matches.map((m) => m.detector).join(", ")}`;
  const detailedReason = matches.map((m) => `${m.detector}: ${m.explanation}`).join("; ");

  if (!dryRun) {
    const now = new Date();
    const insertState: InsertActorState = {
      actorId: ctx.actor.actorId,
      workspaceId: ctx.workspaceId,
      status: "contained",
      containedAt: now,
      containedReason: detailedReason,
      containmentReason: "behavioral_drift",
      reviewedBy: null,
      reviewedAt: null,
    };

    await dbClient.upsertActorState(insertState);
  }

  const insertEvent = {
    actionName: action.name,
    actorType: ctx.actor.actorType,
    actorId: ctx.actor.actorId,
    input: null,
    output: null,
    error: {
      code: "BEHAVIORAL_DRIFT_DETECTED",
      message: reason,
      detailedReason,
      detectors: matches.map((m) => ({ detector: m.detector, explanation: m.explanation, severity: m.severity })),
      dryRun,
    },
    permissionResult: "deny" as const,
    approvedBy: null,
    parentEventId: ctx.parentEventId,
    startedAt: new Date(),
    durationMs: null,
    workspaceId: ctx.workspaceId,
    blastRadius: action.blastRadius ?? null,
    dryRun,
  };

  await dbClient.insertActionEvent(insertEvent as any);

  throw new ActionContainmentError(
    dryRun ? `would be contained (behavioral drift): ${reason}` : reason,
    "BEHAVIORAL_DRIFT_DETECTED",
    "deny"
  );
}