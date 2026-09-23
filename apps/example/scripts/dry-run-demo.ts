#!/usr/bin/env tsx
import { registry, dbClient, defaultWorkspaceId } from "../src/lib/registry";
import { withParent } from "@cortera/core";

console.log("=".repeat(60));
console.log("DRY-RUN DEMONSTRATION");
console.log("=".repeat(60));

const actor = { actorType: "human" as const, actorId: "demo-user" };
const ctx = { actor, workspaceId: defaultWorkspaceId };

async function checkActorState(label: string) {
  const state = await dbClient.findActorState(actor.actorId, defaultWorkspaceId);
  console.log(`  Actor state after ${label}:`, state?.status ?? "active (not in DB)");
  return state?.status;
}

async function runDemo() {
  // Scenario 1: Dry run that would succeed
  console.log("\n--- SCENARIO 1: Dry run that WOULD SUCCEED ---");
  console.log("Action: createNote (permission: notes.create)");
  console.log("Input: { title: 'Test Note', content: 'Hello World' }");
  console.log("Expected: { wouldSucceed: true }, handler NOT called");

  const createNote = registry.get("createNote")!;
  const result1 = await createNote.execute(
    { title: "Test Note", content: "Hello World" },
    ctx,
    dbClient,
    undefined,
    { dryRun: true }
  );
  console.log("Result:", JSON.stringify(result1, null, 2));
  await checkActorState("scenario 1");

  // Scenario 2: Dry run that would be denied (permission)
  console.log("\n--- SCENARIO 2: Dry run that WOULD BE DENIED (permission) ---");
  console.log("Action: notifyWatchers (permission: notifications.send)");
  console.log("Input: { noteId: 'note-1', title: 'Test' }");
  console.log("Expected: ActionPermissionError, handler NOT called");

  const notifyWatchers = registry.get("notifyWatchers")!;
  try {
    await notifyWatchers.execute(
      { noteId: "note-1", title: "Test" },
      ctx,
      dbClient,
      undefined,
      { dryRun: true }
    );
  } catch (error: any) {
    console.log("Error:", error.message);
    console.log("Error code:", error.errorCode ?? error.permissionResult);
  }
  await checkActorState("scenario 2");

  // Scenario 3: Dry run that would be contained (blast radius)
  console.log("\n--- SCENARIO 3: Dry run that WOULD BE CONTAINED (blast radius) ---");
  console.log("Action chain: restrictedNote (blastRadius: notes.*) -> deleteAllCustomers (permission: customers.delete)");
  console.log("Expected: ActionContainmentError with 'would be contained', handler NOT called, actor NOT actually contained");

  const restrictedNote = registry.get("restrictedNote")!;
  const deleteAllCustomers = registry.get("deleteAllCustomers")!;

  // First, do a real restrictedNote to establish the chain root
  const parentResult = await restrictedNote.execute(
    { title: "Parent Note", content: "Root of chain" },
    ctx,
    dbClient
  );
  console.log("Parent (restrictedNote) executed successfully, eventId:", parentResult.eventId);

  // Now dry run deleteAllCustomers as a child - this would exceed blast radius
  console.log("\nDry-running deleteAllCustomers as child of restrictedNote...");
  try {
    await deleteAllCustomers.execute(
      { reason: "Dry run test" },
      withParent(ctx, parentResult.eventId),
      dbClient,
      undefined,
      { dryRun: true }
    );
  } catch (error: any) {
    console.log("Error:", error.message);
    console.log("Error code:", error.errorCode);
  }

  await checkActorState("scenario 3 (dry run)");

  // Verify actor is STILL active (not contained)
  const finalState = await dbClient.findActorState(actor.actorId, defaultWorkspaceId);
  if (finalState?.status === "contained") {
    console.log("❌ FAILURE: Actor was actually contained during dry run!");
    process.exit(1);
  } else {
    console.log("✅ SUCCESS: Actor state remains active (not contained) after dry run");
  }

  // Now do a REAL execution that WOULD contain
  console.log("\n--- VERIFICATION: Real execution DOES contain ---");
  try {
    await deleteAllCustomers.execute(
      { reason: "Real execution" },
      withParent(ctx, parentResult.eventId),
      dbClient
    );
  } catch (error: any) {
    console.log("Error:", error.message);
  }
  
  await checkActorState("real execution");
  
  const realState = await dbClient.findActorState(actor.actorId, defaultWorkspaceId);
  if (realState?.status === "contained") {
    console.log("✅ SUCCESS: Real execution properly contained the actor");
  } else {
    console.log("❌ FAILURE: Real execution did not contain actor");
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("ALL DRY-RUN SCENARIOS PASSED ✅");
  console.log("=".repeat(60));
}

runDemo().catch(console.error);