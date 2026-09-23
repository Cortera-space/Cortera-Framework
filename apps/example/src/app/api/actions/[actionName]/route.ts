import { NextRequest, NextResponse } from "next/server";
import {
  registry,
  dbClient,
  permissionEngine,
  resolveActorFromRequest,
  defaultWorkspaceId,
} from "@/lib/registry";
import { createActionHandler } from "@cortera/adapter-next";

const actionHandler = createActionHandler({
  registry,
  dbClient,
  permissionEngine,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
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
