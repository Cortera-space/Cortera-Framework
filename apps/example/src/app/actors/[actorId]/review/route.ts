import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
  apiKeyMapping,
} from "@/lib/registry";
import { createReviewRouteHandler } from "@tera/adapter-next";

const reviewHandler = createReviewRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { apiKeyMapping }),
});

export async function POST(
  request: NextRequest,
  _context: { params: { actorId: string } }
) {
  return reviewHandler(request, _context);
}
