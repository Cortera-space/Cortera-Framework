import { z } from "zod";
import {
  defineAction,
  InMemoryDbClient,
  reviewContainedActor,
  getActorState,
  DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
  type ActionContext,
} from "@tera/core";

const db = new InMemoryDbClient();
const workspaceId = "ws-1";
const actorId = "test-agent";
const ctx: ActionContext = { actor: { actorType: "agent", actorId }, workspaceId };

const notesCreate = defineAction({
  name: "notes.create",
  description: "Create a note",
  permission: "notes.create",
  inputSchema: z.object({ title: z.string() }),
  handler: async (input) => ({ id: `note-${Date.now()}`, ...input }),
  behavioralDriftConfig: {
    ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
    baselineWindowDays: 1,
    recentWindowHours: 6,
    minCallsForBaseline: 10,
  },
});

const customersDelete = defineAction({
  name: "customers.delete",
  description: "Delete a customer",
  permission: "customers.delete",
  inputSchema: z.object({ id: z.string() }),
  handler: async (input) => ({ deleted: true, id: input.id }),
  behavioralDriftConfig: {
    ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
    baselineWindowDays: 1,
    recentWindowHours: 6,
    minCallsForBaseline: 10,
  },
});

async function runDemo() {
  console.log("=== Behavioral Drift Detection Demo ===\n");

  console.log("Phase 1: Establishing normal baseline (notes.create only)");
  const now = new Date();
  for (let hour = 8; hour <= 20; hour++) {
    for (let i = 0; i < 2; i++) {
      await db.insertActionEvent({
        actionName: "notes.create",
        actorType: "agent",
        actorId,
        input: { title: `Note ${hour}-${i}` },
        output: { id: `note-${hour}-${i}` },
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(now.getTime() - hour * 3600000),
        durationMs: 10,
        workspaceId,
        blastRadius: null,
      });
    }
  }
  console.log(`  Inserted 26 baseline events (notes.create at hours 8-20 ago)\n`);

  console.log("Phase 2: Normal operation - notes.create continues to work");
  const result1 = await notesCreate.execute({ title: "Normal note" }, ctx, db);
  console.log(`  Result: ${JSON.stringify(result1.result)}\n`);

  console.log("Phase 3: Scope widening attempt - customers.delete (new action type)");
  try {
    await customersDelete.execute({ id: "cust-1" }, ctx, db);
    console.log("  ERROR: Should have been contained!");
  } catch (error: any) {
    console.log(`  Contained! Error: ${error.message}`);
    console.log(`  Error code: ${error.errorCode}\n`);
  }

  console.log("Phase 4: Check actor state after containment");
  const state1 = await getActorState(db, ctx.actor, workspaceId);
  console.log(`  Status: ${state1?.status}`);
  console.log(`  Containment reason: ${state1?.containmentReason}`);
  console.log(`  Contained reason: ${state1?.containedReason}\n`);

  console.log("Phase 5: Subsequent calls from contained actor are blocked");
  try {
    await notesCreate.execute({ title: "Should be blocked" }, ctx, db);
    console.log("  ERROR: Should have been blocked!");
  } catch (error: any) {
    console.log(`  Blocked! Error: ${error.message}\n`);
  }

  console.log("Phase 6: Review and lift containment");
  await reviewContainedActor(db, actorId, workspaceId, "lift", "admin-reviewer");
  const state2 = await getActorState(db, ctx.actor, workspaceId);
  console.log(`  Status after lift: ${state2?.status}`);
  console.log(`  Containment reason: ${state2?.containmentReason}\n`);

  console.log("Phase 7: Normal operation restored");
  const result2 = await notesCreate.execute({ title: "After lift" }, ctx, db);
  console.log(`  Result: ${JSON.stringify(result2.result)}\n`);

  console.log("=== Demo Complete ===");
}

runDemo().catch(console.error);