import { z } from "zod";
import { ActionValidationError } from "./types";
import type { ActionConfig, ActionContext, DefinedAction } from "./types";

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
    async execute(rawInput, ctx) {
      const result = config.inputSchema.safeParse(rawInput);
      if (!result.success) {
        throw new ActionValidationError(
          `Invalid input for action "${config.name}"`,
          result.error.issues
        );
      }
      return config.handler(result.data, ctx);
    },
  };
}
