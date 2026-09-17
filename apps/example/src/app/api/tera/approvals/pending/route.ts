import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createPendingApprovalsRouteHandler } from "@tera/adapter-next";

const pendingApprovalsHandler = createPendingApprovalsRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
  defaultWorkspaceId,
});

export async function GET(request: NextRequest) {
  return pendingApprovalsHandler(request);
}