import { restrictedNoteAction } from "./restrictedNote";
import { createNoteAction } from "./createNote";
import { deleteAllCustomersAction } from "./deleteAllCustomers";
import { reviewContainedActor } from "@tera/core";

const ctx = {
  actor: { actorType: "agent" as const, actorId: "demo-agent" },
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
    blastRadius: string[] | null;
  }> = [];

  private actorStates = new Map<string, { actorId: string; workspaceId: string; status: string; containedAt: Date | null; containedReason: string | null; reviewedBy: string | null; reviewedAt: Date | null }>();

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
    blastRadius: string[] | null;
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

  async insertActionApproval(_approval: any): Promise<{ id: string }> { return { id: crypto.randomUUID() }; }
  async updateActionApproval(_id: string, _event: any): Promise<void> {}
  async findPendingApprovals(): Promise<any[]> { return []; }
  async findAllPendingApprovals(): Promise<any[]> { return []; }
  async findApprovalById(_id: string): Promise<any | null> { return null; }

  async findEventById(id: string) {
    const event = this.events.find((e) => e.id === id);
    if (!event) return null;
    return {
      id: event.id,
      actionName: event.actionName,
      parentEventId: event.parentEventId,
      blastRadius: event.blastRadius,
    };
  }

  async findActorState(actorId: string, workspaceId: string) {
    const key = `${actorId}:${workspaceId}`;
    const state = this.actorStates.get(key);
    if (!state) return null;
    return {
      actorId: state.actorId,
      workspaceId: state.workspaceId,
      status: state.status as any,
      containedAt: state.containedAt,
      containedReason: state.containedReason,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedAt,
    };
  }

  async upsertActorState(state: any) {
    const key = `${state.actorId}:${state.workspaceId}`;
    this.actorStates.set(key, {
      actorId: state.actorId,
      workspaceId: state.workspaceId,
      status: state.status,
      containedAt: state.containedAt,
      containedReason: state.containedReason,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedAt,
    });
  }

  getEvents() {
    return this.events;
  }

  getActorStates() {
    return Array.from(this.actorStates.values());
  }
}

async function main() {
  const dbClient = new MockDbClient();

  console.log("=== BLAST RADIUS DEMO ===\n");

  console.log("--- Step 1: Execute root action (restrictedNote, blastRadius: ['notes.*']) ---");
  const noteResult = await restrictedNoteAction.execute(
    { title: "Secret Note", content: "Sensitive data" },
    ctx,
    dbClient
  );
  console.log("restrictedNote executed:", noteResult.result);

  console.log("\n--- Step 2: Child within blast radius (createNote, permission: 'notes.create') ---");
  const safeResult = await createNoteAction.execute(
    { title: "Safe Note", content: "Allowed" },
    { ...ctx, parentEventId: noteResult.eventId },
    dbClient
  );
  console.log("createNote executed:", safeResult.result);

  console.log("\n--- Step 3: Child EXCEEDS blast radius (deleteAllCustomers, permission: 'customers.delete') ---");
  try {
    await deleteAllCustomersAction.execute(
      { reason: "oops" },
      { ...ctx, parentEventId: noteResult.eventId },
      dbClient
    );
    console.log("UNEXPECTED: deleteAllCustomers succeeded");
  } catch (error: any) {
    console.log("deleteAllCustomers DENIED:", error.message);
    console.log("  errorCode:", error.errorCode);
  }

  console.log("\n--- Step 4: Subsequent unrelated call is auto-denied (actor is contained) ---");
  try {
    await createNoteAction.execute(
      { title: "Should Deny", content: "Blocked" },
      ctx,
      dbClient
    );
    console.log("UNEXPECTED: createNote succeeded after containment");
  } catch (error: any) {
    console.log("createNote DENIED:", error.message);
    console.log("  errorCode:", error.errorCode);
  }

  console.log("\n--- Actor States Before Review ---");
  const statesBefore = dbClient.getActorStates();
  for (const state of statesBefore) {
    console.log(`  actor=${state.actorId} workspace=${state.workspaceId} status=${state.status} contained_at=${state.containedAt?.toISOString() ?? "null"} reason=${state.containedReason}`);
  }

  console.log("\n--- Step 5: reviewContainedActor('lift') ---");
  await reviewContainedActor(dbClient, "demo-agent", "demo-workspace", "lift", "human-reviewer");
  console.log("Actor lifted by human-reviewer");

  console.log("\n--- Step 6: Verify operation resumes ---");
  const resumedResult = await createNoteAction.execute(
    { title: "Resumed Note", content: "Back online" },
    ctx,
    dbClient
  );
  console.log("createNote executed after lift:", resumedResult.result);

  console.log("\n--- Actor States After Review ---");
  const statesAfter = dbClient.getActorStates();
  for (const state of statesAfter) {
    console.log(`  actor=${state.actorId} workspace=${state.workspaceId} status=${state.status} contained_at=${state.containedAt?.toISOString() ?? "null"} reviewed_by=${state.reviewedBy} reviewed_at=${state.reviewedAt?.toISOString() ?? "null"}`);
  }

  console.log("\n=== DEMO COMPLETE ===");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
