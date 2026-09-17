import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionRegistry,
  InMemoryPermissionEngine,
  InMemoryDbClient,
  requestIrreversibleConfirmation,
  confirmIrreversibleConfirmation,
  rejectIrreversibleConfirmation,
  expirePendingIrreversibleConfirmations,
  ActionPendingIrreversibleConfirmationError,
  type ActionContext,
  type Actor,
  type WorkspaceContactResolver,
  type DefinedAction,
} from "@tera/core";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

const mockContactResolver: WorkspaceContactResolver = {
  getContact: vi.fn().mockResolvedValue({
    channel: "email",
    destination: "admin@example.com",
  }),
};

describe("irreversible confirmation", () => {
  let dbClient: InMemoryDbClient;
  let registry: ActionRegistry;
  let engine: InMemoryPermissionEngine;
  let action: DefinedAction<any>;
  let actor: Actor;

  beforeEach(() => {
    dbClient = new InMemoryDbClient();
    registry = new ActionRegistry();
    engine = new InMemoryPermissionEngine();
    engine.addRule({ permissionKey: "workspaces.delete", result: "allow" });

    actor = { actorType: "human", actorId: "user-1" };

    action = defineAction({
      name: "deleteWorkspace",
      description: "Deletes a workspace",
      permission: "workspaces.delete",
      inputSchema: z.object({
        workspaceId: z.string(),
        confirmation: z.literal("DELETE"),
      }),
      riskTier: "irreversible",
      handler: async (input) => ({ deleted: true, workspaceId: input.workspaceId }),
    });

    registry.register(action);
    (globalThis as any).__TERA_CONTACT_RESOLVER__ = mockContactResolver;
  });

  it("requestIrreversibleConfirmation creates confirmation and returns awaiting_confirmation", async () => {
    // First create an event as the action would
    const insertEvent = {
      actionName: "deleteWorkspace",
      actorType: "human" as const,
      actorId: "user-1",
      input: { workspaceId: "ws-1", confirmation: "DELETE" },
      output: null,
      error: null,
      permissionResult: "pending_confirmation" as const,
      approvedBy: null,
      parentEventId: null,
      startedAt: new Date(),
      durationMs: null,
      workspaceId: "ws-1",
      blastRadius: null,
    };
    const { id: actionEventId } = await dbClient.insertActionEvent(insertEvent as any);

    const result = await requestIrreversibleConfirmation(
      actionEventId,
      action,
      actor,
      { workspaceId: "ws-1", confirmation: "DELETE" },
      "ws-1",
      dbClient,
      mockContactResolver
    );

    expect(result.status).toBe("awaiting_confirmation");
    expect(result.confirmationId).toBeDefined();

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].actionName).toBe("deleteWorkspace");
    expect(confirmations[0].actorId).toBe("user-1");
    expect(confirmations[0].status).toBe("pending");
    expect(confirmations[0].channel).toBe("email");
    expect(confirmations[0].sentTo).toContain("@");
  });

  it("requestIrreversibleConfirmation uses pre-registered contact, ignores request-supplied destination", async () => {
    const maliciousResolver: WorkspaceContactResolver = {
      getContact: vi.fn().mockResolvedValue({
        channel: "email",
        destination: "admin@example.com",
      }),
    };

    // Create event first
    const insertEvent = {
      actionName: "deleteWorkspace",
      actorType: "human" as const,
      actorId: "user-1",
      input: { workspaceId: "ws-1", confirmation: "DELETE", destination: "attacker@evil.com" },
      output: null,
      error: null,
      permissionResult: "pending_confirmation" as const,
      approvedBy: null,
      parentEventId: null,
      startedAt: new Date(),
      durationMs: null,
      workspaceId: "ws-1",
      blastRadius: null,
    };
    const { id: actionEventId } = await dbClient.insertActionEvent(insertEvent as any);

    await requestIrreversibleConfirmation(
      actionEventId,
      action,
      actor,
      { workspaceId: "ws-1", confirmation: "DELETE", destination: "attacker@evil.com" },
      "ws-1",
      dbClient,
      maliciousResolver
    );

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    expect(confirmations[0].sentTo).not.toContain("attacker@evil.com");
    expect(confirmations[0].sentTo).toContain("ad***@example.com");
  });

  it("confirmIrreversibleConfirmation executes handler after confirmation", async () => {
    // Execute the action to create event and confirmation
    try {
      await action.execute(
        { workspaceId: "ws-1", confirmation: "DELETE" },
        makeCtx(),
        dbClient,
        engine
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      (error as ActionPendingIrreversibleConfirmationError).confirmationId;
    }

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    const token = confirmations[0].confirmationToken;

    const result = await confirmIrreversibleConfirmation(token, dbClient, registry, engine);

    expect(result.result).toEqual({ deleted: true, workspaceId: "ws-1" });

    const updatedConfirmation = await dbClient.findIrreversibleConfirmationByToken(token);
    expect(updatedConfirmation?.status).toBe("confirmed");
  });

  it("confirmIrreversibleConfirmation re-checks permission at confirmation time", async () => {
    const denyEngine = new InMemoryPermissionEngine();
    denyEngine.addRule({ permissionKey: "workspaces.delete", result: "deny" });

    // Execute the action to create event and confirmation
    try {
      await action.execute(
        { workspaceId: "ws-1", confirmation: "DELETE" },
        makeCtx(),
        dbClient,
        engine
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      (error as ActionPendingIrreversibleConfirmationError).confirmationId;
    }

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    const token = confirmations[0].confirmationToken;

    await expect(
      confirmIrreversibleConfirmation(token, dbClient, registry, denyEngine)
    ).rejects.toThrow("actor lacks permission at confirmation time");

    const updatedConfirmation = await dbClient.findIrreversibleConfirmationByToken(token);
    expect(updatedConfirmation?.status).toBe("rejected");
  });

  it("confirmIrreversibleConfirmation re-checks containment at confirmation time", async () => {
    // Execute the action to create event and confirmation
    try {
      await action.execute(
        { workspaceId: "ws-1", confirmation: "DELETE" },
        makeCtx(),
        dbClient,
        engine
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      (error as ActionPendingIrreversibleConfirmationError).confirmationId;
    }

    // Now contain the actor
    await dbClient.upsertActorState({
      actorId: "user-1",
      workspaceId: "ws-1",
      status: "contained",
      containedAt: new Date(),
      containedReason: "test containment",
      reviewedBy: null,
      reviewedAt: null,
    });

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    const token = confirmations[0].confirmationToken;

    await expect(
      confirmIrreversibleConfirmation(token, dbClient, registry, engine)
    ).rejects.toThrow("actor is contained");

    const updatedConfirmation = await dbClient.findIrreversibleConfirmationByToken(token);
    expect(updatedConfirmation?.status).toBe("rejected");
  });

it("rejectIrreversibleConfirmation prevents execution", async () => {
    // Execute the action to create event and confirmation
    try {
      await action.execute(
        { workspaceId: "ws-1", confirmation: "DELETE" },
        makeCtx(),
        dbClient,
        engine
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      (error as ActionPendingIrreversibleConfirmationError).confirmationId;
    }

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    const token = confirmations[0].confirmationToken;

    await rejectIrreversibleConfirmation(token, dbClient);

    const updatedConfirmation = await dbClient.findIrreversibleConfirmationByToken(token);
    expect(updatedConfirmation?.status).toBe("rejected");

    const events = dbClient.events.filter((e) => e.actionName === "deleteWorkspace");
    expect(events[0].permissionResult).toBe("deny");
    expect(events[0].error).toBe("confirmation_rejected");
  });

  it("expirePendingIrreversibleConfirmations auto-denies expired confirmations", async () => {
    // Execute the action to create event and confirmation
    try {
      await action.execute(
        { workspaceId: "ws-1", confirmation: "DELETE" },
        makeCtx(),
        dbClient,
        engine
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      (error as ActionPendingIrreversibleConfirmationError).confirmationId;
    }

    // Wait for expiry (the TTL in the action is 15 min default, but we can manually expire)
    // Manually set expiresAt to past
    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    const confirmation = confirmations[0];
    await dbClient.updateIrreversibleConfirmation(confirmation.id, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await expirePendingIrreversibleConfirmations(dbClient);

    const pendingConfirmations = await dbClient.findPendingIrreversibleConfirmations();
    expect(pendingConfirmations).toHaveLength(0);

    const allConfirmations = await dbClient.listPendingIrreversibleConfirmations("ws-1");
    expect(allConfirmations).toHaveLength(0);
  });
});