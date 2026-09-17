import { createHash } from "crypto";
import type { DbClient, ActionContext, InsertDataProvenance, DataProvenance, TrustLabel, ProvenanceSourceType } from "./types";

export function computeContentHash(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value as object).sort());
  return createHash("sha256").update(json).digest("hex");
}

export function resolveFieldProvenance(
  rawInput: Record<string, unknown>,
  ctx: ActionContext
): Record<string, TrustLabel> {
  const explicitProvenance = ctx.inputProvenance ?? {};
  const isHumanOrigin = ctx.actor.actorType === "human";
  const defaultLabel: TrustLabel = isHumanOrigin ? "trusted" : "untrusted-external";

  const result: Record<string, TrustLabel> = {};
  for (const key of Object.keys(rawInput)) {
    if (key in explicitProvenance) {
      result[key] = explicitProvenance[key];
    } else {
      result[key] = defaultLabel;
    }
  }
  return result;
}

export async function recordProvenance(
  dbClient: DbClient | undefined,
  rawInput: Record<string, unknown>,
  fieldProvenance: Record<string, TrustLabel>,
  workspaceId: string,
  sourceType: ProvenanceSourceType,
  sourceIdentifier: string | null
): Promise<string[]> {
  if (!dbClient) return [];

  const provenanceIds: string[] = [];

  for (const [fieldName, trustLabel] of Object.entries(fieldProvenance)) {
    const fieldValue = rawInput[fieldName];
    const contentHash = computeContentHash({ field: fieldName, value: fieldValue });

    const insertProvenance: InsertDataProvenance = {
      contentHash,
      trustLabel,
      sourceType,
      sourceIdentifier,
      workspaceId,
    };

    const { id } = await dbClient.insertDataProvenance(insertProvenance);
    provenanceIds.push(id);
  }

  return provenanceIds;
}

export function getSourceInfo(ctx: ActionContext): { sourceType: ProvenanceSourceType; sourceIdentifier: string | null } {
  if (ctx.actor.actorType === "human") {
    return { sourceType: "human_message", sourceIdentifier: ctx.actor.actorId };
  }
  if (ctx.parentEventId) {
    return { sourceType: "tool_output", sourceIdentifier: ctx.parentEventId };
  }
  return { sourceType: "api_response", sourceIdentifier: ctx.actor.actorId };
}