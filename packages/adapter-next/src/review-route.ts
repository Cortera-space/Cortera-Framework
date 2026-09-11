import { NextRequest, NextResponse } from "next/server";
import { DbClient, Actor, reviewContainedActor } from "@tera/core";

export interface ReviewRouteOptions {
  dbClient: DbClient;
  resolveActor: (request: NextRequest) => Promise<Actor | null>;
}

export function createReviewRouteHandler(options: ReviewRouteOptions) {
  const { dbClient, resolveActor } = options;

  return async (
    request: NextRequest,
    context: { params: { actorId: string } }
  ): Promise<NextResponse> => {
    const { actorId } = await context.params;

    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    let body: { decision?: "lift" | "revoke"; workspaceId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const decision = body.decision;
    if (decision !== "lift" && decision !== "revoke") {
      return NextResponse.json(
        { error: "decision must be 'lift' or 'revoke'" },
        { status: 400 }
      );
    }

    const workspaceId = new URL(request.url).searchParams.get("workspaceId") || body.workspaceId;
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required (query param or body)" },
        { status: 400 }
      );
    }

    try {
      const existing = await dbClient.findActorState(actorId, workspaceId);
      if (!existing) {
        return NextResponse.json(
          { error: `Actor state not found: ${actorId} in workspace ${workspaceId}` },
          { status: 404 }
        );
      }
      await reviewContainedActor(dbClient, actorId, workspaceId, decision, actor.actorId);
      return NextResponse.json({ status: "ok" });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("cannot lift actor")) {
          return NextResponse.json(
            { error: error.message },
            { status: 409 }
          );
        }
        if (error.message.includes("not found")) {
          return NextResponse.json(
            { error: error.message },
            { status: 404 }
          );
        }
      }

      console.error("Unhandled review error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
