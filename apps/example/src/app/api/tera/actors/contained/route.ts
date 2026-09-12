import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  apiKeyMapping,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createContainedActorsRouteHandler } from "@tera/adapter-next";

const containedActorsHandler = createContainedActorsRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { apiKeyMapping }),
  defaultWorkspaceId,
});

export async function GET(request: NextRequest) {
  return containedActorsHandler(request);
}