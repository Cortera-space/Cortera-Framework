import { z } from "zod";
import {
  defineAction,
  InMemoryDbClient,
  InMemoryPermissionEngine,
  type ActionContext,
  type DefinedAction,
} from "@tera/core";

const mockContactResolver = {
  getContact: () => Promise.resolve({
    channel: "email" as const,
    destination: "admin@example.com",
  }),
};

const ctx: ActionContext = {
  actor: { actorType: "agent" as const, actorId: "demo-agent" },
  workspaceId: "demo-workspace",
};

const createAction = (name: string, riskTier: "instant" | "delayed" | "irreversible" = "instant", sanitizes = false): DefinedAction<any, any> =>
  defineAction({
    name,
    description: `Demo action ${name}`,
    permission: "demo.execute",
    inputSchema: z.object({ data: z.string() }),
    riskTier,
    sanitizes,
    handler: async (input) => ({
      processed: `${name} processed: ${input.data}`,
    }),
  });

async function runDemo(name: string, fn: () => Promise<void>) {
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
    console.log("SUCCESS");
  } catch (error: any) {
    if (error.name === "ActionPendingIrreversibleConfirmationError") {
      console.log("BLOCKED - Confirmation required:");
      console.log(`  Confirmation ID: ${error.confirmationId}`);
      console.log(`  Message: ${error.message}`);
    } else {
      console.log(`ERROR: ${error.message}`);
    }
  }
}

async function main() {
  (globalThis as any).__TERA_CONTACT_RESOLVER__ = mockContactResolver;

  const db = new InMemoryDbClient();
  const permissionEngine = new InMemoryPermissionEngine();
  permissionEngine.addRule({ actorType: "agent", permissionKey: "demo.execute", result: "allow" });

  // Simulate an untrusted tool output source
  const TOOL_OUTPUT_EVENT_ID = "external-web-fetch-result";
  await db.insertDataProvenance({
    eventId: TOOL_OUTPUT_EVENT_ID,
    fieldPath: "output",
    label: "untrusted-external",
    sourceEventId: null,
  });
  console.log(`Created untrusted tool output source: ${TOOL_OUTPUT_EVENT_ID} (web_fetch)`);

  // Demo 1: Instant action with trusted input - should execute immediately
  await runDemo("DEMO 1: Instant action with trusted input (no parent)", async () => {
    const action = createAction("trustedInstant", "instant");
    await action.execute({ data: "hello from human" }, ctx, db, permissionEngine);
    console.log("  Executed immediately as expected");
  });

  // Demo 2: Instant action with untrusted input in guarded mode - should be blocked
  await runDemo("DEMO 2: Instant action with untrusted input (guarded mode)", async () => {
    const action = createAction("blockedInstant", "instant");
    const childCtx = { ...ctx, parentEventId: TOOL_OUTPUT_EVENT_ID };
    await action.execute({ data: "from untrusted web fetch" }, childCtx, db, permissionEngine);
  });

  // Demo 3: Same action but in autonomous mode - should execute immediately
  await runDemo("DEMO 3: Same untrusted input but autonomous mode", async () => {
    const action = createAction("autonomousUntrusted", "instant");
    const childCtx = { ...ctx, parentEventId: TOOL_OUTPUT_EVENT_ID };
    await action.execute({ data: "from untrusted web fetch" }, childCtx, db, permissionEngine, { riskMode: "autonomous" });
    console.log("  Executed immediately (autonomous mode bypasses taint enforcement)");
  });

  // Demo 4: Irreversible action with untrusted input - should use declared_irreversible trigger_reason
  await runDemo("DEMO 4: Irreversible action with untrusted input", async () => {
    const irreversibleAction = defineAction({
      name: "irreversibleWithUntrusted",
      description: "Irreversible action with untrusted input",
      permission: "demo.execute",
      inputSchema: z.object({ data: z.string(), confirmation: z.literal("DELETE") }),
      riskTier: "irreversible",
      handler: async (input) => ({ processed: input.data }),
    });
    const childCtx = { ...ctx, parentEventId: TOOL_OUTPUT_EVENT_ID };
    await irreversibleAction.execute({ data: "from untrusted", confirmation: "DELETE" }, childCtx, db, permissionEngine);
  });

  // Demo 5: Chain with sanitizing action in middle
  await runDemo("DEMO 5: Chain with sanitizing action in middle", async () => {
    const actionA = createAction("chainA", "instant");
    const actionB = createAction("chainB_sanitizer", "instant", true); // sanitizes
    const actionC = createAction("chainC", "instant");

    // First action receives untrusted input -> forced to confirmation
    const childCtxA = { ...ctx, parentEventId: TOOL_OUTPUT_EVENT_ID };
    let resultA;
    try {
      resultA = await actionA.execute({ data: "A" }, childCtxA, db, permissionEngine);
    } catch (error: any) {
      if (error.name === "ActionPendingIrreversibleConfirmationError") {
        console.log(`  chainA blocked (confirmation ID: ${error.confirmationId})`);
      }
    }

    // Second action has sanitizes: true -> can execute
    const resultB = await actionB.execute({ data: "B" }, { ...ctx, parentEventId: "dummy-for-demo" }, db, permissionEngine);
    console.log(`  chainB (sanitizes) executed: ${resultB.result.processed}`);

    // Third action receives trusted input from B -> executes without confirmation
    const resultC = await actionC.execute({ data: "C" }, { ...ctx, parentEventId: resultB.eventId }, db, permissionEngine);
    console.log(`  chainC executed: ${resultC.result.processed}`);

    // Verify provenance
    const traceC = await db.getProvenanceTrace(resultC.eventId);
    console.log(`  chainC provenance: ${traceC!.outputLabel} (sanitized by chainB)`);
  });

  // Demo 6: Observability - check event chain includes provenance info
  await runDemo("DEMO 6: Observability - listEvents shows provenance", async () => {
    const action = createAction("observabilityDemo", "instant");
    await action.execute({ data: "trusted input" }, ctx, db, permissionEngine);

    const events = await db.listEvents("demo-workspace");
    const demoEvent = events.items.find((e) => e.actionName === "observabilityDemo");
    console.log(`  Event: ${demoEvent!.actionName}`);
    console.log(`  Provenance: ${demoEvent!.provenanceLabel}`);
    console.log(`  Trigger Reason: ${demoEvent!.triggerReason ?? "none"}`);
  });

  console.log("\n=== ALL DEMOS COMPLETE ===");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});