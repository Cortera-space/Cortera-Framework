import { z } from "zod";
import {
  defineAction,
  InMemoryDbClient,
  type ActionContext,
  type DefinedAction,
} from "@tera/core";

const ctx: ActionContext = {
  actor: { actorType: "agent" as const, actorId: "demo-agent" },
  workspaceId: "demo-workspace",
};

const createTransformAction = (name: string, sanitizes = false): DefinedAction<any, any> =>
  defineAction({
    name,
    description: `Transform step ${name}`,
    permission: "transform.execute",
    inputSchema: z.object({ data: z.string() }),
    sanitizes,
    handler: async (input) => ({
      transformed: `${name} processed: ${input.data}`,
    }),
  });

async function runChainDemo(
  name: string,
  actions: Array<{ action: DefinedAction<any, any>; sanitizes: boolean }>,
  sourceEventId: string,
  db: InMemoryDbClient
) {
  console.log(`\n=== ${name} ===`);

  let currentParentId = sourceEventId;
  const results: Array<{ actionName: string; eventId: string }> = [];

  for (const { action, sanitizes } of actions) {
    const result = await action.execute(
      { data: `input for ${action.name}` },
      { ...ctx, parentEventId: currentParentId },
      db
    ) as { result: any; eventId: string };

    console.log(`${action.name}${sanitizes ? " (sanitizes)" : ""} executed:`, result.result);
    results.push({ actionName: action.name, eventId: result.eventId });
    currentParentId = result.eventId;
  }

  // Show provenance trace for the final action
  const finalEventId = results[results.length - 1].eventId;
  const trace = await db.getProvenanceTrace(finalEventId);

  console.log(`\n--- Provenance Trace for ${results[results.length - 1].actionName} ---`);
  console.log(`Output Label: ${trace!.outputLabel}`);
  console.log("Trace Entries:");
  for (const entry of trace!.trace) {
    console.log(`  [${entry.label}] ${entry.actionName} (event: ${entry.eventId})${entry.isSanitized ? " [SANITIZED]" : ""}`);
    if (entry.sourceEventId) {
      console.log(`    <- derived from: ${entry.sourceEventId}`);
    }
  }

  return { finalEventId, trace: trace! };
}

async function main() {
  const db = new InMemoryDbClient();

  // Simulate an untrusted tool output source
  const TOOL_OUTPUT_EVENT_ID = "external-tool-output-event";
  await db.insertDataProvenance({
    eventId: TOOL_OUTPUT_EVENT_ID,
    fieldPath: "output",
    label: "untrusted-external",
    sourceEventId: null,
  });
  console.log(`Created untrusted tool output source: ${TOOL_OUTPUT_EVENT_ID}`);

  // Chain 1: Three actions, no sanitization - should remain untrusted
  const actionA1 = createTransformAction("transformA", false);
  const actionB1 = createTransformAction("transformB", false);
  const actionC1 = createTransformAction("transformC", false);

  await runChainDemo(
    "CHAIN 1: No Sanitization (Untrusted propagates through)",
    [
      { action: actionA1, sanitizes: false },
      { action: actionB1, sanitizes: false },
      { action: actionC1, sanitizes: false },
    ],
    TOOL_OUTPUT_EVENT_ID,
    db
  );

  // Chain 2: Three actions with sanitization in middle - should become trusted
  const actionA2 = createTransformAction("transformA_v2", false);
  const actionB2 = createTransformAction("transformB_v2", true); // This one sanitizes
  const actionC2 = createTransformAction("transformC_v2", false);

  await runChainDemo(
    "CHAIN 2: Sanitization in Middle (Taint cleaned downstream)",
    [
      { action: actionA2, sanitizes: false },
      { action: actionB2, sanitizes: true },
      { action: actionC2, sanitizes: false },
    ],
    TOOL_OUTPUT_EVENT_ID,
    db
  );

  // Verify Chain 1's transformA still shows untrusted (history preserved)
  console.log("\n=== VERIFICATION: Chain 1 transformA provenance (unchanged) ===");
  const traceA1 = await db.getProvenanceTrace(db.events.find(e => e.actionName === "transformA")!.id);
  console.log(`transformA output: ${traceA1!.outputLabel}`);

  // Verify Chain 2's transformA still shows untrusted (history preserved)
  console.log("\n=== VERIFICATION: Chain 2 transformA_v2 provenance (unchanged) ===");
  const traceA2 = await db.getProvenanceTrace(db.events.find(e => e.actionName === "transformA_v2")!.id);
  console.log(`transformA_v2 output: ${traceA2!.outputLabel}`);

  // Verify Chain 2's transformB_v2 shows trusted (sanitized)
  console.log("\n=== VERIFICATION: Chain 2 transformB_v2 provenance (sanitized) ===");
  const traceB2 = await db.getProvenanceTrace(db.events.find(e => e.actionName === "transformB_v2")!.id);
  console.log(`transformB_v2 output: ${traceB2!.outputLabel}`);

  console.log("\n=== ALL DEMOS COMPLETE ===");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});