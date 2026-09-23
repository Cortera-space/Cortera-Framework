import { NextRequest } from "next/server";
import {
  dbClient,
  registry,
  resolveActorFromRequest,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createApprovalRouteHandler } from "@cortera/adapter-next";

const approvalHandler = createApprovalRouteHandler({
  dbClient,
  registry: registry as any,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
  defaultWorkspaceId,
});

export async function POST(
  request: NextRequest,
  context: { params: { approvalId: string } }
) {
  return approvalHandler(request, context);
}
