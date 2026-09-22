import { createNoteAction } from "./createNote";
import { notifyWatchersAction } from "./notifyWatchers";
import { type ListEventsOptions, type PaginatedResult, type ActionEvent, type ActionEventWithChain, type ContainedActor, type PendingApprovalWithEvent, type ListPendingApprovalsOptions } from "@cortera/core";

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

  async insertActionApproval(_approval: any): Promise<{ id: string }> { return { id: crypto.randomUUID() }; }
  async updateActionApproval(_id: string, _event: any): Promise<void> {}
  async findPendingApprovals(): Promise<any[]> { return []; }
  async findAllPendingApprovals(): Promise<any[]> { return []; }
  async findApprovalById(_id: string): Promise<any | null> { return null; }
  async findEventById(_id: string): Promise<any | null> { return null; }
  async findActorState(_actorId: string, _workspaceId: string): Promise<any | null> { return null; }
  async upsertActorState(_state: any): Promise<void> {}

  // Observability methods - not implemented for demo
  async listEvents(_workspaceId: string, _options?: ListEventsOptions): Promise<PaginatedResult<ActionEvent>> {
    return { items: [], nextCursor: null };
  }
  async getEventWithChain(_eventId: string): Promise<ActionEventWithChain | null> { return null; }
  async listContainedActors(_workspaceId: string): Promise<ContainedActor[]> { return []; }
  async listPendingApprovals(_workspaceId: string, _options?: ListPendingApprovalsOptions): Promise<PendingApprovalWithEvent[]> { return []; }
}

async function main() {
  const dbClient = new MockDbClient();

  try {
    const createResult = await createNoteAction.execute(
      { title: "Hello Cortera Framework", content: "First note" },
      ctx,
      dbClient as any
    ) as { result: any; eventId: string };
    console.log("createNote executed:", createResult.result);

    const notifyResult = await notifyWatchersAction.execute(
      { noteId: (createResult.result as { id: string }).id, title: "Hello Cortera Framework" },
      { ...ctx, parentEventId: createResult.eventId },
      dbClient as any
    ) as { result: any; eventId: string };
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
