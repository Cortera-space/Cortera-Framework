import type { z } from "zod";

export type Actor = {
  actorType: "human" | "agent" | "system";
  actorId: string;
};

export type PermissionResult = "allow" | "deny" | "approval_required";

export interface ActionConfig<TInput extends z.ZodTypeAny, TOutput> {
  name: string;
  description: string;
  inputSchema: TInput;
  permission: string;
  handler: (input: z.infer<TInput>, actor: Actor) => Promise<TOutput>;
  approvalTtlMs?: number;
}

export interface ActionEvent<TInput = unknown, TOutput = unknown> {
  eventId: string;
  actionName: string;
  actorType: Actor["actorType"];
  actorId: string;
  permissionResult: PermissionResult;
  status: string;
  input: TInput;
  output: TOutput | null;
  error: string | null;
  parentEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
