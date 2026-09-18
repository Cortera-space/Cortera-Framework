import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  InMemoryDbClient,
  defineAction,
  computeOutputProvenance,
  resolveInputProvenance,
  recordOutputProvenance,
  type ActionContext,
  type DefinedAction,
} from "../src/index";

const mockContactResolver = {
  getContact: vi.fn().mockResolvedValue({
    channel: "email",
    destination: "admin@example.com",
  }),
};

describe("Provenance - computeOutputProvenance", () => {
  it("returns trusted when all inputs are trusted and no sanitizes flag", () => {
    const inputProvenance = new Map<string, "trusted" | "untrusted-external">([
      ["field1", "trusted"],
      ["field2", "trusted"],
    ]);

    const result = computeOutputProvenance(inputProvenance, false);
    expect(result).toBe("trusted");
  });

  it("returns untrusted-external when any input is untrusted and no sanitizes flag", () => {
    const inputProvenance = new Map<string, "trusted" | "untrusted-external">([
      ["field1", "trusted"],
      ["field2", "untrusted-external"],
    ]);

    const result = computeOutputProvenance(inputProvenance, false);
    expect(result).toBe("untrusted-external");
  });

  it("returns untrusted-external when all inputs are untrusted and no sanitizes flag", () => {
    const inputProvenance = new Map<string, "trusted" | "untrusted-external">([
      ["field1", "untrusted-external"],
      ["field2", "untrusted-external"],
    ]);

    const result = computeOutputProvenance(inputProvenance, false);
    expect(result).toBe("untrusted-external");
  });

  it("returns trusted when sanitizes is true regardless of input taint", () => {
    const inputProvenance = new Map<string, "trusted" | "untrusted-external">([
      ["field1", "untrusted-external"],
      ["field2", "untrusted-external"],
    ]);

    const result = computeOutputProvenance(inputProvenance, true);
    expect(result).toBe("trusted");
  });

  it("returns trusted for empty input provenance (no inputs)", () => {
    const inputProvenance = new Map<string, "trusted" | "untrusted-external">();

    const result = computeOutputProvenance(inputProvenance, false);
    expect(result).toBe("trusted");
  });
});

