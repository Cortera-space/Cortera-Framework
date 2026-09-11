import { NextRequest, NextResponse } from "next/server";
import { Pool, Client } from "pg";

export interface LiveTailHandlerOptions {
  pool: Pool;
}

function matchesFilters(
  event: { [key: string]: unknown },
  filters: { actorId?: string; actionName?: string }
): boolean {
  if (filters.actorId && event.actor_id !== filters.actorId) return false;
  if (filters.actionName && event.action_name !== filters.actionName) return false;
  return true;
}

function encodeSSE(data: string): string {
  return `data: ${data}\n\n`;
}

export function createLiveTailHandler(options: LiveTailHandlerOptions) {
  const { pool } = options;

  return async (
    request: NextRequest,
    _context: { params: Record<string, string> }
  ): Promise<NextResponse> => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    const filters = {
      actorId: url.searchParams.get("actorId") || undefined,
      actionName: url.searchParams.get("actionName") || undefined,
    };

    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        const client = await pool.connect();

        try {
          await client.query("LISTEN action_events");

          controller.enqueue(
            new TextEncoder().encode(encodeSSE(JSON.stringify({ type: "connected" })))
          );

          const handler = (msg: { payload: string }) => {
            try {
              const event = JSON.parse(msg.payload);
              if (event.workspace_id !== workspaceId) return;
              if (!matchesFilters(event, filters)) return;

              controller.enqueue(
                new TextEncoder().encode(encodeSSE(JSON.stringify(event)))
              );
            } catch {
              /* ignore malformed payloads */
            }
          };

          client.on("notification", handler);

          /* Keep the connection alive and the stream open */
          const keepAlive = setInterval(() => {
            try {
              client.query("SELECT 1").catch(() => {});
            } catch {
              /* client may be closed */
            }
          }, 30000);

          request.signal.addEventListener("abort", () => {
            clearInterval(keepAlive);
            client.removeListener("notification", handler);
            client.release();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        } catch (err) {
          controller.error(err instanceof Error ? err.message : "LISTEN failed");
          try {
            client.release();
          } catch {
            /* ignore */
          }
        }
      },
    });

    return new NextResponse(streamBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };
}
