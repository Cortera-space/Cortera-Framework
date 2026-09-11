import { z } from "zod";
import {
  ActionRegistry,
  defineAction,
  InMemoryPermissionEngine,
  type DbClient,
  type InsertActionEvent,
  type InsertActionApproval,
  type ActionApproval,
  type ActionEventLookup,
  type ActorState,
  type InsertActorState,
  type ActionEventFull,
  type EventTreeNode,
  type EventWithChain,
  type ListEventsFilters,
  type ListEventsResult,
} from "@tera/core";
import { resolveActorFromRequest, type ApiKeyMapping } from "@tera/adapter-next";

export const registry = new ActionRegistry();

export const permissionEngine = new InMemoryPermissionEngine();
permissionEngine.addRule({ actorType: "human", permissionKey: "notes.create", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "notes.create", result: "allow" });
permissionEngine.addRule({ actorType: "human", permissionKey: "notes.read", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "notes.read", result: "allow" });
permissionEngine.addRule({ actorType: "human", permissionKey: "notifications.send", result: "deny" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "notifications.send", result: "allow" });
permissionEngine.addRule({ actorType: "human", permissionKey: "customers.delete", result: "approval_required" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "customers.delete", result: "approval_required" });

class InMemoryDbClient implements DbClient {
  public events: Array<InsertActionEvent & { id: string }> = [];
  public actorStates = new Map<string, ActorState>();
  private approvals: Array<ActionApproval> = [];

