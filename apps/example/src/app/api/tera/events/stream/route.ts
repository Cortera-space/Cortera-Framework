import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createEventStreamRouteHandler } from "@tera/adapter-next";

const eventStreamHandler = createEventStreamRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
  defaultWorkspaceId,
});

export async function GET(request: NextRequest) {
  return eventStreamHandler(request);
}