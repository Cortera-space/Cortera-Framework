import { z } from "zod";
import {
  ActionValidationError,
  type InsertActionEvent,
} from "./types";
import type { ActionConfig, DefinedAction } from "./types";
import { recordEvent, updateEvent } from "./event-log";

export function defineAction<TInput extends z.ZodTypeAny>(
  config: ActionConfig<TInput>
): DefinedAction<TInput> {
  if (!config.description || config.description.trim() === "") {
    throw new Error(`Action "${config.name}" must have a non-empty description`);
  }

  return {
    name: config.name,
    description: config.description,
    permission: config.permission,
    input: config.inputSchema,
    async execute(rawInput, ctx, dbClient) {
      const startedAt = new Date();

      const result = config.inputSchema.safeParse(rawInput);
      if (!result.success) {
        const errorPayload = {
          issues: result.error.issues,
          message: `Invalid input for action "${config.name}"`,
        };

        if (dbClient) {
          const insertEvent: InsertActionEvent = {
            actionName: config.name,
            actorType: ctx.actor.actorType,
            actorId: ctx.actor.actorId,
            input: rawInput,
            output: null,
            error: errorPayload,
            permissionResult: "allowed",
            approvedBy: null,
            parentEventId: ctx.parentEventId ?? null,
            startedAt,
            durationMs: null,
            workspaceId: ctx.workspaceId,
          };
          await recordEvent(dbClient, insertEvent);
        }

        throw new ActionValidationError(
          `Invalid input for action "${config.name}"`,
          result.error.issues
        );
      }

      let eventId: string | undefined;

      if (dbClient) {
        const insertEvent: InsertActionEvent = {
          actionName: config.name,
          actorType: ctx.actor.actorType,
          actorId: ctx.actor.actorId,
          input: result.data,
          output: null,
          error: null,
          permissionResult: "allowed",
          approvedBy: null,
          parentEventId: ctx.parentEventId ?? null,
          startedAt,
          durationMs: null,
          workspaceId: ctx.workspaceId,
        };
        const { id } = await recordEvent(dbClient, insertEvent);
        eventId = id;
      }

      try {
        const handlerResult = await config.handler(result.data, {
          ...ctx,
          eventId,
        });

        if (dbClient && eventId) {
          const endAt = new Date();
          const durationMs = endAt.getTime() - startedAt.getTime();
          await updateEvent(dbClient, eventId, {
            output: handlerResult,
            durationMs,
          });
        }

        return { result: handlerResult, eventId: eventId ?? "" };
      } catch (error) {
        if (dbClient && eventId) {
          const endAt = new Date();
          const durationMs = endAt.getTime() - startedAt.getTime();
          await updateEvent(dbClient, eventId, {
            output: null,
            error: {
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
            durationMs,
          });
        }

        throw error;
      }
    },
  };
}
