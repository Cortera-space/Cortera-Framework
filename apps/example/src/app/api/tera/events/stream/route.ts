import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  apiKeyMapping,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createEventStreamRouteHandler } from "@tera/adapter-next";

const eventStreamHandler = createEventStreamRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { apiKeyMapping }),
  defaultWorkspaceId,
});

export async function GET(request: NextRequest) {
  return eventStreamHandler(request);
}