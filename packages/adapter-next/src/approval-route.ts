import { NextRequest, NextResponse } from "next/server";
import { DbClient, Actor, resolveApproval } from "@cortera/core";

export interface ApprovalRouteOptions {
  dbClient: DbClient;
  registry: {
    get(name: string): {
      execute: (
        rawInput: unknown,
        ctx: { actor: Actor; workspaceId: string; parentEventId?: string },
        dbClient: DbClient
      ) => Promise<{ result: unknown; eventId: string }>;
    } | undefined;
  };
  resolveActor: (request: NextRequest) => Promise<Actor | null>;
  defaultWorkspaceId: string;
}

export function createApprovalRouteHandler(options: ApprovalRouteOptions) {
  const { dbClient, registry, resolveActor } = options;

  return async (
    request: NextRequest,
    context: { params: { approvalId: string } }
  ): Promise<NextResponse> => {
    const { approvalId } = await context.params;

    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    let body: { decision?: "approved" | "rejected" };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const decision = body.decision;
    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json(
        { error: "decision must be 'approved' or 'rejected'" },
        { status: 400 }
      );
    }

    try {
      await resolveApproval(
        approvalId,
        decision,
        actor.actorId,
        dbClient,
        registry
      );
      return NextResponse.json({ status: "ok" });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          return NextResponse.json(
            { error: error.message },
            { status: 404 }
          );
        }
        if (error.message.includes("not pending") || error.message.includes("expired")) {
          return NextResponse.json(
            { error: error.message },
            { status: 409 }
          );
        }
      }

      console.error("Unhandled approval resolution error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
