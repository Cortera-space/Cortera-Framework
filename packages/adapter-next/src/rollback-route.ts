import { NextRequest, NextResponse } from "next/server";
import { DbClient, Actor, rollbackAction, ActionRollbackError } from "@tera/core";
import { resolveActorFromRequest, type ApiKeyMapping } from "@tera/adapter-next";

export interface RollbackRouteOptions {
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
}

export function createRollbackRouteHandler(options: RollbackRouteOptions) {
  const { dbClient, registry, resolveActor } = options;

  return async (
    request: NextRequest,
    context: { params: { eventId: string } }
  ): Promise<NextResponse> => {
    const { eventId } = await context.params;

    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    try {
      const result = await rollbackAction(eventId, actor.actorId, dbClient, registry);
      return NextResponse.json({ status: "ok", result: result.result, rollbackEventId: result.eventId });
    } catch (error) {
      if (error instanceof ActionRollbackError) {
        if (error.message.includes("does not have a rollback function")) {
          return NextResponse.json(
            { error: error.message },
            { status: 400 }
          );
        }
        if (error.message.includes("not found")) {
          return NextResponse.json(
            { error: error.message },
            { status: 404 }
          );
        }
        if (error.message.includes("not executed successfully")) {
          return NextResponse.json(
            { error: error.message },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }

      console.error("Unhandled rollback error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}