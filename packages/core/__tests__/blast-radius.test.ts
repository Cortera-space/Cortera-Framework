import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionContainmentError,
  type ActionContext,
  type DbClient,
  type InsertActionEvent,
  withParent,
  getActorState,
  reviewContainedActor,
  checkActorContainment,
  checkBlastRadius,
} from "../src/index";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

class MockDbClient implements DbClient {
  public events: InsertActionEvent[] = [];
  private idMap = new Map<string, InsertActionEvent>();
  private actorStates = new Map<string, { actorId: string; workspaceId: string; status: string; containedAt: Date | null; containedReason: string | null; reviewedBy: string | null; reviewedAt: Date | null }>();

  async insertActionEvent(event: InsertActionEvent): Promise<{ id: string }> {
    const id = `event-${this.events.length + 1}`;
    const storedEvent = { ...event, _id: id } as InsertActionEvent & { _id: string };
    this.events.push(storedEvent);
    this.idMap.set(id, storedEvent);
    return { id };
  }

  async updateActionEvent(
    id: string,
    event: Partial<InsertActionEvent>
  ): Promise<void> {
    const existing = this.idMap.get(id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async insertActionApproval(_approval: InsertActionEvent): Promise<{ id: string }> {
    return { id: "approval-1" };
  }

  async updateActionApproval(_id: string, _event: Partial<InsertActionEvent>): Promise<void> {}

  async findPendingApprovals(): Promise<any[]> {
    return [];
  }

  async findAllPendingApprovals(): Promise<any[]> {
    return [];
  }

  async findApprovalById(_id: string): Promise<any | null> {
    return null;
  }

  async findEventById(id: string): Promise<any | null> {
    const stored = this.idMap.get(id);
    if (!stored) return null;
    return {
      id: stored._id,
      actionName: stored.actionName,
      parentEventId: stored.parentEventId,
      blastRadius: stored.blastRadius,
    };
  }

  async findActorState(actorId: string, workspaceId: string): Promise<any | null> {
    const key = `${actorId}:${workspaceId}`;
    const state = this.actorStates.get(key);
    if (!state) return null;
    return {
      actorId: state.actorId,
      workspaceId: state.workspaceId,
      status: state.status as any,
      containedAt: state.containedAt,
      containedReason: state.containedReason,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedAt,
    };
  }

  async upsertActorState(state: any): Promise<void> {
    const key = `${state.actorId}:${state.workspaceId}`;
    this.actorStates.set(key, {
      actorId: state.actorId,
      workspaceId: state.workspaceId,
      status: state.status,
      containedAt: state.containedAt,
      containedReason: state.containedReason,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedAt,
    });
  }

  findEventByActionName(actionName: string) {
    return this.events.find((e) => e.actionName === actionName);
  }

  getEventId(event: InsertActionEvent & { _id?: string }) {
    return event._id;
  }
}

describe("blast-radius", () => {
  it("action chain within blast radius proceeds normally", async () => {
    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      blastRadius: ["notes.*", "notifications.send"],
      handler: async (_input, _ctx) => {
        return { parent: _input.title };
      },
    });

    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "notifications.send",
      inputSchema: z.object({ message: z.string() }),
      handler: async (input) => ({ sent: true, message: input.message }),
    });

    const dbClient = new MockDbClient();

    const parentResult = await parent.execute(
      { title: "Hello" },
      makeCtx(),
      dbClient
    );
    expect(parentResult.result).toEqual({ parent: "Hello" });

    const childResult = await child.execute(
      { message: "World" },
      withParent(makeCtx(), parentResult.eventId),
      dbClient
    );
    expect(childResult.result).toEqual({ sent: true, message: "World" });
  });

  it("chain step exceeding blast radius is denied AND contains the actor", async () => {
    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      blastRadius: ["notes.*"],
      handler: async (_input, _ctx) => ({ parent: _input.title }),
    });

    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler: async (input) => ({ deleted: true, id: input.id }),
    });

    const dbClient = new MockDbClient();

    const parentResult = await parent.execute(
      { title: "Hello" },
      makeCtx(),
      dbClient
    );
    expect(parentResult.result).toEqual({ parent: "Hello" });

    await expect(
      child.execute(
        { id: "cust-1" },
        withParent(makeCtx(), parentResult.eventId),
        dbClient
      )
    ).rejects.toThrow(ActionContainmentError);

    const state = await getActorState(dbClient, makeCtx().actor, makeCtx().workspaceId);
    expect(state).toBeDefined();
    expect(state?.status).toBe("contained");

    const events = dbClient.events.filter((e) => e.actionName === "child");
    expect(events.length).toBeGreaterThanOrEqual(1);
    const containmentEvent = events.find((e) => e.actionName === "child");
    expect(containmentEvent?.permissionResult).toBe("deny");
    expect((containmentEvent?.error as any)?.code).toBe("BLAST_RADIUS_EXCEEDED");
  });

  it("once contained, ALL subsequent calls from that actor in that workspace deny immediately", async () => {
    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      blastRadius: ["notes.*"],
      handler: async (_input, _ctx) => ({ parent: _input.title }),
    });

    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler: async (_input) => ({ deleted: true }),
    });

    const unrelated = defineAction({
      name: "unrelated",
      description: "Unrelated action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      handler: async (_input) => ({ title: _input.title }),
    });

    const dbClient = new MockDbClient();

    const parentResult = await parent.execute(
      { title: "Hello" },
      makeCtx(),
      dbClient
    );

    await expect(
      child.execute(
        { id: "cust-1" },
        withParent(makeCtx(), parentResult.eventId),
        dbClient
      )
    ).rejects.toThrow(ActionContainmentError);

    await expect(
      unrelated.execute({ title: "Should be denied" }, makeCtx(), dbClient)
    ).rejects.toThrow(ActionContainmentError);
  });

  it("the SAME actor remains active in a different workspace after being contained in one", async () => {
    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      blastRadius: ["notes.*"],
      handler: async (_input) => ({ parent: _input.title }),
    });

    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler: async (_input) => ({ deleted: true }),
    });

    const dbClient = new MockDbClient();

    const ws1Ctx = makeCtx({ workspaceId: "ws-1" });
    const ws2Ctx = makeCtx({ workspaceId: "ws-2" });

    const parentResult = await parent.execute(
      { title: "Hello" },
      ws1Ctx,
      dbClient
    );

    await expect(
      child.execute(
        { id: "cust-1" },
        withParent(ws1Ctx, parentResult.eventId),
        dbClient
      )
    ).rejects.toThrow(ActionContainmentError);

    const ws1State = await getActorState(dbClient, ws1Ctx.actor, ws1Ctx.workspaceId);
    expect(ws1State?.status).toBe("contained");

    const ws2State = await getActorState(dbClient, ws2Ctx.actor, ws2Ctx.workspaceId);
    expect(ws2State).toBeNull();

    const ws2Result = await child.execute(
      { id: "cust-2" },
      ws2Ctx,
      dbClient
    );
    expect(ws2Result.result).toEqual({ deleted: true });
  });

  it("reviewContainedActor('lift') restores normal operation", async () => {
    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      blastRadius: ["notes.*"],
      handler: async (_input) => ({ parent: _input.title }),
    });

    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler: async (_input) => ({ deleted: true }),
    });

    const dbClient = new MockDbClient();

    const parentResult = await parent.execute(
      { title: "Hello" },
      makeCtx(),
      dbClient
    );

    await expect(
      child.execute(
        { id: "cust-1" },
        withParent(makeCtx(), parentResult.eventId),
        dbClient
      )
    ).rejects.toThrow(ActionContainmentError);

    await reviewContainedActor(dbClient, "user-1", "ws-1", "lift", "reviewer-1");

    const state = await getActorState(dbClient, makeCtx().actor, makeCtx().workspaceId);
    expect(state?.status).toBe("active");

    const childResult = await child.execute(
      { id: "cust-2" },
      makeCtx(),
      dbClient
    );
    expect(childResult.result).toEqual({ deleted: true });
  });

  it("reviewContainedActor('revoke') permanently blocks, and subsequent lift is rejected", async () => {
    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      blastRadius: ["notes.*"],
      handler: async (_input) => ({ parent: _input.title }),
    });

    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler: async (_input) => ({ deleted: true }),
    });

    const dbClient = new MockDbClient();

    const parentResult = await parent.execute(
      { title: "Hello" },
      makeCtx(),
      dbClient
    );

    await expect(
      child.execute(
        { id: "cust-1" },
        withParent(makeCtx(), parentResult.eventId),
        dbClient
      )
    ).rejects.toThrow(ActionContainmentError);

    await reviewContainedActor(dbClient, "user-1", "ws-1", "revoke", "reviewer-1");

    const state = await getActorState(dbClient, makeCtx().actor, makeCtx().workspaceId);
    expect(state?.status).toBe("revoked");

    await expect(
      child.execute(
        { id: "cust-2" },
        makeCtx(),
        dbClient
      )
    ).rejects.toThrow(ActionContainmentError);

    await expect(
      reviewContainedActor(dbClient, "user-1", "ws-1", "lift", "reviewer-1")
    ).rejects.toThrow(/cannot lift actor.*revoke/);

    const finalState = await getActorState(dbClient, makeCtx().actor, makeCtx().workspaceId);
    expect(finalState?.status).toBe("revoked");
  });
});
