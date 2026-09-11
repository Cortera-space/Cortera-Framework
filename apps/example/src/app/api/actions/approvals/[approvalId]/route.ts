import { NextRequest } from "next/server";
import {
  dbClient,
  registry,
  resolveActorFromRequest,
  apiKeyMapping,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createApprovalRouteHandler } from "@tera/adapter-next";

const approvalHandler = createApprovalRouteHandler({
  dbClient,
  registry,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { apiKeyMapping }),
  defaultWorkspaceId,
});

export async function POST(
  request: NextRequest,
  context: { params: { approvalId: string } }
) {
  return approvalHandler(request, context);
}
