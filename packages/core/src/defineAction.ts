import { z } from "zod";
import {
  ActionValidationError,
  ActionPermissionError,
  ActionPendingApprovalError,
  ActionContainmentError,
  type InsertActionEvent,
  type InsertActionApproval,
  type RiskTier,
  type RiskMode,
  type DelayedExecutionResult,
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
    riskTier: config.riskTier,
    delayWindowMs: config.delayWindowMs,
    async execute(
      rawInput: unknown,
      ctx: ActionContext,
      dbClient?: DbClient,
      permissionEngine?: PermissionEngine,
      riskMode: RiskMode = "guarded"
    ): Promise<ActionResult<unknown> | DelayedExecutionResult> {
      const startedAt = new Date();

      // Early exit for autonomous mode - skip all tiering
      if (riskMode === "autonomous") {
        return executeImmediate(
          rawInput,
          ctx,
          dbClient,
          permissionEngine,
          config,
          startedAt
        );
      }

      // Guarded mode - apply tiering
      const riskTier = config.riskTier ?? "instant";

      if (riskTier === "instant") {
        return executeImmediate(
          rawInput,
          ctx,
          dbClient,
          permissionEngine,
          config,
          startedAt
        );
      }

      if (riskTier === "delayed") {
        return executeDelayed(
          rawInput,
          ctx,
          dbClient,
          permissionEngine,
          config,
          startedAt
        );
      }

      if (riskTier === "irreversible") {
        return executeIrreversible(
          rawInput,
          ctx,
          dbClient,
          permissionEngine,
          config,
          startedAt
        );
      }

      // Fallback - should never reach here
      return executeImmediate(
        rawInput,
        ctx,
        dbClient,
        permissionEngine,
        config,
        startedAt
      );
    },
  };
}
