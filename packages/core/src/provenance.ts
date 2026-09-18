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

export function hasUntrustedInput(
  inputProvenance: Map<string, ProvenanceLabel>
): boolean {
  for (const label of inputProvenance.values()) {
    if (label === "untrusted-external") {
      return true;
    }
  }
  return false;
}

export async function getUntrustedSourceInfo(
  dbClient: DbClient | undefined,
  inputProvenance: Map<string, ProvenanceLabel>
): Promise<string | null> {
  if (!dbClient) return null;

  // Find the first untrusted field and trace its source
  for (const [fieldPath, label] of inputProvenance.entries()) {
    if (label === "untrusted-external") {
      // This would require traversing the provenance chain to find the original source
      // For now, we return a generic description
      return `input field "${fieldPath}" traces to untrusted-external source`;
    }
  }
  return null;
}