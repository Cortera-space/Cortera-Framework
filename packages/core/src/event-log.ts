import type { DbClient, InsertActionEvent } from "./types";

export async function recordEvent(
  dbClient: DbClient,
  event: InsertActionEvent
): Promise<{ id: string }> {
  return dbClient.insertActionEvent(event);
}

export async function updateEvent(
  dbClient: DbClient,
  id: string,
  event: Partial<InsertActionEvent>
): Promise<void> {
  return dbClient.updateActionEvent(id, event);
}
