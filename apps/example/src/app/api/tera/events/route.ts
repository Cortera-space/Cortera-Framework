import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createEventsRouteHandler } from "@tera/adapter-next";

const eventsHandler = createEventsRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
  defaultWorkspaceId,
});

export async function GET(request: NextRequest) {
  return eventsHandler(request);
}