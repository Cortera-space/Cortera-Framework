import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  defineAction,
  InMemoryDbClient,
  InMemoryPermissionEngine,
  type ActionContext,
} from "../src/index";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

describe("Provenance labeling", () => {
  it("human-originated call with no explicit provenance defaults every field to 'trusted'", async () => {
    const dbClient = new InMemoryDbClient();
    const permissionEngine = new InMemoryPermissionEngine();
    permissionEngine.addRule({ actorType: "human", permissionKey: "test.action", result: "allow" });

    const action = defineAction({
      name: "testAction",
      description: "Test action for provenance",
      permission: "test.action",
      inputSchema: z.object({
        field1: z.string(),
        field2: z.number(),
        field3: z.boolean(),
      }),
      handler: async (input) => input,
    });

    const ctx = makeCtx({ actor: { actorType: "human", actorId: "user-1" } });
    await action.execute({ field1: "hello", field2: 42, field3: true }, ctx, dbClient, permissionEngine);

    const events = await dbClient.listEvents("ws-1", { limit: 10 });
    expect(events.items).toHaveLength(1);
    const event = events.items[0];
    expect(event.provenanceIds).toHaveLength(3);

    const provenances = await dbClient.findDataProvenanceByIds(event.provenanceIds);
    expect(provenances).toHaveLength(3);
    for (const prov of provenances) {
      expect(prov.trustLabel).toBe("trusted");
      expect(prov.sourceType).toBe("human_message");
      expect(prov.sourceIdentifier).toBe("user-1");
    }
  });

  it("agent-originated call with no explicit provenance defaults every field to 'untrusted-external'", async () => {
    const dbClient = new InMemoryDbClient();
    const permissionEngine = new InMemoryPermissionEngine();
    permissionEngine.addRule({ actorType: "agent", permissionKey: "test.action", result: "allow" });

    const action = defineAction({
      name: "testAction2",
      description: "Test action for provenance",
      permission: "test.action",
      inputSchema: z.object({
        field1: z.string(),
        field2: z.number(),
      }),
      handler: async (input) => input,
    });

    const ctx = makeCtx({ actor: { actorType: "agent", actorId: "agent-1" } });
    await action.execute({ field1: "hello", field2: 42 }, ctx, dbClient, permissionEngine);

    const events = await dbClient.listEvents("ws-1", { limit: 10 });
    expect(events.items).toHaveLength(1);
    const event = events.items[0];
    expect(event.provenanceIds).toHaveLength(2);

    const provenances = await dbClient.findDataProvenanceByIds(event.provenanceIds);
    expect(provenances).toHaveLength(2);
    for (const prov of provenances) {
      expect(prov.trustLabel).toBe("untrusted-external");
      expect(prov.sourceType).toBe("api_response");
      expect(prov.sourceIdentifier).toBe("agent-1");
    }
  });

  it("explicit provenance metadata on a call overrides the defaults correctly per field", async () => {
    const dbClient = new InMemoryDbClient();
    const permissionEngine = new InMemoryPermissionEngine();
    permissionEngine.addRule({ actorType: "agent", permissionKey: "test.action", result: "allow" });

    const action = defineAction({
      name: "testAction3",
      description: "Test action for provenance",
      permission: "test.action",
      inputSchema: z.object({
        trustedField: z.string(),
        untrustedField: z.number(),
        anotherTrusted: z.boolean(),
      }),
      handler: async (input) => input,
    });

    const ctx = makeCtx({
      actor: { actorType: "agent", actorId: "agent-1" },
      inputProvenance: {
        trustedField: "trusted",
        untrustedField: "untrusted-external",
        anotherTrusted: "trusted",
      },
    });
    await action.execute(
      { trustedField: "hello", untrustedField: 42, anotherTrusted: true },
      ctx,
      dbClient,
      permissionEngine
    );

    const events = await dbClient.listEvents("ws-1", { limit: 10 });
    expect(events.items).toHaveLength(1);
    const event = events.items[0];
    expect(event.provenanceIds).toHaveLength(3);

    const provenances = await dbClient.findDataProvenanceByIds(event.provenanceIds);
    expect(provenances).toHaveLength(3);

    const provMap = new Map(provenances.map((p) => [p.contentHash, p]));
    
    // Check trusted fields
    const trustedHashes = provenances.filter((p) => p.trustLabel === "trusted");
    expect(trustedHashes).toHaveLength(2);
    
    const untrustedHashes = provenances.filter((p) => p.trustLabel === "untrusted-external");
    expect(untrustedHashes).toHaveLength(1);
  });

  it("data_provenance rows are correctly written and linked to the originating action_events row", async () => {
    const dbClient = new InMemoryDbClient();
    const permissionEngine = new InMemoryPermissionEngine();
    permissionEngine.addRule({ actorType: "human", permissionKey: "test.action", result: "allow" });

    const action = defineAction({
      name: "testAction4",
      description: "Test action for provenance",
      permission: "test.action",
      inputSchema: z.object({
        message: z.string(),
      }),
      handler: async (input) => input,
    });

    const ctx = makeCtx({ actor: { actorType: "human", actorId: "user-1" } });
    const result = await action.execute({ message: "test" }, ctx, dbClient, permissionEngine);

    expect(result.eventId).toBeDefined();
    
    const events = await dbClient.listEvents("ws-1", { limit: 10 });
    expect(events.items).toHaveLength(1);
    const event = events.items[0];
    expect(event.eventId).toBe(result.eventId);
    expect(event.provenanceIds).toHaveLength(1);

    const provenances = await dbClient.findDataProvenanceByIds(event.provenanceIds);
    expect(provenances).toHaveLength(1);
    expect(provenances[0].trustLabel).toBe("trusted");
    expect(provenances[0].workspaceId).toBe("ws-1");
    expect(provenances[0].sourceType).toBe("human_message");
  });

  it("agent call with parentEventId uses tool_output as source_type", async () => {
    const dbClient = new InMemoryDbClient();
    const permissionEngine = new InMemoryPermissionEngine();
    permissionEngine.addRule({ actorType: "agent", permissionKey: "test.action", result: "allow" });

    const action = defineAction({
      name: "testAction5",
      description: "Test action for provenance",
      permission: "test.action",
      inputSchema: z.object({
        data: z.string(),
      }),
      handler: async (input) => input,
    });

    const ctx = makeCtx({
      actor: { actorType: "agent", actorId: "agent-1" },
      parentEventId: "parent-event-123",
    });
    await action.execute({ data: "test" }, ctx, dbClient, permissionEngine);

    const events = await dbClient.listEvents("ws-1", { limit: 10 });
    expect(events.items).toHaveLength(1);
    const event = events.items[0];
    expect(event.provenanceIds).toHaveLength(1);

    const provenances = await dbClient.findDataProvenanceByIds(event.provenanceIds);
    expect(provenances).toHaveLength(1);
    expect(provenances[0].trustLabel).toBe("untrusted-external");
    expect(provenances[0].sourceType).toBe("tool_output");
    expect(provenances[0].sourceIdentifier).toBe("parent-event-123");
  });

  it("system actor defaults to untrusted-external", async () => {
    const dbClient = new InMemoryDbClient();
    const permissionEngine = new InMemoryPermissionEngine();
    permissionEngine.addRule({ actorType: "system", permissionKey: "test.action", result: "allow" });

    const action = defineAction({
      name: "testAction6",
      description: "Test action for provenance",
      permission: "test.action",
      inputSchema: z.object({
        value: z.string(),
      }),
      handler: async (input) => input,
    });

    const ctx = makeCtx({ actor: { actorType: "system", actorId: "system-1" } });
    await action.execute({ value: "test" }, ctx, dbClient, permissionEngine);

    const events = await dbClient.listEvents("ws-1", { limit: 10 });
    expect(events.items).toHaveLength(1);
    const event = events.items[0];
    expect(event.provenanceIds).toHaveLength(1);

    const provenances = await dbClient.findDataProvenanceByIds(event.provenanceIds);
    expect(provenances).toHaveLength(1);
    expect(provenances[0].trustLabel).toBe("untrusted-external");
    expect(provenances[0].sourceType).toBe("api_response");
    expect(provenances[0].sourceIdentifier).toBe("system-1");
  });
});