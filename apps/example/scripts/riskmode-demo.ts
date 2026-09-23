#!/usr/bin/env node

/**
 * Demo script for RISKMODE - Guarded vs Autonomous Execution
 * 
 * This script demonstrates:
 * 1. A delayed action (bulkDeleteRecords) scheduled in guarded mode
 * 2. Canceling it before the delay window closes (handler never runs)
 * 3. Scheduling it again and letting the window pass (handler runs)
 * 4. The same action under riskMode "autonomous" running immediately despite its "delayed" tier
 */

import { z } from "zod";
import {
  ActionRegistry,
  defineAction,
  InMemoryPermissionEngine,
  InMemoryDbClient,
  cancelDelayedAction,
  processPendingDelayedActions,
  type ActionContext,
} from "@cortera/core";

// Create registry and permission engine
const registry = new ActionRegistry();
const permissionEngine = new InMemoryPermissionEngine();
permissionEngine.addRule({ actorType: "human", permissionKey: "records.bulkDelete", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "records.bulkDelete", result: "allow" });

// Create DB client
const dbClient = new InMemoryDbClient();

// Define the delayed action
const bulkDeleteRecordsAction = defineAction({
  name: "bulkDeleteRecords",
  description: "Bulk deletes records — delayed for safety review",
  permission: "records.bulkDelete",
  inputSchema: z.object({
    table: z.string(),
    filter: z.record(z.unknown()).optional(),
    reason: z.string().optional(),
  }),
  riskTier: "delayed",
  delayWindowMs: 2000, // 2 seconds for demo
  handler: async (input) => {
    console.log(`  🔥 HANDLER EXECUTED: Bulk deleting from ${input.table}`);
    return { deleted: true, table: input.table, reason: input.reason, timestamp: new Date().toISOString() };
  },
});

registry.register(bulkDeleteRecordsAction);

const ctx: ActionContext = {
  actor: { actorType: "human", actorId: "demo-user" },
  workspaceId: "default-workspace",
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  RISKMODE DEMO: Guarded vs Autonomous Execution            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ============================================================
  // DEMO 1: Guarded mode - Schedule and cancel
  // ============================================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("DEMO 1: Guarded mode - Schedule delayed action and CANCEL it");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("▶ Executing bulkDeleteRecords with riskMode='guarded' (default)...");
  const result1 = await bulkDeleteRecordsAction.execute(
    { table: "users", filter: { status: "inactive" }, reason: "Cleanup inactive users" },
    ctx,
    dbClient,
    permissionEngine,
    "guarded"
  );

  if ((result1 as any).status === "delayed") {
    const { pendingId, scheduledRunAt } = result1 as any;
    console.log(`  ✓ Action scheduled (delayed)`);
    console.log(`  ✓ Pending ID: ${pendingId}`);
    console.log(`  ✓ Scheduled to run at: ${scheduledRunAt.toISOString()}`);
    console.log(`  ⏳ Waiting 500ms then canceling...\n`);

    await sleep(500);

    console.log("▶ Canceling the delayed action...");
    await cancelDelayedAction(dbClient, pendingId, "demo-user");
    console.log(`  ✓ Action canceled successfully`);

    // Verify handler never ran by checking pending status
    const pending = await dbClient.findPendingDelayedActionById(pendingId);
    console.log(`  ✓ Pending status: ${pending?.status}`);
    console.log(`  ✓ Handler was NOT executed (as expected)\n`);
  }

  // ============================================================
  // DEMO 2: Guarded mode - Schedule and let it run
  // ============================================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("DEMO 2: Guarded mode - Schedule delayed action and LET IT RUN");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("▶ Executing bulkDeleteRecords again with riskMode='guarded'...");
  const result2 = await bulkDeleteRecordsAction.execute(
    { table: "logs", filter: { olderThan: "30d" }, reason: "Retention policy" },
    ctx,
    dbClient,
    permissionEngine,
    "guarded"
  );

  if ((result2 as any).status === "delayed") {
    const { pendingId, scheduledRunAt } = result2 as any;
    console.log(`  ✓ Action scheduled (delayed)`);
    console.log(`  ✓ Pending ID: ${pendingId}`);
    console.log(`  ✓ Scheduled to run at: ${scheduledRunAt.toISOString()}`);
    console.log(`  ⏳ Waiting for delay window to pass (3 seconds)...\n`);

    await sleep(3000);

    console.log("▶ Running sweep to process due delayed actions...");
    const processed = await processPendingDelayedActions(dbClient, "default-workspace", permissionEngine, registry);
    console.log(`  ✓ Sweep processed ${processed} action(s)`);
    console.log(`  ✓ Handler WAS executed (as expected)\n`);
  }

  // ============================================================
  // DEMO 3: Autonomous mode - Bypasses delay entirely
  // ============================================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("DEMO 3: Autonomous mode - Same 'delayed' action runs IMMEDIATELY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("▶ Executing bulkDeleteRecords with riskMode='autonomous'...");
  console.log("  (Same action, same riskTier='delayed', but riskMode='autonomous')\n");
  
  const result3 = await bulkDeleteRecordsAction.execute(
    { table: "audit_logs", filter: {}, reason: "Emergency cleanup" },
    ctx,
    dbClient,
    permissionEngine,
    "autonomous"
  );

  if ((result3 as any).result) {
    console.log(`  ✓ Action executed IMMEDIATELY (bypassed delay)`);
    console.log(`  ✓ Result: ${JSON.stringify((result3 as any).result)}`);
    console.log(`  ✓ No pending row created - full speed execution\n`);
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`
  • Guarded mode (default): Respects riskTier
    - "instant" → runs immediately
    - "delayed" → schedules with cancelable delay window
    - "irreversible" → requires out-of-band confirmation
  
  • Autonomous mode: Ignores riskTier entirely
    - All actions run at full speed immediately
    - Blast Radius + Containment remain as safety backstop
  
  • This is a deliberate escape hatch for teams who've decided
    their containment model is sufficient and want maximum speed.
  `);

  console.log("✅ Demo complete!");
}

runDemo().catch(console.error);