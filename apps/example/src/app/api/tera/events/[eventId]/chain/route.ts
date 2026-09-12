import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  apiKeyMapping,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createEventChainRouteHandler } from "@tera/adapter-next";

const eventChainHandler = createEventChainRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { apiKeyMapping }),
  defaultWorkspaceId,
});

export async function GET(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  return eventChainHandler(request, context);
}