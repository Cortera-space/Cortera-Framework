import { createHash } from "crypto";
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
  type ListEventsOptions,
  type PaginatedResult,
  type ActionEvent,
  type ActionEventWithChain,
  type ContainedActor,
  type PendingApprovalWithEvent,
  type ListPendingApprovalsOptions,
} from "@tera/core";
import { resolveActorFromRequest } from "@tera/adapter-next";

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
  private apiKeys = new Map<string, { id: string; keyHash: string; actorId: string; workspaceId: string; name: string; createdAt: Date; revokedAt: Date | null; lastUsedAt: Date | null }>();

  constructor() {
    // Pre-populate test API keys for backward compatibility with tests
    const testKeys = [
      { key: "sk-agent-123", actorId: "agent-1", name: "Test Agent 1" },
      { key: "sk-agent-456", actorId: "agent-2", name: "Test Agent 2" },
    ];
    for (const { key, actorId, name } of testKeys) {
      const keyHash = createHash("sha256").update(key).digest("hex");
      const id = `key-${this.apiKeys.size + 1}-${Date.now()}`;
      this.apiKeys.set(keyHash, { id, keyHash, actorId, workspaceId: "default-workspace", name, createdAt: new Date(), revokedAt: null, lastUsedAt: null });
    }
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
    // Normalize SQL for matching (remove extra whitespace and newlines)
    const normalizedSql = sql.replace(/\s+/g, " ").trim();

    if (normalizedSql.startsWith("INSERT INTO api_keys")) {
      const [, keyHash, actorId, workspaceId, name] = params as [string, string, string, string, string];
      const id = `key-${this.apiKeys.size + 1}-${Date.now()}`;
      this.apiKeys.set(keyHash, { id, keyHash, actorId, workspaceId, name, createdAt: new Date(), revokedAt: null, lastUsedAt: null });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (normalizedSql.startsWith("SELECT id FROM api_keys WHERE key_hash")) {
      const [keyHash] = params as [string];
      const key = this.apiKeys.get(keyHash);
      return { rows: key ? [{ id: key.id }] : [], rowCount: key ? 1 : 0 };
    }
    if (normalizedSql.startsWith("SELECT id, actor_id, workspace_id, revoked_at FROM api_keys WHERE key_hash")) {
      const [keyHash] = params as [string];
      const key = this.apiKeys.get(keyHash);
      return { rows: key ? [{ id: key.id, actor_id: key.actorId, workspace_id: key.workspaceId, revoked_at: key.revokedAt }] : [], rowCount: key ? 1 : 0 };
    }
    if (normalizedSql.startsWith("UPDATE api_keys SET last_used_at = now() WHERE id")) {
      const [id] = params as [string];
      for (const key of this.apiKeys.values()) {
        if (key.id === id) {
          key.lastUsedAt = new Date();
          break;
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (normalizedSql.startsWith("UPDATE api_keys SET revoked_at = now() WHERE id")) {
      const [id] = params as [string];
      for (const key of this.apiKeys.values()) {
        if (key.id === id) {
          key.revokedAt = new Date();
          break;
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (normalizedSql.startsWith("SELECT id, actor_id, workspace_id, name, created_at, revoked_at, last_used_at FROM api_keys WHERE workspace_id")) {
      const [workspaceId] = params as [string];
      const keys: any[] = [];
      for (const key of this.apiKeys.values()) {
        if (key.workspaceId === workspaceId) {
          keys.push({ id: key.id, actor_id: key.actorId, workspace_id: key.workspaceId, name: key.name, created_at: key.createdAt, revoked_at: key.revokedAt, last_used_at: key.lastUsedAt });
        }
      }
      keys.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return { rows: keys, rowCount: keys.length };
    }
    return { rows: [], rowCount: 0 };
  }

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
    options?: ListEventsOptions
  ): Promise<PaginatedResult<ActionEvent>> {
    const { filters, limit = 50, cursor } = options ?? {};
    let filtered = this.events.filter((e) => e.workspaceId === workspaceId);

    if (filters?.actorType) {
      filtered = filtered.filter((e) => e.actorType === filters.actorType);
    }
    if (filters?.actionName) {
      filtered = filtered.filter((e) => e.actionName === filters.actionName);
    }
    if (filters?.permissionResult) {
      filtered = filtered.filter((e) => e.permissionResult === filters.permissionResult);
    }
    if (filters?.from) {
      filtered = filtered.filter((e) => e.startedAt >= filters.from!);
    }
    if (filters?.to) {
      filtered = filtered.filter((e) => e.startedAt <= filters.to!);
    }
    if (cursor) {
      const cursorDate = new Date(cursor);
      filtered = filtered.filter((e) => e.startedAt < cursorDate);
    }

    filtered.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    const items = filtered.slice(0, limit).map((e) => ({
      eventId: e.id,
      actionName: e.actionName,
      actorType: e.actorType,
      actorId: e.actorId,
      permissionResult: e.permissionResult as ActionEvent["permissionResult"],
      status: "completed",
      input: e.input,
      output: e.output,
      error: e.error as string | null,
      parentEventId: e.parentEventId,
      createdAt: e.startedAt,
      updatedAt: e.startedAt,
    }));

    const nextCursor = filtered.length > limit ? filtered[limit - 1].startedAt.toISOString() : null;
    return { items, nextCursor };
  }

  async getEventWithChain(eventId: string): Promise<ActionEventWithChain | null> {
    const eventMap = new Map<string, ActionEventWithChain>();
    const allEventIds = new Set<string>();

    let currentId: string | null = eventId;
    while (currentId) {
      const event = this.events.find((e) => e.id === currentId);
      if (!event) break;
      allEventIds.add(currentId);
      currentId = event.parentEventId ?? null;
    }

    const stack = [eventId];
    while (stack.length > 0) {
      const parentId = stack.pop()!;
      const children = this.events.filter((e) => e.parentEventId === parentId);
      for (const child of children) {
        allEventIds.add(child.id);
        stack.push(child.id);
      }
    }

    for (const id of allEventIds) {
      const event = this.events.find((e) => e.id === id);
      if (!event) continue;
      eventMap.set(id, {
        eventId: event.id,
        actionName: event.actionName,
        actorType: event.actorType,
        actorId: event.actorId,
        permissionResult: event.permissionResult as ActionEvent["permissionResult"],
        status: "completed",
        input: event.input,
        output: event.output,
        error: event.error as string | null,
        parentEventId: event.parentEventId,
        createdAt: event.startedAt,
        updatedAt: event.startedAt,
        ancestors: [],
        descendants: [],
      });
    }

    for (const event of eventMap.values()) {
      if (event.parentEventId && eventMap.has(event.parentEventId)) {
        const parent = eventMap.get(event.parentEventId)!;
        parent.descendants.push(event);
        event.ancestors.push(parent);
      }
    }

    const targetEvent = eventMap.get(eventId);
    if (!targetEvent) return null;

    // Clear the immediate parent link and build full ancestor chain
    targetEvent.ancestors = [];
    this.buildFullAncestorChain(targetEvent, eventMap);

    // Create a serializable version without circular references
    const serializable = this.makeSerializable(targetEvent, new Set());
    return serializable;
  }

  private buildFullAncestorChain(targetEvent: ActionEventWithChain, eventMap: Map<string, ActionEventWithChain>) {
    let current: ActionEventWithChain | null = targetEvent;
    while (current && current.parentEventId && eventMap.has(current.parentEventId)) {
      const parent: ActionEventWithChain = eventMap.get(current.parentEventId)!;
      targetEvent.ancestors.unshift(parent);
      current = parent;
    }
  }

  private makeSerializable(event: ActionEventWithChain, visited: Set<string>): ActionEventWithChain {
    if (visited.has(event.eventId)) {
      // Return a minimal version to break circular reference
      return {
        eventId: event.eventId,
        actionName: event.actionName,
        actorType: event.actorType,
        actorId: event.actorId,
        permissionResult: event.permissionResult,
        status: event.status,
        input: event.input,
        output: event.output,
        error: event.error,
        parentEventId: event.parentEventId,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        ancestors: [],
        descendants: [],
      };
    }
    visited.add(event.eventId);

    return {
      ...event,
      ancestors: event.ancestors.map((a) => this.makeSerializable(a, visited)),
      descendants: event.descendants.map((d) => this.makeSerializable(d, visited)),
    };
  }

  private sortTree(event: ActionEventWithChain) {
    event.ancestors.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    event.descendants.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const child of event.descendants) {
      this.sortTree(child);
    }
  }

  async listContainedActors(workspaceId: string): Promise<ContainedActor[]> {
    const contained: ContainedActor[] = [];
    for (const [, state] of this.actorStates) {
      if (state.workspaceId === workspaceId && (state.status === "contained" || state.status === "revoked")) {
        contained.push({
          actorId: state.actorId,
          workspaceId: state.workspaceId,
          status: state.status,
          containedAt: state.containedAt ?? new Date(),
          containedReason: state.containedReason,
          reviewedBy: state.reviewedBy,
          reviewedAt: state.reviewedAt,
        });
      }
    }
    contained.sort((a, b) => b.containedAt.getTime() - a.containedAt.getTime());
    return contained;
  }

  async listPendingApprovals(
    workspaceId: string,
    options?: ListPendingApprovalsOptions
  ): Promise<PendingApprovalWithEvent[]> {
    const { filters } = options ?? {};
    let pending = this.approvals.filter((a) => a.status === "pending" && a.workspaceId === workspaceId);

    if (filters?.actionName) {
      pending = pending.filter((a) => a.actionName === filters.actionName);
    }

    pending.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());

    return pending.map((approval) => {
      const event = this.events.find((e) => e.id === approval.actionEventId);
      return {
        approval: {
          ...approval,
        },
        event: {
          actionName: event?.actionName ?? approval.actionName,
          actorType: event?.actorType ?? approval.actorType,
          actorId: event?.actorId ?? approval.actorId,
          input: event?.input ?? approval.input,
          requestedAt: event?.startedAt ?? approval.requestedAt,
          expiresAt: approval.expiresAt,
        },
      };
    });
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

export { resolveActorFromRequest };
