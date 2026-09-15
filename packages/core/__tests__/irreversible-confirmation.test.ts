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
        workspaceId: z.string().uuid(),
        confirmation: z.literal("DELETE"),
      }),
      riskTier: "irreversible",
      handler: async (input) => ({ deleted: true, workspaceId: input.workspaceId }),
    });

    registry.register(action);
  });

  it("requestIrreversibleConfirmation creates confirmation and returns awaiting_confirmation", async () => {
    const result = await requestIrreversibleConfirmation(
      "event-123",
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

    await requestIrreversibleConfirmation(
      "event-123",
      action,
      actor,
      { workspaceId: "ws-1", confirmation: "DELETE", destination: "attacker@evil.com" },
      "ws-1",
      dbClient,
      maliciousResolver
    );

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    expect(confirmations[0].sentTo).not.toContain("attacker@evil.com");
    expect(confirmations[0].sentTo).toContain("admin@example.com");
  });

  it("confirmIrreversibleConfirmation executes handler after confirmation", async () => {
    const requestResult = await requestIrreversibleConfirmation(
      "event-123",
      action,
      actor,
      { workspaceId: "ws-1", confirmation: "DELETE" },
      "ws-1",
      dbClient,
      mockContactResolver
    );

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

    const requestResult = await requestIrreversibleConfirmation(
      "event-123",
      action,
      actor,
      { workspaceId: "ws-1", confirmation: "DELETE" },
      "ws-1",
      dbClient,
      mockContactResolver
    );

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    const token = confirmations[0].confirmationToken;

    await expect(
      confirmIrreversibleConfirmation(token, dbClient, registry, denyEngine)
    ).rejects.toThrow("permission_denied_at_confirmation");

    const updatedConfirmation = await dbClient.findIrreversibleConfirmationByToken(token);
    expect(updatedConfirmation?.status).toBe("rejected");
  });

  it("confirmIrreversibleConfirmation re-checks containment at confirmation time", async () => {
    await dbClient.upsertActorState({
      actorId: "user-1",
      workspaceId: "ws-1",
      status: "contained",
      containedAt: new Date(),
      containedReason: "test containment",
      reviewedBy: null,
      reviewedAt: null,
    });

    const requestResult = await requestIrreversibleConfirmation(
      "event-123",
      action,
      actor,
      { workspaceId: "ws-1", confirmation: "DELETE" },
      "ws-1",
      dbClient,
      mockContactResolver
    );

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    const token = confirmations[0].confirmationToken;

    await expect(
      confirmIrreversibleConfirmation(token, dbClient, registry, engine)
    ).rejects.toThrow("ACTOR_CONTAINED");
  });

  it("rejectIrreversibleConfirmation prevents execution", async () => {
    const requestResult = await requestIrreversibleConfirmation(
      "event-123",
      action,
      actor,
      { workspaceId: "ws-1", confirmation: "DELETE" },
      "ws-1",
      dbClient,
      mockContactResolver
    );

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
    const shortTtlResolver: WorkspaceContactResolver = {
      getContact: vi.fn().mockResolvedValue({
        channel: "email",
        destination: "admin@example.com",
      }),
    };

    await requestIrreversibleConfirmation(
      "event-123",
      action,
      actor,
      { workspaceId: "ws-1", confirmation: "DELETE" },
      "ws-1",
      dbClient,
      shortTtlResolver,
      1
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expirePendingIrreversibleConfirmations(dbClient);

    const confirmations = await dbClient.findPendingIrreversibleConfirmations();
    expect(confirmations).toHaveLength(0);

    const allConfirmations = await dbClient.listPendingIrreversibleConfirmations("ws-1");
    expect(allConfirmations).toHaveLength(0);
  });
});