describe("Provenance - InMemoryDbClient integration", () => {
  let db: InMemoryDbClient;
  let ctx: ActionContext;

  beforeEach(() => {
    db = new InMemoryDbClient();
    ctx = {
      actor: { actorType: "agent", actorId: "test-agent" },
      workspaceId: "test-workspace",
    };
    (globalThis as any).__TERA_CONTACT_RESOLVER__ = mockContactResolver;
  });

  const createTestAction = (name: string, sanitizes = false): DefinedAction<any, any> =>
    defineAction({
      name,
      description: `Test action ${name}`,
      permission: "test.permission",
      inputSchema: z.object({ value: z.string() }),
      sanitizes,
      handler: async (input) => ({ result: input.value }),
    });

  // Helper to execute in autonomous mode to bypass taint enforcement
  const executeAutonomous = async (action: DefinedAction<any, any>, input: unknown, ctx: ActionContext, db: InMemoryDbClient) => {
    return action.execute(input, ctx, db, undefined, { riskMode: "autonomous" });
  };

  it("Action with all-trusted inputs and no sanitizes produces trusted output", async () => {
    const action = createTestAction("trustedAction", false);

    await action.execute({ value: "hello" }, ctx, db);

    const trace = await db.getProvenanceTrace(db.events[0].id);
    expect(trace).not.toBeNull();
    expect(trace!.outputLabel).toBe("trusted");
  });

  it("Action with untrusted input and no sanitizes produces untrusted output", async () => {
    // First, create an untrusted source event manually
    const sourceEventId = "source-event-1";
    await db.insertDataProvenance({
      eventId: sourceEventId,
      fieldPath: "output",
      label: "untrusted-external",
      sourceEventId: null,
    });

    // Now execute an action that uses the source event as parent
    const action = createTestAction("untrustedAction", false);
    const childCtx = { ...ctx, parentEventId: sourceEventId };

    // Use autonomous mode to bypass taint enforcement for this provenance test
    await executeAutonomous(action, { value: "from untrusted" }, childCtx, db);

    const trace = await db.getProvenanceTrace(db.events[0].id);
    expect(trace).not.toBeNull();
    expect(trace!.outputLabel).toBe("untrusted-external");
    expect(trace!.trace.length).toBeGreaterThan(0);
  });

  it("Action with sanitizes: true produces trusted output regardless of input taint", async () => {
    // Create an untrusted source event
    const sourceEventId = "source-event-1";
    await db.insertDataProvenance({
      eventId: sourceEventId,
      fieldPath: "output",
      label: "untrusted-external",
      sourceEventId: null,
    });

    // Execute sanitizing action
    const action = createTestAction("sanitizingAction", true);
    const childCtx = { ...ctx, parentEventId: sourceEventId };

    await action.execute({ value: "from untrusted but sanitized" }, childCtx, db);

    const trace = await db.getProvenanceTrace(db.events[0].id);
    expect(trace).not.toBeNull();
    expect(trace!.outputLabel).toBe("trusted");
    // The trace should still show the untrusted source
    const hasUntrustedInTrace = trace!.trace.some((t) => t.label === "untrusted-external");
    expect(hasUntrustedInTrace).toBe(true);
  });

  it("Three-hop chain correctly propagates untrusted without manual redeclaration", async () => {
    const actionA = createTestAction("actionA", false);
    const actionB = createTestAction("actionB", false);
    const actionC = createTestAction("actionC", false);

    // Action A: source is untrusted (simulate tool output)
    await db.insertDataProvenance({
      eventId: "tool-output-event",
      fieldPath: "output",
      label: "untrusted-external",
      sourceEventId: null,
    });

    const resultA = await executeAutonomous(actionA, { value: "A" }, { ...ctx, parentEventId: "tool-output-event" }, db);
    const resultB = await executeAutonomous(actionB, { value: "B" }, { ...ctx, parentEventId: resultA.eventId }, db);
    const resultC = await executeAutonomous(actionC, { value: "C" }, { ...ctx, parentEventId: resultB.eventId }, db);

    // Check C's output is untrusted
    const traceC = await db.getProvenanceTrace(resultC.eventId);
    expect(traceC).not.toBeNull();
    expect(traceC!.outputLabel).toBe("untrusted-external");

    // Trace should show the chain: tool-output -> A -> B -> C
    const traceActionNames = traceC!.trace.map((t) => t.actionName);
    expect(traceActionNames).toContain("actionA");
    expect(traceActionNames).toContain("actionB");
    expect(traceActionNames).toContain("actionC");
  });

  it("Chain with sanitizing action in middle cleans taint for downstream", async () => {
    const actionA = createTestAction("actionA", false);
    const actionB = createTestAction("actionB", true); // sanitizes
    const actionC = createTestAction("actionC", false);

    // Action A: source is untrusted
    await db.insertDataProvenance({
      eventId: "tool-output-event",
      fieldPath: "output",
      label: "untrusted-external",
      sourceEventId: null,
    });

    const resultA = await executeAutonomous(actionA, { value: "A" }, { ...ctx, parentEventId: "tool-output-event" }, db);
    const resultB = await executeAutonomous(actionB, { value: "B" }, { ...ctx, parentEventId: resultA.eventId }, db);
    const resultC = await executeAutonomous(actionC, { value: "C" }, { ...ctx, parentEventId: resultB.eventId }, db);

    // Check B's output is trusted (sanitized)
    const traceB = await db.getProvenanceTrace(resultB.eventId);
    expect(traceB!.outputLabel).toBe("trusted");

    // Check C's output is trusted (inherits from B's trusted output)
    const traceC = await db.getProvenanceTrace(resultC.eventId);
    expect(traceC!.outputLabel).toBe("trusted");

    // But trace should still show original untrusted source
    const traceA = await db.getProvenanceTrace(resultA.eventId);
    expect(traceA!.outputLabel).toBe("untrusted-external");

    const traceCEntries = traceC!.trace.map((t) => t.actionName);
    expect(traceCEntries).toContain("actionA");
    expect(traceCEntries).toContain("actionB");
    expect(traceCEntries).toContain("actionC");
  });

  it("getProvenanceTrace correctly reconstructs taint history across multi-hop chain", async () => {
    const actionA = createTestAction("actionA", false);
    const actionB = createTestAction("actionB", false);
    const actionC = createTestAction("actionC", false);

    await db.insertDataProvenance({
      eventId: "tool-output-event",
      fieldPath: "output",
      label: "untrusted-external",
      sourceEventId: null,
    });

    const resultA = await executeAutonomous(actionA, { value: "A" }, { ...ctx, parentEventId: "tool-output-event" }, db);
    const resultB = await executeAutonomous(actionB, { value: "B" }, { ...ctx, parentEventId: resultA.eventId }, db);
    const resultC = await executeAutonomous(actionC, { value: "C" }, { ...ctx, parentEventId: resultB.eventId }, db);

    const traceC = await db.getProvenanceTrace(resultC.eventId);
    expect(traceC).not.toBeNull();

    // Trace should have entries for each step
    expect(traceC!.trace.length).toBeGreaterThanOrEqual(3);

    // Should show the original untrusted source
    const hasToolOutput = traceC!.trace.some((t) => t.eventId === "tool-output-event");
    expect(hasToolOutput).toBe(true);

    // Should show all three actions
    const actionsInTrace = traceC!.trace.filter((t) => ["actionA", "actionB", "actionC"].includes(t.actionName));
    expect(actionsInTrace.length).toBe(3);
  });

  it("returns null for non-existent event", async () => {
    const trace = await db.getProvenanceTrace("non-existent");
    expect(trace).toBeNull();
  });

  it("resolveInputProvenance returns trusted for all fields when no parent", async () => {
    const provenance = await resolveInputProvenance(db, undefined, { field1: "value1", field2: "value2" });
    expect(provenance.get("field1")).toBe("trusted");
    expect(provenance.get("field2")).toBe("trusted");
  });

  it("resolveInputProvenance returns parent output label for all fields", async () => {
    await db.insertDataProvenance({
      eventId: "parent-event",
      fieldPath: "output",
      label: "untrusted-external",
      sourceEventId: null,
    });

    const provenance = await resolveInputProvenance(db, "parent-event", { field1: "value1", field2: "value2" });
    expect(provenance.get("field1")).toBe("untrusted-external");
    expect(provenance.get("field2")).toBe("untrusted-external");
  });

  it("recordOutputProvenance creates provenance record", async () => {
    const eventId = "test-event";
    await db.insertActionEvent({
      actionName: "test",
      actorType: "agent",
      actorId: "test-agent",
      input: {},
      output: null,
      error: null,
      permissionResult: "allow",
      approvedBy: null,
      parentEventId: null,
      startedAt: new Date(),
      durationMs: null,
      workspaceId: "test-workspace",
      blastRadius: null,
      dryRun: false,
    });

    await recordOutputProvenance(db, eventId, "untrusted-external", "parent-event");

    const provenance = await db.findDataProvenanceByEventId(eventId);
    expect(provenance.length).toBe(1);
    expect(provenance[0].label).toBe("untrusted-external");
    expect(provenance[0].sourceEventId).toBe("parent-event");
  });
});