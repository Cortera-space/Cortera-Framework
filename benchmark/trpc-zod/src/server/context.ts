import { createTRPCContext } from "@trpc/next";
import type { Context } from "./router";

export const createContext = async (opts: { req: Request }): Promise<Context> => {
  const authHeader = opts.req.headers.get("authorization");
  const actor = authHeader?.startsWith("Bearer sk-agent-")
    ? { actorType: "agent" as const, actorId: authHeader.replace("Bearer ", "").slice(0, 20) }
    : { actorType: "human" as const, actorId: "user-123" };

  return { actor };
};

export const { TRPCProvider, useContext } = createTRPCContext<Context>({
  createContext,
  transformer: undefined,
});