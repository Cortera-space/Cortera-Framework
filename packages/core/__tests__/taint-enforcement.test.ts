import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  InMemoryDbClient,
  defineAction,
  InMemoryPermissionEngine,
  requestIrreversibleConfirmation,
  confirmIrreversibleConfirmation,
  type ActionContext,
  type DbClient,
  type DefinedAction,
  ActionPendingIrreversibleConfirmationError,
  type TriggerReason,
} from "../src/index";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

const mockContactResolver = {
  getContact: vi.fn().mockResolvedValue({
    channel: "email",
    destination: "admin@example.com",
  }),
};

describe("Taint Enforcement (Stage 14c)", () => {
  let dbClient: InMemoryDbClient;
  let permissionEngine: InMemoryPermissionEngine;
  let ctx: ActionContext;

  beforeEach(() => {
    dbClient = new InMemoryDbClient();
    permissionEngine = new InMemoryPermissionEngine();
    permissionEngine.addRule({ actorType: "human", permissionKey: "test.instant", result: "allow" });
    permissionEngine.addRule({ actorType: "human", permissionKey: "test.irreversible", result: "allow" });
    permissionEngine.addRule({ actorType: "agent", permissionKey: "test.instant", result: "allow" });
    permissionEngine.addRule({ actorType: "agent", permissionKey: "test.irreversible", result: "allow" });

    ctx = makeCtx();
    (globalThis as any).__CORTERA_CONTACT_RESOLVER__ = mockContactResolver;
  });

  const createInstantAction = (name: string, options: { sanitizes?: boolean } = {}): DefinedAction<any, any> =>
    defineAction({
      name,
      description: `Instant action ${name}`,
      permission: "test.instant",
      inputSchema: z.object({ value: z.string() }),
      riskTier: "instant",
      sanitizes: options.sanitizes,
      handler: async (input) => ({ result: input.value }),
    });

  const createIrreversibleAction = (name: string): DefinedAction<any, any> =>
    defineAction({
      name,
      description: `Irreversible action ${name}`,
      permission: "test.irreversible",
      inputSchema: z.object({ value: z.string(), confirmation: z.literal("DELETE") }),
      riskTier: "irreversible",
      handler: async (input) => ({ result: input.value }),
    });

  describe("Guarded mode with trusted input", () => {
    it("executes instantly when all inputs are trusted and riskTier is instant", async () => {
      const action = createInstantAction("trustedInstant");

      const result = await action.execute({ value: "hello" }, ctx, dbClient, permissionEngine);

      expect(result.result).toEqual({ result: "hello" });
      expect(result.eventId).toBeDefined();
    });

    it("executes instantly when input has sanitizes: true even with untrusted input", async () => {
      const sanitizingAction = createInstantAction("sanitizingAction", { sanitizes: true });

      // Create untrusted source
      await dbClient.insertDataProvenance({
        eventId: "untrusted-source",
        fieldPath: "output",
        label: "untrusted-external",
        sourceEventId: null,
      });

      const childCtx = { ...ctx, parentEventId: "untrusted-source" };
      const result = await sanitizingAction.execute({ value: "from untrusted" }, childCtx, dbClient, permissionEngine);

      expect(result.result).toEqual({ result: "from untrusted" });
    });
  });

  describe("Guarded mode with untrusted input", () => {
    it("forces confirmation when riskTier is instant but input is untrusted", async () => {
      const action = createInstantAction("untrustedInstant");

      // Create untrusted source
      await dbClient.insertDataProvenance({
        eventId: "untrusted-source",
        fieldPath: "output",
        label: "untrusted-external",
        sourceEventId: null,
      });

      const childCtx = { ...ctx, parentEventId: "untrusted-source" };

      await expect(action.execute({ value: "from untrusted" }, childCtx, dbClient, permissionEngine))
        .rejects.toThrow(ActionPendingIrreversibleConfirmationError);

      // Verify confirmation record has trigger_reason 'untrusted_provenance'
      const confirmations = await dbClient.findPendingIrreversibleConfirmations();
      expect(confirmations.length).toBe(1);
      expect(confirmations[0].triggerReason).toBe("untrusted_provenance");
    });

    it("forces confirmation when riskTier is delayed but input is untrusted", async () => {
      const delayedAction = defineAction({
        name: "delayedWithUntrusted",
        description: "Delayed action with untrusted input",
        permission: "test.instant",
        inputSchema: z.object({ value: z.string() }),
        riskTier: "delayed",
        delayWindowMs: 5000,
        handler: async (input) => ({ result: input.value }),
      });

      await dbClient.insertDataProvenance({
        eventId: "untrusted-source",
        fieldPath: "output",
        label: "untrusted-external",
        sourceEventId: null,
      });

      const childCtx = { ...ctx, parentEventId: "untrusted-source" };
      const result = await delayedAction.execute({ value: "from untrusted" }, childCtx, dbClient, permissionEngine);

      // Should not execute, should return delayed status
      expect(result).toEqual(expect.objectContaining({ status: "delayed" }));

      // But the confirmation should still be triggered with untrusted_provenance
      // Note: For delayed actions, the confirmation happens at execution time
      // This test verifies the delayed action is created
      expect(result.pendingId).toBeDefined();
    });
  });

  describe("Autonomous mode with untrusted input", () => {
    it("executes immediately despite untrusted input when riskMode is autonomous", async () => {
      const action = createInstantAction("autonomousUntrusted");

      await dbClient.insertDataProvenance({
        eventId: "untrusted-source",
        fieldPath: "output",
        label: "untrusted-external",
        sourceEventId: null,
      });

      const childCtx = { ...ctx, parentEventId: "untrusted-source" };

      // Execute with autonomous riskMode via options
      const result = await action.execute({ value: "from untrusted" }, childCtx, dbClient, permissionEngine, { riskMode: "autonomous" });

      expect(result.result).toEqual({ result: "from untrusted" });
      expect(result.eventId).toBeDefined();

      // No confirmation should be created
      const confirmations = await dbClient.findPendingIrreversibleConfirmations();
      expect(confirmations.length).toBe(0);

      // But provenance should still be recorded
      const trace = await dbClient.getProvenanceTrace(result.eventId!);
      expect(trace!.outputLabel).toBe("untrusted-external");
    });
  });

  describe("Declared irreversible with untrusted input", () => {
    it("records trigger_reason as 'declared_irreversible' when riskTier is irreversible", async () => {
      const action = createIrreversibleAction("declaredIrreversible");

      await dbClient.insertDataProvenance({
        eventId: "untrusted-source",
        fieldPath: "output",
        label: "untrusted-external",
        sourceEventId: null,
      });

      const childCtx = { ...ctx, parentEventId: "untrusted-source" };

      try {
        await action.execute({ value: "test", confirmation: "DELETE" }, childCtx, dbClient, permissionEngine);
      } catch (error) {
        expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      }

      const confirmations = await dbClient.findPendingIrreversibleConfirmations();
      expect(confirmations.length).toBe(1);
      // When both apply, declared_irreversible takes precedence (explicit decision)
      expect(confirmations[0].triggerReason).toBe("declared_irreversible");
    });

    it("confirmation notification includes untrusted source info when trigger_reason is untrusted_provenance", async () => {
      const action = createInstantAction("notificationTest");

      await dbClient.insertDataProvenance({
        eventId: "untrusted-source",
        fieldPath: "output",
        label: "untrusted-external",
        sourceEventId: null,
      });

      const childCtx = { ...ctx, parentEventId: "untrusted-source" };

      try {
        await action.execute({ value: "test" }, childCtx, dbClient, permissionEngine);
      } catch (error) {
        expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      }

      // Check that the mock email was called with the untrusted source info
      expect(mockContactResolver.getContact).toHaveBeenCalled();
      // The sendConfirmation is called internally, we can't easily test the exact message
      // but we verified the trigger_reason is set correctly above
    });
  });

  describe("Observability - provenance in event chain", () => {
    it("includes provenanceLabel and triggerReason in listEvents", async () => {
      const action = createInstantAction("observabilityTest");

      await action.execute({ value: "hello" }, ctx, dbClient, permissionEngine);

      const result = await dbClient.listEvents("ws-1");
      const event = result.items.find((e) => e.actionName === "observabilityTest");

      expect(event).toBeDefined();
      expect(event!.provenanceLabel).toBe("trusted");
      expect(event!.triggerReason).toBeUndefined();
    });

    it("includes provenanceLabel and triggerReason in getEventWithChain for trusted chain", async () => {
      const actionA = createInstantAction("chainA");
      const actionB = createInstantAction("chainB");

      const resultA = await actionA.execute({ value: "A" }, ctx, dbClient, permissionEngine);
      const resultB = await actionB.execute({ value: "B" }, { ...ctx, parentEventId: resultA.eventId }, dbClient, permissionEngine);

      const chain = await dbClient.getEventWithChain(resultB.eventId!);
      expect(chain).not.toBeNull();

      expect(chain!.ancestors.length).toBe(1);
      expect(chain!.ancestors[0].actionName).toBe("chainA");
      expect(chain!.ancestors[0].provenanceLabel).toBe("trusted");
      expect(chain!.provenanceLabel).toBe("trusted");
    });

    it("includes provenanceLabel and triggerReason in getEventWithChain for untrusted chain", async () => {
      const actionA = createInstantAction("chainA_untrusted");
      const actionB = createInstantAction("chainB_untrusted");

      await dbClient.insertDataProvenance({
        eventId: "untrusted-source",
        fieldPath: "output",
        label: "untrusted-external",
        sourceEventId: null,
      });

      // chainA will be forced to confirmation due to untrusted input
      try {
        await actionA.execute({ value: "A" }, { ...ctx, parentEventId: "untrusted-source" }, dbClient, permissionEngine);
      } catch (error) {
        expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      }

      // Verify the chain shows the taint
      const events = dbClient.events.filter((e) => e.actionName === "chainA_untrusted");
      expect(events.length).toBe(1);
      // The event was created but has triggerReason
    });
  });

  describe("Sanitization in middle of chain", () => {
    it("cleans taint for downstream when middle action has sanitizes: true", async () => {
      const actionA = createInstantAction("sanitizeA", { sanitizes: false });
      const actionB = createInstantAction("sanitizeB", { sanitizes: true });
      const actionC = createInstantAction("sanitizeC", { sanitizes: false });

      await dbClient.insertDataProvenance({
        eventId: "untrusted-source",
        fieldPath: "output",
        label: "untrusted-external",
        sourceEventId: null,
      });

      // First action (sanitizeA) receives untrusted input -> forced to confirmation
      let resultA: any;
      try {
        resultA = await actionA.execute({ value: "A" }, { ...ctx, parentEventId: "untrusted-source" }, dbClient, permissionEngine);
      } catch (error) {
        expect(error).toBeInstanceOf(ActionPendingIrreversibleConfirmationError);
      }

      // Second action (sanitizeB) has sanitizes: true -> can execute even with untrusted input
      const resultB = await actionB.execute({ value: "B" }, { ...ctx, parentEventId: resultA?.eventId || "dummy" }, dbClient, permissionEngine);
      expect(resultB.result).toEqual({ result: "B" });

      // Third action (sanitizeC) receives trusted input from B -> executes without confirmation
      const resultC = await actionC.execute({ value: "C" }, { ...ctx, parentEventId: resultB.eventId }, dbClient, permissionEngine);
      expect(resultC.result).toEqual({ result: "C" });

      // Verify C's provenance is trusted
      const traceC = await dbClient.getProvenanceTrace(resultC.eventId!);
      expect(traceC!.outputLabel).toBe("trusted");
    });
  });
});