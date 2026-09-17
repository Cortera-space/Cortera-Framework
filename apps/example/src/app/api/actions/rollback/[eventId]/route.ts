import { NextRequest } from "next/server";
import {
  dbClient,
  registry,
  resolveActorFromRequest,
} from "@/lib/registry";
import { createRollbackRouteHandler } from "@tera/adapter-next";

const rollbackHandler = createRollbackRouteHandler({
  dbClient,
  registry: registry as any,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
});

export async function POST(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  return rollbackHandler(request, context);
}