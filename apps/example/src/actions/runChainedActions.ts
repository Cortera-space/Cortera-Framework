import { createNoteAction } from "./createNote";
import { notifyWatchersAction } from "./notifyWatchers";

const ctx = {
  actor: { actorType: "human" as const, actorId: "demo-user" },
  workspaceId: "demo-workspace",
};

class MockDbClient {
  private events: Array<{
    id: string;
    actionName: string;
    actorType: string;
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
  }> = [];

  async insertActionEvent(event: {
    actionName: string;
    actorType: string;
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
  }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    this.events.push({ ...event, id });
    return { id };
  }

  async updateActionEvent(id: string, event: Partial<{
    output: unknown;
    error: unknown;
    durationMs: number | null;
  }>): Promise<void> {
    const existing = this.events.find((e) => e.id === id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  getEvents() {
    return this.events;
  }
}

async function main() {
  const dbClient = new MockDbClient();

  try {
    const createResult = await createNoteAction.execute(
      { title: "Hello Tera", content: "First note" },
      ctx,
      dbClient
    );
    console.log("createNote executed:", createResult.result);

    const notifyResult = await notifyWatchersAction.execute(
      { noteId: (createResult.result as { id: string }).id, title: "Hello Tera" },
      { ...ctx, parentEventId: createResult.eventId },
      dbClient
    );
    console.log("notifyWatchers executed:", notifyResult.result);

    console.log("\n--- Action Events ---");
    const events = dbClient.getEvents();
    for (const event of events) {
      console.log(JSON.stringify(event, null, 2));
    }

    console.log("\n--- Linked Event Query (simulated) ---");
    const parent = events.find((e) => e.actionName === "createNote");
    const children = events.filter((e) => e.parentEventId === parent?.id);
    console.log(`Parent event: ${parent?.id} (${parent?.actionName})`);
    console.log(`Child events: ${children.map((c) => `${c.id} (${c.actionName})`).join(", ")}`);
  } catch (error) {
    console.error("Action failed:", error);
    process.exit(1);
  }
}

main();
