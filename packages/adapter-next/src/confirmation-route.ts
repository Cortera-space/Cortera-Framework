import { NextRequest, NextResponse } from "next/server";
import { DbClient, Actor, DefinedAction, ActionResult } from "@tera/core";
import { confirmIrreversibleConfirmation, rejectIrreversibleConfirmation } from "@tera/core";

export interface ConfirmationRouteOptions {
  dbClient: DbClient;
  registry: {
    get(name: string): DefinedAction<any> | undefined;
  };
}

export function createConfirmationRouteHandler(options: ConfirmationRouteOptions) {
  const { dbClient, registry } = options;

  return async (
    request: NextRequest,
    context: { params: { token: string; action: "confirm" | "reject" } }
  ): Promise<NextResponse> => {
    const { token, action } = await context.params;

    try {
      if (action === "confirm") {
        const result = await confirmIrreversibleConfirmation(token, dbClient, registry);
        return NextResponse.json({ status: "confirmed", result: result.result, eventId: result.eventId });
      } else if (action === "reject") {
        await rejectIrreversibleConfirmation(token, dbClient);
        return NextResponse.json({ status: "rejected" });
      } else {
        return NextResponse.json(
          { error: "Invalid action. Must be 'confirm' or 'reject'" },
          { status: 400 }
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Invalid confirmation token")) {
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
        if (error.message.includes("permission_denied_at_confirmation")) {
          return NextResponse.json(
            { error: error.message },
            { status: 403 }
          );
        }
      }

      console.error("Unhandled confirmation error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}