import type { z } from "zod";

export type Actor = {
  actorType: "human" | "agent" | "system";
  actorId: string;
};

export type ActionContext = {
  actor: Actor;
  workspaceId: string;
  parentEventId?: string;
  eventId?: string;
};

export function withParent(ctx: ActionContext, parentEventId: string): ActionContext {
  return { ...ctx, parentEventId };
}

export class ActionValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly z.ZodIssue[]
  ) {
    super(message);
    this.name = "ActionValidationError";
  }
}

export interface ActionConfig<TInput extends z.ZodTypeAny> {
  name: string;
  description: string;
  permission: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>, ctx: ActionContext) => Promise<unknown>;
}

export interface ActionResult<T = unknown> {
  result: T;
  eventId: string;
}

export interface DefinedAction<TInput extends z.ZodTypeAny> {
  name: string;
  description: string;
  permission: string;
  input: TInput;
  execute(
    rawInput: unknown,
    ctx: ActionContext,
    dbClient?: DbClient
  ): Promise<ActionResult<unknown>>;
}

export type PermissionResult = "allow" | "deny" | "approval_required";

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

export interface InsertActionEvent {
  actionName: string;
  actorType: Actor["actorType"];
  actorId: string;
  input: unknown;
  output: unknown | null;
  error: unknown | null;
  permissionResult: string;
  approvedBy: string | null;
  parentEventId: string | null;
  startedAt: Date;
  durationMs: number | null;
  workspaceId: string;
}

export interface DbClient {
  insertActionEvent(event: InsertActionEvent): Promise<{ id: string }>;
  updateActionEvent(id: string, event: Partial<InsertActionEvent>): Promise<void>;
}
