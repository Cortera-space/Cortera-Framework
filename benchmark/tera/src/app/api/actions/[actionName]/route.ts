import { NextRequest, NextResponse } from "next/server";
import { registry, dbClient, permissionEngine, defaultWorkspaceId } from "@/lib/registry";
import { createActionHandler } from "@tera/adapter-next";

const actionHandler = createActionHandler({
  registry,
  dbClient,
  permissionEngine,
  resolveActor: async (request: NextRequest) => {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer sk-agent-")) {
      return { actorType: "agent" as const, actorId: authHeader.replace("Bearer ", "").slice(0, 20) };
    }
    return { actorType: "human" as const, actorId: "user-123" };
  },
  defaultWorkspaceId,
});

export async function POST(
  request: NextRequest,
  context: { params: { actionName: string } }
) {
  return actionHandler(request, context);
}

export async function GET(
  _request: NextRequest,
  context: { params: { actionName: string } }
) {
  const action = registry.get(context.params.actionName);
  if (!action) {
    return NextResponse.json(
      { error: `Action not found: ${context.params.actionName}` },
      { status: 404 }
    );
  }
  return NextResponse.json({
    name: action.name,
    description: action.description,
    permission: action.permission,
  });
}