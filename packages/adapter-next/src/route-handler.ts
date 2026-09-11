import { NextRequest, NextResponse } from "next/server";
import {
  ActionRegistry,
  Actor,
  DbClient,
  PermissionEngine,
  ActionValidationError,
  ActionPermissionError,
  ActionContainmentError,
  ActionPendingApprovalError,
  DefinedAction,
} from "@tera/core";

export interface CreateActionHandlerOptions {
  registry: ActionRegistry;
  dbClient: DbClient;
  permissionEngine: PermissionEngine;
  resolveActor: (request: NextRequest) => Promise<Actor | null>;
  defaultWorkspaceId: string;
}

export function createActionHandler(options: CreateActionHandlerOptions) {
  const {
    registry,
    dbClient,
    permissionEngine,
    resolveActor,
    defaultWorkspaceId,
  } = options;

  return async (
    request: NextRequest,
    context: { params: { actionName: string } }
  ): Promise<NextResponse> => {
    const { actionName } = await context.params;

    const action = registry.get(actionName);
    if (!action) {
      return NextResponse.json(
        { error: `Action not found: ${actionName}` },
        { status: 404 }
      );
    }

    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    let rawInput: unknown;
    try {
      rawInput = await request.json();
    } catch {
      rawInput = {};
    }

    const actionContext = {
      actor,
      workspaceId: defaultWorkspaceId,
      parentEventId: request.headers.get("x-tera-parent-event-id") || undefined,
    };

    try {
      const result = await (action as DefinedAction<any>).execute(
        rawInput,
        actionContext,
        dbClient,
        permissionEngine
      );
      return NextResponse.json({ result: result.result });
    } catch (error) {
      if (error instanceof ActionValidationError) {
        return NextResponse.json(
          {
            error: error.message,
            details: error.issues,
          },
          { status: 400 }
        );
      }

      if (error instanceof ActionPermissionError) {
        return NextResponse.json(
          {
            error: error.message,
            reason: error.permissionResult,
          },
          { status: 403 }
        );
      }

      if (error instanceof ActionContainmentError) {
        return NextResponse.json(
          {
            error: error.message,
            reason: error.errorCode,
          },
          { status: 403 }
        );
      }

      if (error instanceof ActionPendingApprovalError) {
        return NextResponse.json(
          {
            status: "pending",
            approvalId: error.approvalId,
          },
          { status: 202 }
        );
      }

      console.error("Unhandled action error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
