#!/usr/bin/env node

/**
 * Demo script for Taint-Tracked Provenance (Stage 14a)
 * 
 * This script demonstrates:
 * 1. A human call (fields labeled trusted)
 * 2. An agent call with no provenance (fields labeled untrusted-external)
 * 3. An agent call with explicit mixed provenance (some fields trusted, some not)
 */

import { z } from "zod";
import {
  ActionRegistry,
  defineAction,
  InMemoryPermissionEngine,
  InMemoryDbClient,
  type ActionContext,
} from "@tera/core";

// Create registry and permission engine
const registry = new ActionRegistry();
const permissionEngine = new InMemoryPermissionEngine();
permissionEngine.addRule({ actorType: "human", permissionKey: "demo.createRecord", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "demo.createRecord", result: "allow" });

// Create DB client
const dbClient = new InMemoryDbClient();

// Define the demo action
const createRecordAction = defineAction({
  name: "createRecord",
  description: "Creates a record with provenance tracking",
  permission: "demo.createRecord",
  inputSchema: z.object({
    title: z.string(),
    content: z.string(),
    source: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  handler: async (input) => {
    console.log(`  📝 Handler executed with input:`, JSON.stringify(input, null, 2));
    return { id: `record-${Date.now()}`, ...input, createdAt: new Date().toISOString() };
  },
});

registry.register(createRecordAction);

const humanCtx: ActionContext = {
  actor: { actorType: "human", actorId: "demo-user" },
  workspaceId: "default-workspace",
};

const agentCtx: ActionContext = {
  actor: { actorType: "agent", actorId: "demo-agent" },
  workspaceId: "default-workspace",
};

const agentWithParentCtx: ActionContext = {
  actor: { actorType: "agent", actorId: "demo-agent" },
  workspaceId: "default-workspace",
  parentEventId: "parent-event-123",
};

async function printProvenance(label: string, eventId: string, provenanceIds: string[]) {
  console.log(`  📋 ${label}`);
  console.log(`     Event ID: ${eventId}`);
  console.log(`     Provenance IDs: ${provenanceIds.length} record(s)`);
  
  const provenances = await dbClient.findDataProvenanceByIds(provenanceIds);
  for (const prov of provenances) {
    console.log(`       - Field hash: ${prov.contentHash.slice(0, 16)}... | Label: ${prov.trustLabel} | Source: ${prov.sourceType}${prov.sourceIdentifier ? ` (${prov.sourceIdentifier})` : ''}`);
  }
  console.log("");
}

async function runDemo() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  TAINT-TRACKED PROVENANCE DEMO (Stage 14a)                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ============================================================
  // SCENARIO 1: Human-originated call - defaults to 'trusted'
  // ============================================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SCENARIO 1: Human-originated call (no explicit provenance)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("▶ Executing createRecord as human...");

  const result1 = await createRecordAction.execute(
    { 
      title: "Human Note", 
      content: "This was created by a human",
      source: "user-input"
    },
    humanCtx,
    dbClient,
    permissionEngine
  );

  console.log(`  ✓ Action executed successfully`);
  console.log(`  ✓ Result: ${JSON.stringify(result1.result)}`);
  await printProvenance("Provenance records:", result1.eventId, result1.provenanceIds);

  // ============================================================
  // SCENARIO 2: Agent-originated call with no provenance - defaults to 'untrusted-external'
  // ============================================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SCENARIO 2: Agent-originated call (no explicit provenance)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("▶ Executing createRecord as agent (no provenance metadata)...");

  const result2 = await createRecordAction.execute(
    { 
      title: "Agent Note", 
      content: "This was created by an agent reading tool output",
      source: "tool-output"
    },
    agentCtx,
    dbClient,
    permissionEngine
  );

  console.log(`  ✓ Action executed successfully`);
  console.log(`  ✓ Result: ${JSON.stringify(result2.result)}`);
  await printProvenance("Provenance records:", result2.eventId, result2.provenanceIds);

  // ============================================================
  // SCENARIO 3: Agent call with explicit mixed provenance
  // ============================================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SCENARIO 3: Agent call with explicit mixed provenance");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("▶ Executing createRecord as agent with explicit provenance...");
  console.log("   - title: 'trusted' (human-provided)");
  console.log("   - content: 'untrusted-external' (from tool output)");
  console.log("   - source: 'untrusted-external' (from API response)");
  console.log("   - metadata: 'trusted' (human-verified)");

  const mixedProvenanceCtx: ActionContext = {
    ...agentCtx,
    inputProvenance: {
      title: "trusted",
      content: "untrusted-external",
      source: "untrusted-external",
      metadata: "trusted",
    },
  };

  const result3 = await createRecordAction.execute(
    { 
      title: "Mixed Provenance Note",
      content: "Content from tool output",
      source: "api-response",
      metadata: { verified: true, reviewer: "human" }
    },
    mixedProvenanceCtx,
    dbClient,
    permissionEngine
  );

  console.log(`  ✓ Action executed successfully`);
  console.log(`  ✓ Result: ${JSON.stringify(result3.result)}`);
  await printProvenance("Provenance records:", result3.eventId, result3.provenanceIds);

  // ============================================================
  // Summary
  // ============================================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`
  ✅ Scenario 1 (Human): All fields labeled 'trusted'
     - Source type: human_message
     - Source identifier: demo-user
  
  ✅ Scenario 2 (Agent, no provenance): All fields labeled 'untrusted-external'
     - Source type: api_response
     - Source identifier: demo-agent
  
  ✅ Scenario 3 (Agent, explicit provenance): Mixed labels per field
     - title: trusted (human-provided)
     - content: untrusted-external (from tool output)
     - source: untrusted-external (from API response)
     - metadata: trusted (human-verified)

  📌 Key Points:
     - Labels assigned at ingestion point, never inferred later
     - Default: 'trusted' for human, 'untrusted-external' for agent/system
     - Explicit provenance in ActionContext.inputProvenance overrides defaults
     - Records stored in data_provenance table, linked via provenance_ids in action_events
  `);

  console.log("✅ Demo complete!");
}

runDemo().catch(console.error);