import { NextRequest } from "next/server";
import {
  dbClient,
  registry,
  resolveActorFromRequest,
  apiKeyMapping,
} from "@/lib/registry";
import { createRollbackRouteHandler } from "@tera/adapter-next";

const rollbackHandler = createRollbackRouteHandler({
  dbClient,
  registry,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { apiKeyMapping }),
});

export async function POST(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  return rollbackHandler(request, context);
}