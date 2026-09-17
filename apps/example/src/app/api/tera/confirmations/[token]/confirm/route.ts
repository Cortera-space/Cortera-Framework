import { NextRequest } from "next/server";
import {
  dbClient,
  registry,
} from "@/lib/registry";
import { createConfirmationRouteHandler } from "@tera/adapter-next";

const confirmationHandler = createConfirmationRouteHandler({
  dbClient,
  registry,
});

export async function POST(
  request: NextRequest,
  context: { params: { token: string; action: "confirm" | "reject" } }
) {
  return confirmationHandler(request, context);
}