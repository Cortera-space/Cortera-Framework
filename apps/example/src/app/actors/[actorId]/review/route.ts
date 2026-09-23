import { NextRequest } from "next/server";
import {
  dbClient,
  resolveActorFromRequest,
} from "@/lib/registry";
import { createReviewRouteHandler } from "@cortera/adapter-next";

const reviewHandler = createReviewRouteHandler({
  dbClient,
  resolveActor: (request: NextRequest) => resolveActorFromRequest(request, { dbClient }),
});

export async function POST(
  request: NextRequest,
  _context: { params: { actorId: string } }
) {
  return reviewHandler(request, _context);
}
