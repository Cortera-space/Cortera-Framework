import { NextRequest, NextResponse } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  apiKeyMapping,
} from "@/lib/registry";

export async function GET(request: NextRequest) {
  const actor = await resolveActorFromRequest(request, { apiKeyMapping });
  if (!actor) {
    return NextResponse.json(
      { error: "Unauthorized: no actor identity found" },
      { status: 401 }
    );
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }

  const actorType = request.nextUrl.searchParams.get("actorType") || undefined;
  const actionName = request.nextUrl.searchParams.get("actionName") || undefined;
  const permissionResult = request.nextUrl.searchParams.get("permissionResult") as
    | "allow"
    | "deny"
    | "approval_required"
    | undefined;
  const from = request.nextUrl.searchParams.get("from")
    ? new Date(request.nextUrl.searchParams.get("from")!)
    : undefined;
  const to = request.nextUrl.searchParams.get("to")
    ? new Date(request.nextUrl.searchParams.get("to")!)
    : undefined;
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "20", 10);
  const cursorStartedAt = request.nextUrl.searchParams.get("cursorStartedAt");
  const cursorId = request.nextUrl.searchParams.get("cursorId");

  const filters: {
    actorType?: "human" | "agent" | "system";
    actionName?: string;
    permissionResult?: "allow" | "deny" | "approval_required";
    from?: Date;
    to?: Date;
  } = {};
  if (actorType) filters.actorType = actorType as "human" | "agent" | "system";
  if (actionName) filters.actionName = actionName;
  if (permissionResult) filters.permissionResult = permissionResult;
  if (from) filters.from = from;
  if (to) filters.to = to;

  const cursor = cursorStartedAt && cursorId ? { startedAt: new Date(cursorStartedAt), id: cursorId } : undefined;

  const result = await dbClient.listEvents(workspaceId, filters, limit, cursor);
  return NextResponse.json(result);
}
