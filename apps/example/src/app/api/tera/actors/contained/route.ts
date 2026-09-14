import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createContainedActorsRouteHandler } from "@tera/adapter-next";

const containedActorsHandler = createContainedActorsRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
  defaultWorkspaceId,
});

export async function GET(request: NextRequest) {
  return containedActorsHandler(request);
}