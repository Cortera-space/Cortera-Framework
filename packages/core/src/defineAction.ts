import { z } from "zod";
import {
  ActionValidationError,
  ActionPermissionError,
  ActionPendingApprovalError,
  ActionContainmentError,
  type InsertActionEvent,
  type InsertActionApproval,
  type ExecuteOptions,
} from "./types";
import type { ActionConfig, DefinedAction } from "./types";
import { recordEvent, updateEvent } from "./event-log";
import { checkActorContainment, checkBlastRadius } from "./containment";

export function defineAction<TInput extends z.ZodTypeAny>(
  config: ActionConfig<TInput>
): DefinedAction<TInput> {
  if (!config.description || config.description.trim() === "") {
    throw new Error(`Action "${config.name}" must have a non-empty description`);
  }

  if (config.blastRadius === undefined) {
    console.warn(
      `Action "${config.name}" has no blastRadius declared — recommend setting blastRadius to restrict the scope of downstream actions this action may trigger`
    );
  }

  return {
    name: config.name,
    description: config.description,
    permission: config.permission,
    input: config.inputSchema,
    blastRadius: config.blastRadius,
    async execute(
      rawInput,
      ctx,
      dbClient,
      permissionEngine,
      options?: ExecuteOptions
    ) {
      const dryRun = options?.dryRun ?? false;
      const startedAt = new Date();

      if (dbClient) {
        try {
          await checkActorContainment(dbClient, ctx.actor, ctx.workspaceId, dryRun);
        } catch (error) {
          if (error instanceof ActionContainmentError) {
            throw error;
          }
          throw error;
        }

        await checkBlastRadius(dbClient, ctx, this, dryRun);
      }

      const permissionResult = permissionEngine
        ? await permissionEngine.check(
            ctx.actor,
            this,
            rawInput,
            ctx.workspaceId
          )
        : "allow";

      if (permissionResult === "deny") {
        if (dbClient) {
          const insertEvent: InsertActionEvent = {
            actionName: config.name,
            actorType: ctx.actor.actorType,
            actorId: ctx.actor.actorId,
            input: rawInput,
            output: null,
            error: `actor lacks permission: ${config.permission}`,
            permissionResult: "deny",
            approvedBy: null,
            parentEventId: ctx.parentEventId ?? null,
            startedAt,
            durationMs: null,
            workspaceId: ctx.workspaceId,
            blastRadius: config.blastRadius ?? null,
            dryRun,
          };
          await recordEvent(dbClient, insertEvent);
        }

        throw new ActionPermissionError(
          `actor lacks permission: ${config.permission}`,
          config.permission,
          "deny"
        );
      }

      if (permissionResult === "approval_required") {
        if (!dbClient) {
          throw new ActionPendingApprovalError(
            `Action requires approval but no dbClient provided: ${config.name}`,
            config.permission,
            ""
          );
        }

        const insertEvent: InsertActionEvent = {
          actionName: config.name,
          actorType: ctx.actor.actorType,
          actorId: ctx.actor.actorId,
          input: rawInput,
          output: null,
          error: null,
          permissionResult: "approval_required",
          approvedBy: null,
          parentEventId: ctx.parentEventId ?? null,
          startedAt,
          durationMs: null,
          workspaceId: ctx.workspaceId,
          blastRadius: config.blastRadius ?? null,
          dryRun,
        };
        const { id: eventId } = await recordEvent(dbClient, insertEvent);

        const approvalTtlMs = config.approvalTtlMs ?? 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + approvalTtlMs);

        const insertApproval: InsertActionApproval = {
          actionEventId: eventId,
          actionName: config.name,
          input: rawInput,
          actorType: ctx.actor.actorType,
          actorId: ctx.actor.actorId,
          workspaceId: ctx.workspaceId,
          status: "pending",
          requestedAt: new Date(),
          expiresAt,
          resolvedAt: null,
          approvedBy: null,
        };
        const { id: approvalId } = await dbClient.insertActionApproval(insertApproval);

        throw new ActionPendingApprovalError(
          `Action requires approval (id: ${approvalId})`,
          config.permission,
          approvalId
        );
      }

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
            permissionResult: "allow",
            approvedBy: null,
            parentEventId: ctx.parentEventId ?? null,
            startedAt,
            durationMs: null,
            workspaceId: ctx.workspaceId,
            blastRadius: config.blastRadius ?? null,
            dryRun,
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
          permissionResult: "allow",
          approvedBy: null,
          parentEventId: ctx.parentEventId ?? null,
          startedAt,
          durationMs: null,
          workspaceId: ctx.workspaceId,
          blastRadius: config.blastRadius ?? null,
          dryRun,
        };
        const { id } = await recordEvent(dbClient, insertEvent);
        eventId = id;
      }

      if (dryRun) {
        return { wouldSucceed: true as const, eventId };
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