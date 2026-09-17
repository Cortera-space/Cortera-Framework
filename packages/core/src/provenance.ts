import type { ProvenanceLabel } from "./types";
import type { DbClient } from "./types";

export function computeOutputProvenance(
  inputProvenance: Map<string, ProvenanceLabel>,
  sanitizes: boolean
): ProvenanceLabel {
  if (sanitizes === true) {
    return "trusted";
  }

  for (const label of inputProvenance.values()) {
    if (label === "untrusted-external") {
      return "untrusted-external";
    }
  }

  return "trusted";
}

export async function resolveInputProvenance(
  dbClient: DbClient | undefined,
  parentEventId: string | undefined,
  input: Record<string, unknown>
): Promise<Map<string, ProvenanceLabel>> {
  const provenance = new Map<string, ProvenanceLabel>();

  if (!dbClient || !parentEventId) {
    for (const key of Object.keys(input)) {
      provenance.set(key, "trusted");
    }
    return provenance;
  }

  const parentProvenance = await dbClient.findDataProvenanceByEventId(parentEventId);
  const parentOutputProvenance = parentProvenance.find((p) => p.fieldPath === "output");

  if (parentOutputProvenance) {
    for (const key of Object.keys(input)) {
      provenance.set(key, parentOutputProvenance.label);
    }
  } else {
    for (const key of Object.keys(input)) {
      provenance.set(key, "trusted");
    }
  }

  return provenance;
}

export async function recordOutputProvenance(
  dbClient: DbClient | undefined,
  eventId: string,
  label: ProvenanceLabel,
  sourceEventId: string | null
): Promise<void> {
  if (!dbClient) return;

  await dbClient.insertDataProvenance({
    eventId,
    fieldPath: "output",
    label,
    sourceEventId,
  });
}