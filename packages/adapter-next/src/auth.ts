import type { Actor } from "@tera/core";

export interface ApiKeyMapping {
  [apiKey: string]: { actorId: string; actorType: Actor["actorType"] };
}

export interface ResolveActorOptions {
  apiKeyMapping: ApiKeyMapping;
}

export async function resolveActorFromRequest(
  request: NextRequest,
  _options: ResolveActorOptions
): Promise<Actor | null> {
  const apiKey = request.headers.get("x-tera-api-key");

  if (apiKey) {
    const mapping = _options.apiKeyMapping[apiKey];
    if (mapping) {
      return {
        actorId: mapping.actorId,
        actorType: mapping.actorType,
      };
    }
    return null;
  }

  const sessionCookie = request.cookies.get("tera-session");
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
