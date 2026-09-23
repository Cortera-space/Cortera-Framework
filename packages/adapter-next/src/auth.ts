import type { Actor } from "@cortera/core";
import type { DbClient } from "@cortera/core";
import type { NextRequest } from "next/server";
import { validateApiKey } from "@cortera/auth";

export interface ResolveActorOptions {
  dbClient: DbClient;
}

export async function resolveActorFromRequest(
  request: NextRequest,
  options: ResolveActorOptions
): Promise<Actor | null> {
  const apiKey = request.headers.get("x-cortera-api-key");

  if (apiKey) {
    const validation = await validateApiKey(options.dbClient, apiKey);
    if (validation) {
      return {
        actorId: validation.actorId,
        actorType: "agent",
      };
    }
    return null;
  }

  const sessionCookie = request.cookies.get("cortera-session");
  if (sessionCookie) {
    try {
      const session = JSON.parse(sessionCookie.value) as {
        actorId?: string;
        actorType?: Actor["actorType"];
      };
      if (session.actorId && session.actorType) {
        return {
          actorId: session.actorId,
          actorType: session.actorType,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}