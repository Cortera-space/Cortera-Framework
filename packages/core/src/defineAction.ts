import { z } from "zod";
import type { ActionConfig, Actor } from "./types";

export function defineAction<
  TInput extends z.ZodTypeAny,
  TOutput
>(config: ActionConfig<TInput, TOutput>): ActionConfig<TInput, TOutput> {
  return config;
}
