import { NextRequest, NextResponse } from "next/server";
import { DbClient, Actor } from "@tera/core";

export interface ObservabilityRouteOptions {
  dbClient: DbClient;
  resolveActor: (request: NextRequest) => Promise<Actor | null>;
  defaultWorkspaceId: string;
}

export function createEventsRouteHandler(options: ObservabilityRouteOptions) {
  const { dbClient, resolveActor, defaultWorkspaceId } = options;

  return async (request: NextRequest): Promise<NextResponse> => {
    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || defaultWorkspaceId;

    const filters: Record<string, string | undefined> = {
      actorType: url.searchParams.get("actorType") || undefined,
      actionName: url.searchParams.get("actionName") || undefined,
      permissionResult: url.searchParams.get("permissionResult") || undefined,
      dryRun: url.searchParams.get("dryRun") || undefined,
    };
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const cursor = url.searchParams.get("cursor") || undefined;

    const optionsList: Parameters<DbClient["listEvents"]>[1] = {
      filters: {
        actorType: filters.actorType as Actor["actorType"] | undefined,
        actionName: filters.actionName,
        permissionResult: filters.permissionResult as "allow" | "deny" | "approval_required" | undefined,
        dryRun: filters.dryRun ? filters.dryRun === "true" : undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      limit,
      cursor,
    };

    const result = await dbClient.listEvents(workspaceId, optionsList);
    return NextResponse.json(result);
  };
}

export function createEventChainRouteHandler(options: ObservabilityRouteOptions) {
  const { dbClient, resolveActor } = options;

  return async (
    request: NextRequest,
    context: { params: { eventId: string } }
  ): Promise<NextResponse> => {
    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    const { eventId } = await context.params;
    const url = new URL(request.url);
    const includeDryRun = url.searchParams.get("dryRun") === "true";
    const chain = await dbClient.getEventWithChain(eventId, includeDryRun);

    if (!chain) {
      return NextResponse.json(
        { error: `Event not found: ${eventId}` },
        { status: 404 }
      );
    }

    return NextResponse.json(chain);
  };
}

export function createContainedActorsRouteHandler(options: ObservabilityRouteOptions) {
  const { dbClient, resolveActor, defaultWorkspaceId } = options;

  return async (request: NextRequest): Promise<NextResponse> => {
    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || defaultWorkspaceId;

    const contained = await dbClient.listContainedActors(workspaceId);
    return NextResponse.json({ items: contained });
  };
}

export function createPendingApprovalsRouteHandler(options: ObservabilityRouteOptions) {
  const { dbClient, resolveActor, defaultWorkspaceId } = options;

  return async (request: NextRequest): Promise<NextResponse> => {
    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || defaultWorkspaceId;
    const actionName = url.searchParams.get("actionName") || undefined;

    const result = await dbClient.listPendingApprovals(workspaceId, {
      filters: { actionName },
    });

    return NextResponse.json({ items: result });
  };
}

export function createEventStreamRouteHandler(options: ObservabilityRouteOptions) {
  const { dbClient, resolveActor, defaultWorkspaceId } = options;

  return async (request: NextRequest): Promise<NextResponse> => {
    const actor = await resolveActor(request);
    if (!actor) {
      return NextResponse.json(
        { error: "Unauthorized: no actor identity found" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || defaultWorkspaceId;
    const actorType = url.searchParams.get("actorType") || undefined;
    const actionName = url.searchParams.get("actionName") || undefined;

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const client = await (dbClient as any).pool?.connect();
        if (!client) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "No pool available" })}\n\n`));
          controller.close();
          return;
        }

        try {
          await client.query("LISTEN action_events");

          client.on("notification", (msg: any) => {
            if (closed) return;
            try {
              const payload = JSON.parse(msg.payload);
              if (payload.workspace_id !== workspaceId) return;
              if (actorType && payload.actor_type !== actorType) return;
              if (actionName && payload.action_name !== actionName) return;

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            } catch {
              // Ignore parse errors
            }
          });

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`));

          request.signal?.addEventListener("abort", () => {
            closed = true;
            client.off("notification", () => {});
            client.query("UNLISTEN action_events").catch(() => {});
            client.release();
            controller.close();
          });
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`));
          controller.close();
        }
      },
      cancel() {
        closed = true;
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };
}