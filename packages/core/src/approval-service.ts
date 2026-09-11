import type {
  ActionApproval,
  DbClient,
  ActionContext,
  ActionResult,
} from "./types";
import { ActionPendingApprovalError } from "./types";

export function buildApprovalError(approval: ActionApproval): ActionPendingApprovalError {
  return new ActionPendingApprovalError(
    `Action requires approval (id: ${approval.id})`,
    "approval_required",
    approval.id
  );
}

export async function resolveApproval(
  approvalId: string,
  decision: "approved" | "rejected",
  approverActorId: string,
  dbClient: DbClient,
  actionRegistry: { get(name: string): { execute: (rawInput: unknown, ctx: ActionContext, dbClient: DbClient) => Promise<ActionResult<unknown>> } | undefined }
): Promise<void> {
  const approval = await dbClient.findApprovalById(approvalId);

  if (!approval) {
    throw new Error(`Approval not found: ${approvalId}`);
  }

  if (approval.status !== "pending") {
    throw new Error(`Approval is not pending: ${approval.status}`);
  }

  if (approval.expiresAt < new Date()) {
    throw new Error(`Approval has expired: ${approvalId}`);
  }

  const now = new Date();
  const status = decision === "approved" ? "approved" : "rejected";

  await dbClient.updateActionApproval(approvalId, {
    status,
    resolvedAt: now,
    approvedBy: approverActorId,
  });

  if (decision === "rejected") {
    await dbClient.updateActionEvent(approval.actionEventId, {
      permissionResult: "deny",
      error: "approval_rejected",
      durationMs: 0,
    });
    return;
  }

  const action = actionRegistry.get(approval.actionName);
  if (!action) {
    throw new Error(`Action not found: ${approval.actionName}`);
  }

  await dbClient.updateActionEvent(approval.actionEventId, {
    permissionResult: "allow",
    approvedBy: approverActorId,
  });

  const ctx: ActionContext = {
    actor: { actorType: approval.actorType, actorId: approval.actorId },
    workspaceId: approval.workspaceId,
    parentEventId: approval.actionEventId,
  };

  let replayEventId: string | undefined;
  let startedAt = new Date();

  try {
    startedAt = new Date();
    const result = await action.execute(approval.input, ctx, dbClient);
    replayEventId = result.eventId;
    const endAt = new Date();
    const durationMs = endAt.getTime() - startedAt.getTime();

    await dbClient.updateActionEvent(approval.actionEventId, {
      output: result.result,
      durationMs,
    });

    if (replayEventId && replayEventId !== approval.actionEventId) {
      await dbClient.updateActionEvent(replayEventId, {
        output: null,
        error: "superseded_by_approval",
        durationMs: 0,
      });
    }
  } catch (error) {
    const endAt = new Date();
    const durationMs = endAt.getTime() - startedAt.getTime();
    await dbClient.updateActionEvent(approval.actionEventId, {
      output: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      durationMs,
    });

    if (replayEventId && replayEventId !== approval.actionEventId) {
      await dbClient.updateActionEvent(replayEventId, {
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

export async function expirePendingApprovals(dbClient: DbClient): Promise<void> {
  const now = new Date();
  const pendingApprovals = await dbClient.findAllPendingApprovals();

  for (const approval of pendingApprovals) {
    if (approval.expiresAt >= now) {
      continue;
    }

    await dbClient.updateActionApproval(approval.id, {
      status: "expired",
      resolvedAt: now,
    });

    await dbClient.updateActionEvent(approval.actionEventId, {
      permissionResult: "deny",
      error: "approval_expired",
      durationMs: 0,
    });
  }
}
