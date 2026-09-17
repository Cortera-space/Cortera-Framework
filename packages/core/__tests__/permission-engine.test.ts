import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionRegistry,
  ActionPermissionError,
  ActionPendingApprovalError,
  InMemoryPermissionEngine,
  resolveApproval,
  expirePendingApprovals,
  type ActionContext,
  type DbClient,
  type InsertActionEvent,
  type InsertActionApproval,
  type ActionApproval,
  type DataProvenance,
} from "../src/index";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

class MockDbClient implements DbClient {
  public events: InsertActionEvent[] = [];
  public approvals: InsertActionApproval[] = [];
  private idMap = new Map<string, InsertActionEvent>();
  private approvalIdMap = new Map<string, InsertActionApproval>();
  private provenances: (DataProvenance & { id: string })[] = [];

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

  async insertActionApproval(approval: InsertActionApproval): Promise<{ id: string }> {
    const id = `approval-${this.approvals.length + 1}`;
    const storedApproval = { ...approval, _id: id } as InsertActionApproval & { _id: string };
    this.approvals.push(storedApproval);
    this.approvalIdMap.set(id, storedApproval);
    return { id };
  }

  async updateActionApproval(
    id: string,
    event: Partial<InsertActionApproval>
  ): Promise<void> {
    const existing = this.approvalIdMap.get(id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async findPendingApprovals(_workspaceId: string): Promise<ActionApproval[]> {
    return this.approvals
      .filter((a) => a.status === "pending")
      .map((a) => ({
        id: (a as any)._id,
        actionEventId: a.actionEventId,
        actionName: a.actionName,
        input: a.input,
        actorType: a.actorType,
        actorId: a.actorId,
        workspaceId: a.workspaceId,
        status: a.status as ActionApproval["status"],
        requestedAt: a.requestedAt,
        expiresAt: a.expiresAt,
        resolvedAt: a.resolvedAt,
        approvedBy: a.approvedBy,
      }));
  }

  async findAllPendingApprovals(): Promise<ActionApproval[]> {
    return this.findPendingApprovals("");
  }

  async findApprovalById(id: string): Promise<ActionApproval | null> {
    const approval = this.approvalIdMap.get(id);
    if (!approval) {
      return null;
    }
    return {
      id: (approval as any)._id,
      actionEventId: approval.actionEventId,
      actionName: approval.actionName,
      input: approval.input,
      actorType: approval.actorType,
      actorId: approval.actorId,
      workspaceId: approval.workspaceId,
      status: approval.status as ActionApproval["status"],
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
      resolvedAt: approval.resolvedAt,
      approvedBy: approval.approvedBy,
    };
  }

  findEventByActionName(actionName: string) {
    return this.events.find((e) => e.actionName === actionName);
  }

  async findEventById(_id: string): Promise<any | null> { return null; }
  async findActorState(_actorId: string, _workspaceId: string): Promise<any | null> { return null; }
  async upsertActorState(_state: any): Promise<void> {}

  async insertDataProvenance(provenance: any): Promise<{ id: string }> {
    const id = `prov-${this.provenances.length + 1}`;
    this.provenances.push({ ...provenance, id, createdAt: new Date() });
    return { id };
  }

  async findDataProvenanceByIds(ids: string[]): Promise<DataProvenance[]> {
    return this.provenances.filter((p) => ids.includes(p.id));
  }

  async findDataProvenanceByContentHash(_contentHash: string, _workspaceId: string): Promise<DataProvenance | null> {
    return null;
  }
}

describe("PermissionEngine", () => {
  it("deny blocks handler execution and logs correctly", async () => {
    const engine = new InMemoryPermissionEngine();
    engine.addRule({ permissionKey: "secret.read", result: "deny" });

    const handler = vi.fn();
    const dbClient = new MockDbClient();

    const action = defineAction({
      name: "secret",
      description: "Secret action",
      permission: "secret.read",
      inputSchema: z.object({}),
      handler,
    });

    await expect(
      action.execute({}, makeCtx(), dbClient, engine)
    ).rejects.toThrow(ActionPermissionError);
    expect(handler).not.toHaveBeenCalled();

    const event = dbClient.findEventByActionName("secret");
    expect(event).toBeDefined();
    expect(event?.permissionResult).toBe("deny");
    expect(event?.error).toBe("actor lacks permission: secret.read");
  });

  it("allow runs handler as before", async () => {
    const engine = new InMemoryPermissionEngine();
    engine.addRule({ permissionKey: "notes.create", result: "allow" });

    const dbClient = new MockDbClient();
    const action = defineAction({
      name: "createNote",
      description: "Creates a note",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      handler: async (input) => ({ id: "note-1", ...input }),
    });

    const result = await action.execute(
      { title: "Hello" },
      makeCtx(),
      dbClient,
      engine
    );
    expect(result.result).toEqual({ id: "note-1", title: "Hello" });

    const event = dbClient.findEventByActionName("createNote");
    expect(event?.permissionResult).toBe("allow");
  });

  it("default-deny when no rule matches", async () => {
    const engine = new InMemoryPermissionEngine();
    const handler = vi.fn();
    const dbClient = new MockDbClient();

    const action = defineAction({
      name: "unknown",
      description: "Unknown action",
      permission: "unknown.op",
      inputSchema: z.object({}),
      handler,
    });

    await expect(
      action.execute({}, makeCtx(), dbClient, engine)
    ).rejects.toThrow(ActionPermissionError);
    expect(handler).not.toHaveBeenCalled();

    const event = dbClient.findEventByActionName("unknown");
    expect(event?.permissionResult).toBe("deny");
  });

  it("approval_required creates a pending approval and returns approvalId", async () => {
    const engine = new InMemoryPermissionEngine();
    engine.addRule({ permissionKey: "customers.delete", result: "approval_required" });

    const handler = vi.fn();
    const dbClient = new MockDbClient();

    const action = defineAction({
      name: "deleteCustomer",
      description: "Deletes a customer",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler,
      approvalTtlMs: 1000,
    });

    await expect(
      action.execute({ id: "cust-1" }, makeCtx(), dbClient, engine)
    ).rejects.toThrow(ActionPendingApprovalError);

    const approvalError = (await action.execute({ id: "cust-1" }, makeCtx(), dbClient, engine).catch((e) => e)) as ActionPendingApprovalError;
    expect(approvalError.approvalId).toBeDefined();
    expect(approvalError.approvalId).toMatch(/approval-/);

    const event = dbClient.findEventByActionName("deleteCustomer");
    expect(event?.permissionResult).toBe("approval_required");

    const approval = dbClient.approvals.find((a) => a.status === "pending");
    expect(approval).toBeDefined();
    expect(approval?.actionName).toBe("deleteCustomer");
    expect(approval?.input).toEqual({ id: "cust-1" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("resolveApproval", () => {
  it("approved runs the original handler and updates records correctly", async () => {
    const engine = new InMemoryPermissionEngine();
    engine.addRule({ permissionKey: "customers.delete", result: "approval_required" });

    const dbClient = new MockDbClient();
    const registry = new ActionRegistry();

    const action = defineAction({
      name: "deleteCustomer",
      description: "Deletes a customer",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler: async (input) => ({ deleted: true, id: input.id }),
    });

    registry.register(action);

    const approvalError = (await action.execute({ id: "cust-1" }, makeCtx(), dbClient, engine).catch(
      (e) => e
    )) as ActionPendingApprovalError;

    await resolveApproval(approvalError.approvalId, "approved", "approver-1", dbClient, registry);

    const event = dbClient.findEventByActionName("deleteCustomer");
    expect(event?.permissionResult).toBe("allow");
    expect(event?.approvedBy).toBe("approver-1");
    expect(event?.output).toEqual({ deleted: true, id: "cust-1" });

    const approval = dbClient.approvals.find((a) => a.status === "approved");
    expect(approval).toBeDefined();
    expect(approval?.approvedBy).toBe("approver-1");
  });

  it("rejected does not run handler", async () => {
    const engine = new InMemoryPermissionEngine();
    engine.addRule({ permissionKey: "customers.delete", result: "approval_required" });

    const handler = vi.fn();
    const dbClient = new MockDbClient();
    const registry = new ActionRegistry();

    const action = defineAction({
      name: "deleteCustomer",
      description: "Deletes a customer",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler,
    });

    registry.register(action);

    const approvalError = (await action.execute({ id: "cust-1" }, makeCtx(), dbClient, engine).catch(
      (e) => e
    )) as ActionPendingApprovalError;

    await resolveApproval(approvalError.approvalId, "rejected", "approver-1", dbClient, registry);

    expect(handler).not.toHaveBeenCalled();

    const event = dbClient.findEventByActionName("deleteCustomer");
    expect(event?.permissionResult).toBe("deny");
    expect(event?.error).toBe("approval_rejected");

    const approval = dbClient.approvals.find((a) => a.status === "rejected");
    expect(approval).toBeDefined();
    expect(approval?.approvedBy).toBe("approver-1");
  });
});

describe("expirePendingApprovals", () => {
  it("expires past-TTL approvals and updates linked events", async () => {
    const dbClient = new MockDbClient();

    const pastEvent: InsertActionEvent = {
      actionName: "oldAction",
      actorType: "human",
      actorId: "user-1",
      input: {},
      output: null,
      error: null,
      permissionResult: "approval_required",
      approvedBy: null,
      parentEventId: null,
      startedAt: new Date(),
      durationMs: null,
      workspaceId: "ws-1",
    };
    const { id: pastEventId } = await dbClient.insertActionEvent(pastEvent);

    const futureEvent: InsertActionEvent = {
      actionName: "newAction",
      actorType: "human",
      actorId: "user-1",
      input: {},
      output: null,
      error: null,
      permissionResult: "approval_required",
      approvedBy: null,
      parentEventId: null,
      startedAt: new Date(),
      durationMs: null,
      workspaceId: "ws-1",
    };
    const { id: futureEventId } = await dbClient.insertActionEvent(futureEvent);

    const pastApproval: InsertActionApproval = {
      actionEventId: pastEventId,
      actionName: "oldAction",
      input: {},
      actorType: "human",
      actorId: "user-1",
      workspaceId: "ws-1",
      status: "pending",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
      resolvedAt: null,
      approvedBy: null,
    };
    await dbClient.insertActionApproval(pastApproval);

    const futureApproval: InsertActionApproval = {
      actionEventId: futureEventId,
      actionName: "newAction",
      input: {},
      actorType: "human",
      actorId: "user-1",
      workspaceId: "ws-1",
      status: "pending",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 100000),
      resolvedAt: null,
      approvedBy: null,
    };
    await dbClient.insertActionApproval(futureApproval);

    await expirePendingApprovals(dbClient);

    const updatedPastEvent = dbClient.events.find((e) => e.actionName === "oldAction");
    const updatedFutureEvent = dbClient.events.find((e) => e.actionName === "newAction");

    expect(updatedPastEvent?.permissionResult).toBe("deny");
    expect(updatedPastEvent?.error).toBe("approval_expired");

    expect(updatedFutureEvent?.permissionResult).toBe("approval_required");

    const expiredApproval = dbClient.approvals.find((a) => a.actionName === "oldAction");
    const pendingApproval = dbClient.approvals.find((a) => a.actionName === "newAction");

    expect(expiredApproval?.status).toBe("expired");
    expect(pendingApproval?.status).toBe("pending");
  });
});
