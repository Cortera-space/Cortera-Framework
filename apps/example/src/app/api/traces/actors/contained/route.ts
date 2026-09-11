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

  const actors = await dbClient.listContainedActors(workspaceId);
  return NextResponse.json({ actors });
}
