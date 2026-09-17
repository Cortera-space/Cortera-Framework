import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createEventChainRouteHandler } from "@tera/adapter-next";

const eventChainHandler = createEventChainRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
  defaultWorkspaceId,
});

export async function GET(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  return eventChainHandler(request, context);
}