  async insertActionEvent(event: InsertActionEvent): Promise<{ id: string }> {
    const id = `event-${this.events.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.events.push({ ...event, id } as InsertActionEvent & { id: string });
    return { id };
  }

  async updateActionEvent(id: string, event: Partial<InsertActionEvent>): Promise<void> {
    const existing = this.events.find((e) => e.id === id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async insertActionApproval(approval: InsertActionApproval): Promise<{ id: string }> {
    const id = `approval-${this.approvals.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: ActionApproval = {
      ...approval,
      id,
    };
    this.approvals.push(record);
    return { id };
  }

  async updateActionApproval(id: string, event: Partial<InsertActionApproval>): Promise<void> {
    const existing = this.approvals.find((a) => a.id === id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async findPendingApprovals(_workspaceId: string): Promise<ActionApproval[]> {
    return this.approvals.filter((a) => a.status === "pending");
  }

  async findAllPendingApprovals(): Promise<ActionApproval[]> {
    return this.approvals.filter((a) => a.status === "pending");
  }

  async findApprovalById(id: string): Promise<ActionApproval | null> {
    return this.approvals.find((a) => a.id === id) ?? null;
  }

  async findEventById(id: string): Promise<ActionEventLookup | null> {
    const event = this.events.find((e) => e.id === id);
    if (!event) return null;
    return {
      id: event.id,
      actionName: event.actionName,
      parentEventId: event.parentEventId,
      blastRadius: event.blastRadius,
    };
  }

  async findActorState(actorId: string, workspaceId: string): Promise<ActorState | null> {
    return this.actorStates.get(`${actorId}:${workspaceId}`) ?? null;
  }

  async upsertActorState(state: InsertActorState): Promise<void> {
    this.actorStates.set(`${state.actorId}:${state.workspaceId}`, {
      actorId: state.actorId,
      workspaceId: state.workspaceId,
      status: state.status,
      containedAt: state.containedAt,
      containedReason: state.containedReason,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedAt,
    });
  }

  async listEvents(
    workspaceId: string,
    filters: ListEventsFilters,
    limit: number,
    cursor?: { startedAt: Date; id: string }
  ): Promise<ListEventsResult> {
    let filtered = this.events.filter((e) => e.workspaceId === workspaceId);

    if (filters.actorType) {
      filtered = filtered.filter((e) => e.actorType === filters.actorType);
    }
    if (filters.actionName) {
      filtered = filtered.filter((e) => e.actionName === filters.actionName);
    }
    if (filters.permissionResult) {
      filtered = filtered.filter((e) => e.permissionResult === filters.permissionResult);
    }
    if (filters.from) {
      filtered = filtered.filter((e) => new Date(e.startedAt) >= filters.from!);
    }
    if (filters.to) {
      filtered = filtered.filter((e) => new Date(e.startedAt) <= filters.to!);
    }
    if (cursor) {
      const cursorDate = new Date(cursor.startedAt);
      filtered = filtered.filter((e) => {
        const rowDate = new Date(e.startedAt);
        return rowDate < cursorDate || (rowDate.getTime() === cursorDate.getTime() && e.id !== cursor.id);
      });
    }

    filtered.sort((a, b) => {
      const da = new Date(a.startedAt);
      const db2 = new Date(b.startedAt);
      if (da.getTime() !== db2.getTime()) return db2.getTime() - da.getTime();
      return b.id.localeCompare(a.id);
    });

    const page = filtered.slice(0, limit);
    const nextCursor =
      filtered.length > limit
        ? { startedAt: page[page.length - 1].startedAt, id: page[page.length - 1].id }
        : null;

    return {
      events: page.map((e) => ({
        eventId: e.id,
        actionName: e.actionName,
        actorType: e.actorType,
        actorId: e.actorId,
        permissionResult: e.permissionResult,
        status: e.status,
        input: e.input,
        output: e.output,
        error: e.error,
        parentEventId: e.parentEventId,
        createdAt: new Date(e.createdAt),
        updatedAt: new Date(e.updatedAt),
        startedAt: e.startedAt,
        durationMs: e.durationMs,
        workspaceId: e.workspaceId,
        blastRadius: e.blastRadius,
      })),
      nextCursor,
    };
  }

  async getEventWithChain(eventId: string): Promise<EventWithChain | null> {
    const focal = this.events.find((e) => e.id === eventId);
    if (!focal) return null;

    const focalFull: ActionEventFull = {
      eventId: focal.id,
      actionName: focal.actionName,
      actorType: focal.actorType,
      actorId: focal.actorId,
      permissionResult: focal.permissionResult,
      status: focal.status,
      input: focal.input,
      output: focal.output,
      error: focal.error,
      parentEventId: focal.parentEventId,
      createdAt: new Date(focal.createdAt),
      updatedAt: new Date(focal.updatedAt),
      startedAt: focal.startedAt,
      durationMs: focal.durationMs,
      workspaceId: focal.workspaceId,
      blastRadius: focal.blastRadius,
    };

    const ancestors: ActionEventFull[] = [];
    let currentParentId: string | null = focal.parentEventId;
    while (currentParentId) {
      const parent = this.events.find((e) => e.id === currentParentId);
      if (!parent) break;
      ancestors.push({
        eventId: parent.id,
        actionName: parent.actionName,
        actorType: parent.actorType,
        actorId: parent.actorId,
        permissionResult: parent.permissionResult,
        status: parent.status,
        input: parent.input,
        output: parent.output,
        error: parent.error,
        parentEventId: parent.parentEventId,
        createdAt: new Date(parent.createdAt),
        updatedAt: new Date(parent.updatedAt),
        startedAt: parent.startedAt,
        durationMs: parent.durationMs,
        workspaceId: parent.workspaceId,
        blastRadius: parent.blastRadius,
      });
      currentParentId = parent.parentEventId;
    }
    ancestors.reverse();

    const buildTree = (parentId: string): EventTreeNode[] => {
      const children = this.events.filter((e) => e.parentEventId === parentId);
      return children.map((child) => ({
        event: {
          eventId: child.id,
          actionName: child.actionName,
          actorType: child.actorType,
          actorId: child.actorId,
          permissionResult: child.permissionResult,
          status: child.status,
          input: child.input,
          output: child.output,
          error: child.error,
          parentEventId: child.parentEventId,
          createdAt: new Date(child.createdAt),
          updatedAt: new Date(child.updatedAt),
          startedAt: child.startedAt,
          durationMs: child.durationMs,
          workspaceId: child.workspaceId,
          blastRadius: child.blastRadius,
        },
        children: buildTree(child.id),
      }));
    };

    return {
      event: focalFull,
      ancestors,
      descendants: buildTree(focal.id),
    };
  }

  async listContainedActors(workspaceId: string): Promise<ActorState[]> {
    const contained: ActorState[] = [];
    for (const state of this.actorStates.values()) {
      if (state.workspaceId === workspaceId && state.status === "contained") {
        contained.push(state);
      }
    }
    contained.sort((a, b) => {
      const da = a.containedAt ? new Date(a.containedAt).getTime() : 0;
      const db2 = b.containedAt ? new Date(b.containedAt).getTime() : 0;
      return db2 - da;
    });
    return contained;
  }
}

export const dbClient = new InMemoryDbClient();

export const apiKeyMapping: Record<string, { actorId: string; actorType: "human" | "agent" | "system" }> = {
  "sk-agent-123": { actorId: "agent-1", actorType: "agent" },
  "sk-agent-456": { actorId: "agent-2", actorType: "agent" },
};

export const createNoteAction = defineAction({
  name: "createNote",
  description: "Creates a new note with a title and content",
  permission: "notes.create",
  inputSchema: z.object({
    title: z.string().min(1),
    content: z.string().min(1),
  }),
  handler: async (input) => {
    return { id: "note-" + Date.now(), ...input };
  },
});

export const restrictedNoteAction = defineAction({
  name: "restrictedNote",
  description: "Creates a note with a narrow blast radius",
  permission: "notes.create",
  inputSchema: z.object({
    title: z.string().min(1),
    content: z.string().min(1),
  }),
  blastRadius: ["notes.*"],
  handler: async (input) => {
    return { id: "note-" + Date.now(), ...input };
  },
});

export const notifyWatchersAction = defineAction({
  name: "notifyWatchers",
  description: "Notifies watchers about a new note",
  permission: "notifications.send",
  inputSchema: z.object({
    noteId: z.string(),
    title: z.string(),
  }),
  handler: async (input) => {
    return { notified: true, noteId: input.noteId };
  },
});

export const deleteAllCustomersAction = defineAction({
  name: "deleteAllCustomers",
  description: "Deletes all customers — outside notes blast radius",
  permission: "customers.delete",
  inputSchema: z.object({
    reason: z.string().optional(),
  }),
  handler: async (input) => {
    return { deleted: true, reason: input.reason };
  },
});

export const deleteCustomerAction = defineAction({
  name: "deleteCustomer",
  description: "Deletes a customer by ID",
  permission: "customers.delete",
  inputSchema: z.object({
    id: z.string(),
    reason: z.string().optional(),
  }),
  handler: async (input) => {
    return { deleted: true, customerId: input.id };
  },
  approvalTtlMs: 24 * 60 * 60 * 1000,
});

registry.register(createNoteAction);
registry.register(restrictedNoteAction);
registry.register(notifyWatchersAction);
registry.register(deleteAllCustomersAction);
registry.register(deleteCustomerAction);


export const defaultWorkspaceId = "default-workspace";

export { resolveActorFromRequest, type ApiKeyMapping };
