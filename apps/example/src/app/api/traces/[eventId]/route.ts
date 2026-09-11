import { NextRequest, NextResponse } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  apiKeyMapping,
} from "@/lib/registry";

export async function GET(
  _request: NextRequest,
  context: { params: { eventId: string } }
) {
  const actor = await resolveActorFromRequest(_request, { apiKeyMapping });
  if (!actor) {
    return NextResponse.json(
      { error: "Unauthorized: no actor identity found" },
      { status: 401 }
    );
  }

  const workspaceId = _request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }

  const chain = await dbClient.getEventWithChain(context.params.eventId);
  if (!chain) {
    return NextResponse.json(
      { error: "Event not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(chain);
}
