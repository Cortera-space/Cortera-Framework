import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionRegistry,
  InMemoryPermissionEngine,
  InMemoryDbClient,
  rollbackAction,
  type ActionContext,
  type Actor,
  type DefinedAction,
  ActionRollbackError,
} from "@tera/core";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

describe("rollback scaffolding", () => {
  let dbClient: InMemoryDbClient;
  let registry: ActionRegistry;
  let engine: InMemoryPermissionEngine;
  let action: DefinedAction<any>;
  let actor: Actor;

  beforeEach(() => {
    dbClient = new InMemoryDbClient();
    registry = new ActionRegistry();
    engine = new InMemoryPermissionEngine();
    engine.addRule({ permissionKey: "notes.archive", result: "allow" });

    actor = { actorType: "human", actorId: "user-1" };

    action = defineAction({
      name: "archiveNote",
      description: "Archives a note",
      permission: "notes.archive",
      inputSchema: z.object({
        noteId: z.string(),
      }),
      riskTier: "instant",
      handler: async (input) => ({ archived: true, noteId: input.noteId }),
      rollback: async (output, _ctx: ActionContext) => {
        return { restored: true, noteId: (output as any).noteId };
      },
    });

    registry.register(action);
  });

  it("rollbackAction calls rollback function and writes new linked event", async () => {
    const result = await action.execute(
      { noteId: "note-123" },
      makeCtx(),
      dbClient,
      engine
    );

    const originalEventId = result.eventId;
    expect(originalEventId).toBeDefined();

    const rollbackResult = await rollbackAction(originalEventId, "admin-1", dbClient, registry);

    expect(rollbackResult.result).toEqual({ restored: true, noteId: "note-123" });

    const events = dbClient.events.filter((e) => e.actionName === "archiveNote.rollback");
    expect(events).toHaveLength(1);
    expect(events[0].parentEventId).toBe(originalEventId);
    expect(events[0].permissionResult).toBe("allow");
    expect(events[0].approvedBy).toBe("admin-1");
  });

  it("rollbackAction on action without rollback function throws clear error", async () => {
    const noRollbackAction = defineAction({
      name: "noRollbackAction",
      description: "Action without rollback",
      permission: "notes.archive",
      inputSchema: z.object({ noteId: z.string() }),
      handler: async (input) => ({ deleted: true, noteId: input.noteId }),
    });

    registry.register(noRollbackAction);

    const result = await noRollbackAction.execute(
      { noteId: "note-123" },
      makeCtx(),
      dbClient,
      engine
    );

    await expect(
      rollbackAction(result.eventId, "admin-1", dbClient, registry)
    ).rejects.toThrow(ActionRollbackError);

    try {
      await rollbackAction(result.eventId, "admin-1", dbClient, registry);
    } catch (error) {
      expect(error).toBeInstanceOf(ActionRollbackError);
      expect((error as ActionRollbackError).message).toContain("does not have a rollback function defined");
    }
  });

  it("rollbackAction on non-existent event throws clear error", async () => {
    await expect(
      rollbackAction("non-existent-event", "admin-1", dbClient, registry)
    ).rejects.toThrow(ActionRollbackError);

    try {
      await rollbackAction("non-existent-event", "admin-1", dbClient, registry);
    } catch (error) {
      expect(error).toBeInstanceOf(ActionRollbackError);
      expect((error as ActionRollbackError).message).toContain("Original event not found");
    }
  });

  it("rollbackAction on action that was not executed successfully throws clear error", async () => {
    const deniedEngine = new InMemoryPermissionEngine();
    deniedEngine.addRule({ permissionKey: "notes.archive", result: "deny" });

    try {
      await action.execute({ noteId: "note-123" }, makeCtx(), dbClient, deniedEngine);
    } catch (error) {
      // Expected to fail
    }

    const events = dbClient.events.filter((e) => e.actionName === "archiveNote");
    const deniedEvent = events[0];

    await expect(
      rollbackAction(deniedEvent.id, "admin-1", dbClient, registry)
    ).rejects.toThrow(ActionRollbackError);

    try {
      await rollbackAction(deniedEvent.id, "admin-1", dbClient, registry);
    } catch (error) {
      expect(error).toBeInstanceOf(ActionRollbackError);
      expect((error as ActionRollbackError).message).toContain("not executed successfully");
    }
  });
});