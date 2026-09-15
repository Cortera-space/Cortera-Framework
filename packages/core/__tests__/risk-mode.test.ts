import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionRegistry,
  InMemoryPermissionEngine,
  InMemoryDbClient,
  ActionContainmentError,
  ActionPermissionError,
  ActionValidationError,
  type ActionContext,
  type DbClient,
  type InsertActionEvent,
  cancelDelayedAction,
  processPendingDelayedActions,
  withParent,
} from "../src/index";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

describe("Risk Mode - Guarded vs Autonomous", () => {
  describe("riskTier: instant (default behavior)", () => {
    it("behaves identically to untagged Action (regression test)", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "instantAction",
        description: "Instant action",
        permission: "test.instant",
        inputSchema: z.object({ value: z.string() }),
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.instant", result: "allow" });

      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      
      expect(result).toEqual({ result: { success: true }, eventId: expect.any(String) });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("with riskTier instant explicitly set, behaves identically", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "explicitInstantAction",
        description: "Explicit instant action",
        permission: "test.instant",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "instant",
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.instant", result: "allow" });

      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      
      expect(result).toEqual({ result: { success: true }, eventId: expect.any(String) });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("riskTier: delayed", () => {
    it("does not run handler immediately, creates pending row", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "delayedAction",
        description: "Delayed action",
        permission: "test.delayed",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 100, // Short delay for testing
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.delayed", result: "allow" });

      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      
      // Should return delayed status, not execute handler
      expect(result).toEqual({
        status: "delayed",
        pendingId: expect.any(String),
        scheduledRunAt: expect.any(Date),
      });
      expect(handler).not.toHaveBeenCalled();

      // Check pending row was created
      const pending = await dbClient.findPendingDelayedActionById((result as any).pendingId);
      expect(pending).toBeDefined();
      expect(pending?.status).toBe("pending");
      expect(pending?.actionName).toBe("delayedAction");
    });

    it("handler runs only after sweep processes it past scheduled_run_at", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "delayedActionSweep",
        description: "Delayed action for sweep test",
        permission: "test.delayed.sweep",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 50, // Very short delay
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.delayed.sweep", result: "allow" });

      const registry = new ActionRegistry();
      registry.register(action);

      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      
      expect((result as any).status).toBe("delayed");
      expect(handler).not.toHaveBeenCalled();

      // Wait for delay to pass
      await new Promise(resolve => setTimeout(resolve, 100));

      // Run sweep
      const processed = await processPendingDelayedActions(dbClient, "ws-1", permissionEngine, registry);
      
      expect(processed).toBe(1);
      expect(handler).toHaveBeenCalledTimes(1);

      // Check pending row marked as executed
      const pending = await dbClient.findPendingDelayedActionById((result as any).pendingId);
      expect(pending?.status).toBe("executed");
    });

    it("respects delayWindowMs per-Action (not hardcoded globally)", async () => {
      const handler1 = vi.fn().mockResolvedValue({ success: true });
      const handler2 = vi.fn().mockResolvedValue({ success: true });
      
      const actionShort = defineAction({
        name: "delayedShort",
        description: "Short delay",
        permission: "test.delayed.short",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 50, // 50ms
        handler: handler1,
      });

      const actionLong = defineAction({
        name: "delayedLong",
        description: "Long delay",
        permission: "test.delayed.long",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 5000, // 5 seconds
        handler: handler2,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.delayed.short", result: "allow" });
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.delayed.long", result: "allow" });

      const registry = new ActionRegistry();
      registry.register(actionShort);
      registry.register(actionLong);

      const resultShort = await actionShort.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      const resultLong = await actionLong.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);

      expect((resultShort as any).status).toBe("delayed");
      expect((resultLong as any).status).toBe("delayed");

      // Wait for short delay to pass
      await new Promise(resolve => setTimeout(resolve, 100));

      // Run sweep - only short should execute
      const processed = await processPendingDelayedActions(dbClient, "ws-1", permissionEngine, registry);
      
      expect(processed).toBe(1);
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();

      const pendingShort = await dbClient.findPendingDelayedActionById((resultShort as any).pendingId);
      const pendingLong = await dbClient.findPendingDelayedActionById((resultLong as any).pendingId);
      expect(pendingShort?.status).toBe("executed");
      expect(pendingLong?.status).toBe("pending");
    });
  });

  describe("cancelDelayedAction", () => {
    it("correctly prevents execution when called before scheduled_run_at", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "cancelableAction",
        description: "Cancelable delayed action",
        permission: "test.cancel",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 5000, // Long delay
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.cancel", result: "allow" });

      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      const pendingId = (result as any).pendingId;

      // Cancel the delayed action
      await cancelDelayedAction(dbClient, pendingId, "user-1");

      // Verify it was canceled
      const pending = await dbClient.findPendingDelayedActionById(pendingId);
      expect(pending?.status).toBe("canceled");

      // Run sweep - handler should NOT run
      const registry = new ActionRegistry();
      registry.register(action);
      
      const processed = await processPendingDelayedActions(dbClient, "ws-1", permissionEngine, registry);
      
      expect(processed).toBe(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it("throws if trying to cancel after scheduled_run_at passed", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "cancelableAction2",
        description: "Cancelable delayed action",
        permission: "test.cancel2",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 10, // Very short
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.cancel2", result: "allow" });

      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      const pendingId = (result as any).pendingId;

      // Wait for delay to pass
      await new Promise(resolve => setTimeout(resolve, 50));

      // Try to cancel - should throw
      await expect(cancelDelayedAction(dbClient, pendingId, "user-1")).rejects.toThrow(
        "scheduled run time has passed"
      );
    });

    it("throws if trying to cancel non-pending action", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "cancelableAction3",
        description: "Cancelable delayed action",
        permission: "test.cancel3",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 5000,
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.cancel3", result: "allow" });

      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      const pendingId = (result as any).pendingId;

      // Cancel once
      await cancelDelayedAction(dbClient, pendingId, "user-1");

      // Try to cancel again - should throw
      await expect(cancelDelayedAction(dbClient, pendingId, "user-1")).rejects.toThrow(
        "status is canceled"
      );
    });
  });

  describe("delay-window executor RE-CHECKS containment/permission at execution time", () => {
    it("denies delayed action if actor becomes contained during delay window", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const parentAction = defineAction({
        name: "parentAction",
        description: "Parent with blast radius",
        permission: "notes.create",
        inputSchema: z.object({ title: z.string() }),
        blastRadius: ["notes.*"],
        handler: async (input) => ({ parent: input.title }),
      });

      const delayedAction = defineAction({
        name: "delayedActionContained",
        description: "Delayed action that will be contained",
        permission: "customers.delete", // Outside blast radius
        inputSchema: z.object({ id: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 100,
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "notes.create", result: "allow" });
      permissionEngine.addRule({ actorType: "human", permissionKey: "customers.delete", result: "allow" });

      const registry = new ActionRegistry();
      registry.register(parentAction);
      registry.register(delayedAction);

      // Execute parent action
      const parentResult = await parentAction.execute({ title: "Root" }, makeCtx(), dbClient, permissionEngine);
      
      // Execute delayed action as child of parent - this will be scheduled
      const childResult = await delayedAction.execute(
        { id: "cust-1" },
        withParent(makeCtx(), parentResult.eventId),
        dbClient,
        permissionEngine
      );
      
      expect((childResult as any).status).toBe("delayed");
      expect(handler).not.toHaveBeenCalled();

      // Wait for delay to pass
      await new Promise(resolve => setTimeout(resolve, 150));

      // Run sweep - should RE-CHECK blast radius and deny because
      // the delayed action exceeds the parent's blast radius
      const processed = await processPendingDelayedActions(dbClient, "ws-1", permissionEngine, registry);
      
      expect(processed).toBe(0); // Not processed (denied)
      
      // Check pending row marked as canceled
      const pending = await dbClient.findPendingDelayedActionById((childResult as any).pendingId);
      expect(pending?.status).toBe("canceled");
      
      // Check action_events has denial with blast radius error
      const events = dbClient.events.filter(e => e.actionName === "delayedActionContained");
      const denialEvent = events.find(e => e.permissionResult === "deny");
      expect(denialEvent).toBeDefined();
      expect((denialEvent?.error as any)?.code).toBe("BLAST_RADIUS_EXCEEDED");
    });

    it("denies delayed action if permission changes during delay window", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const delayedAction = defineAction({
        name: "delayedPermissionChange",
        description: "Delayed action with permission change",
        permission: "test.permission.change",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 100,
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.permission.change", result: "allow" });

      const registry = new ActionRegistry();
      registry.register(delayedAction);

      const result = await delayedAction.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      expect((result as any).status).toBe("delayed");

      // Wait for delay to pass
      await new Promise(resolve => setTimeout(resolve, 150));

      // CHANGE permission to deny - replace the rule
      (permissionEngine as any).rules = [
        { actorType: "human", permissionKey: "test.permission.change", result: "deny" }
      ];

      // Run sweep - should RE-CHECK permission and deny
      const processed = await processPendingDelayedActions(dbClient, "ws-1", permissionEngine, registry);
      
      expect(processed).toBe(0);
      
      const pending = await dbClient.findPendingDelayedActionById((result as any).pendingId);
      expect(pending?.status).toBe("canceled");
    });
  });

  describe("riskMode: autonomous", () => {
    it("causes delayed tiered Action to run immediately, bypassing all tiering", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "autonomousDelayed",
        description: "Delayed action in autonomous mode",
        permission: "test.autonomous",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 5000,
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.autonomous", result: "allow" });

      // Execute with autonomous riskMode
      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine, "autonomous");
      
      // Should execute immediately, not return delayed
      expect(result).toEqual({ result: { success: true }, eventId: expect.any(String) });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("causes irreversible tiered Action to run immediately, bypassing all tiering", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "autonomousIrreversible",
        description: "Irreversible action in autonomous mode",
        permission: "test.autonomous.irrev",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "irreversible",
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.autonomous.irrev", result: "allow" });

      // Execute with autonomous riskMode
      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine, "autonomous");
      
      // Should execute immediately
      expect(result).toEqual({ result: { success: true }, eventId: expect.any(String) });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("default riskMode is guarded", () => {
    it("explicitly tests default riskMode = guarded", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "defaultGuarded",
        description: "Action with delayed tier, no riskMode specified",
        permission: "test.default",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 5000,
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.default", result: "allow" });

      // Execute WITHOUT specifying riskMode (should default to "guarded")
      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine);
      
      // Should be delayed (guarded mode respects tier)
      expect((result as any).status).toBe("delayed");
      expect(handler).not.toHaveBeenCalled();
    });

    it("guarded mode with instant tier executes immediately", async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const action = defineAction({
        name: "guardedInstant",
        description: "Instant action in guarded mode",
        permission: "test.guarded.instant",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "instant",
        handler,
      });

      const dbClient = new InMemoryDbClient();
      const permissionEngine = new InMemoryPermissionEngine();
      permissionEngine.addRule({ actorType: "human", permissionKey: "test.guarded.instant", result: "allow" });

      // Execute with explicit guarded mode
      const result = await action.execute({ value: "test" }, makeCtx(), dbClient, permissionEngine, "guarded");
      
      expect(result).toEqual({ result: { success: true }, eventId: expect.any(String) });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});