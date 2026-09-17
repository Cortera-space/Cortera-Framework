import { createHash } from "crypto";
import { z } from "zod";
import {
  ActionRegistry,
  defineAction,
  InMemoryPermissionEngine,
  type DbClient,
  type InsertActionEvent,
  type ActorState,
  type InsertActorState,
  type PaginatedResult,
  type ContainedActor,
  type ActionApproval,
  type InsertPendingDelayedAction,
  type PendingDelayedAction,
  type ListPendingDelayedActionsOptions,
  type WorkspaceContact,
  type WorkspaceContactResolver,
} from "@tera/core";
import { resolveActorFromRequest } from "@tera/adapter-next";
import { deleteWorkspaceAction } from "@/actions/deleteWorkspace";
import { archiveNoteAction } from "@/actions/archiveNote";

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
permissionEngine.addRule({ actorType: "human", permissionKey: "workspaces.delete", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "workspaces.delete", result: "allow" });
permissionEngine.addRule({ actorType: "human", permissionKey: "notes.archive", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "notes.archive", result: "allow" });
permissionEngine.addRule({ actorType: "human", permissionKey: "records.bulkDelete", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "records.bulkDelete", result: "allow" });

class InMemoryDbClient implements DbClient {
  public events: Array<InsertActionEvent & { id: string }> = [];
  public actorStates = new Map<string, ActorState>();
  private approvals: Array<ActionApproval> = [];
  private apiKeys = new Map<string, { id: string; keyHash: string; actorId: string; workspaceId: string; name: string; createdAt: Date; revokedAt: Date | null; lastUsedAt: Date | null }>();
  public pendingDelayedActions: Array<PendingDelayedAction & { id: string }> = [];

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

  async insertActionApproval(approval: any): Promise<{ id: string }> {
    const id = `approval-${this.approvals.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: ActionApproval = { ...approval, id };
    this.approvals.push(record);
    return { id };
  }

  async updateActionApproval(id: string, event: Partial<any>): Promise<void> {
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

  async findEventById(id: string): Promise<any | null> {
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
    options?: any
  ): Promise<any> {
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
    if (filters?.dryRun !== undefined) {
      filtered = filtered.filter((e) => e.dryRun === filters.dryRun);
    } else {
      filtered = filtered.filter((e) => e.dryRun === false);
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
      permissionResult: e.permissionResult,
      status: "completed",
      input: e.input,
      output: e.output,
      error: e.error,
      parentEventId: e.parentEventId,
      createdAt: e.startedAt,
      updatedAt: e.startedAt,
      dryRun: e.dryRun,
    }));

    const nextCursor = filtered.length > limit ? filtered[limit - 1].startedAt.toISOString() : null;
    return { items, nextCursor };
  }

  async getEventWithChain(eventId: string, includeDryRun = false): Promise<any> {
    const eventMap = new Map<string, any>();
    const allEventIds = new Set<string>();

    let currentId: string | null = eventId;
    while (currentId) {
      const event = this.events.find((e) => e.id === currentId);
      if (!event) break;
      if (!includeDryRun && event.dryRun) break;
      allEventIds.add(currentId);
      currentId = event.parentEventId ?? null;
    }

    const stack = [eventId];
    while (stack.length > 0) {
      const parentId = stack.pop()!;
      const children = this.events.filter((e) => e.parentEventId === parentId && (includeDryRun || !e.dryRun));
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
        permissionResult: event.permissionResult,
        status: "completed",
        input: event.input,
        output: event.output,
        error: event.error,
        parentEventId: event.parentEventId,
        createdAt: event.startedAt,
        updatedAt: event.startedAt,
        dryRun: event.dryRun,
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

    targetEvent.ancestors = [];
    this.buildFullAncestorChain(targetEvent, eventMap);

    const serializable = this.makeSerializable(targetEvent, new Set());
    return serializable;
  }

  private buildFullAncestorChain(targetEvent: any, eventMap: Map<string, any>) {
    let current: any | null = targetEvent;
    while (current && current.parentEventId && eventMap.has(current.parentEventId)) {
      const parent: any = eventMap.get(current.parentEventId)!;
      targetEvent.ancestors.unshift(parent);
      current = parent;
    }
  }

  private makeSerializable(event: any, visited: Set<string>): any {
    if (visited.has(event.eventId)) {
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
        dryRun: event.dryRun,
        ancestors: [],
        descendants: [],
      };
    }
    visited.add(event.eventId);

    return {
      ...event,
      ancestors: event.ancestors.map((a: any) => this.makeSerializable(a, visited)),
      descendants: event.descendants.map((d: any) => this.makeSerializable(d, visited)),
    };
  }

  private sortTree(event: any) {
    event.ancestors.sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
    event.descendants.sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
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
    options?: any
  ): Promise<any[]> {
    const { filters } = options ?? {};
    let pending = this.approvals.filter((a) => a.status === "pending" && a.workspaceId === workspaceId);

    if (filters?.actionName) {
      pending = pending.filter((a) => a.actionName === filters.actionName);
    }

    pending.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());

    return pending.map((approval) => {
      const event = this.events.find((e) => e.id === approval.actionEventId);
      return {
        approval: { ...approval },
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

  async insertPendingDelayedAction(action: InsertPendingDelayedAction): Promise<{ id: string }> {
    const id = `pending-${this.pendingDelayedActions.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: PendingDelayedAction & { id: string } = {
      id,
      actionEventId: action.actionEventId,
      actionName: action.actionName,
      input: action.input,
      actorId: action.actorId,
      workspaceId: action.workspaceId,
      scheduledRunAt: action.scheduledRunAt,
      status: action.status ?? "pending",
      createdAt: new Date(),
    };
    this.pendingDelayedActions.push(record);
    return { id };
  }

  async updatePendingDelayedAction(
    id: string,
    action: Partial<InsertPendingDelayedAction>
  ): Promise<void> {
    const existing = this.pendingDelayedActions.find((a) => a.id === id);
    if (existing) {
      Object.assign(existing, action);
    }
  }

  async findPendingDelayedActionById(id: string): Promise<PendingDelayedAction | null> {
    const record = this.pendingDelayedActions.find((a) => a.id === id);
    if (!record) return null;
    return record;
  }

  async findPendingDelayedActions(
    workspaceId: string,
    options?: ListPendingDelayedActionsOptions
  ): Promise<PaginatedResult<PendingDelayedAction>> {
    const { filters, limit = 50, cursor } = options ?? {};
    let filtered = this.pendingDelayedActions.filter((a) => a.workspaceId === workspaceId);

    if (filters?.actionName) {
      filtered = filtered.filter((a) => a.actionName === filters.actionName);
    }
    if (filters?.status) {
      filtered = filtered.filter((a) => a.status === filters.status);
    }
    if (cursor) {
      const cursorDate = new Date(cursor);
      filtered = filtered.filter((a) => a.createdAt < cursorDate);
    }

    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const items = filtered.slice(0, limit);
    const nextCursor = filtered.length > limit ? filtered[limit - 1].createdAt.toISOString() : null;
    return { items, nextCursor };
  }

  async findPendingDelayedActionsDue(workspaceId: string): Promise<PendingDelayedAction[]> {
    const now = new Date();
    return this.pendingDelayedActions.filter(
      (a) =>
        a.workspaceId === workspaceId &&
        a.status === "pending" &&
        a.scheduledRunAt <= now
    );
  }

  // Irreversible confirmation methods
  private confirmations: Array<{
    id: string;
    actionEventId: string;
    actionName: string;
    input: unknown;
    actorId: string;
    workspaceId: string;
    confirmationToken: string;
    channel: string;
    sentTo: string;
    status: "pending" | "confirmed" | "expired" | "rejected";
    expiresAt: Date;
    confirmedAt: Date | null;
    createdAt: Date;
  }> = [];

  async insertIrreversibleConfirmation(confirmation: {
    actionEventId: string;
    actionName: string;
    input: unknown;
    actorId: string;
    workspaceId: string;
    confirmationToken: string;
    channel: string;
    sentTo: string;
    status: "pending" | "confirmed" | "expired" | "rejected";
    expiresAt: Date;
    confirmedAt: Date | null;
  }): Promise<{ id: string }> {
    const id = `confirmation-${this.confirmations.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.confirmations.push({ ...confirmation, id, createdAt: new Date() });
    return { id };
  }

  async findIrreversibleConfirmationByToken(token: string): Promise<any | null> {
    return this.confirmations.find((c) => c.confirmationToken === token) ?? null;
  }

  async updateIrreversibleConfirmation(id: string, confirmation: Partial<any>): Promise<void> {
    const existing = this.confirmations.find((c) => c.id === id);
    if (existing) Object.assign(existing, confirmation);
  }

  async findPendingIrreversibleConfirmations(): Promise<any[]> {
    const now = new Date();
    return this.confirmations.filter((c) => c.status === "pending" && c.expiresAt >= now);
  }

  async findAllPendingIrreversibleConfirmations(): Promise<any[]> {
    return this.confirmations.filter((c) => c.status === "pending");
  }

  async listPendingIrreversibleConfirmations(workspaceId: string): Promise<any[]> {
    return this.confirmations
      .filter((c) => c.status === "pending" && c.workspaceId === workspaceId)
      .map((confirmation) => {
        const event = this.events.find((e) => e.id === confirmation.actionEventId);
        return {
          confirmation: { ...confirmation },
          event: {
            actionName: event?.actionName ?? confirmation.actionName,
            actorType: event?.actorType ?? "agent",
            actorId: event?.actorId ?? confirmation.actorId,
            input: event?.input ?? confirmation.input,
            requestedAt: event?.startedAt ?? confirmation.createdAt,
            expiresAt: confirmation.expiresAt,
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
    console.log("HANDLER EXECUTED: createNote", input);
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
    console.log("HANDLER EXECUTED: restrictedNote", input);
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
    console.log("HANDLER EXECUTED: notifyWatchers", input);
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
    console.log("HANDLER EXECUTED: deleteAllCustomers", input);
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
    console.log("HANDLER EXECUTED: deleteCustomer", input);
    return { deleted: true, customerId: input.id };
  },
  approvalTtlMs: 24 * 60 * 60 * 1000,
});

export const bulkDeleteRecordsAction = defineAction({
  name: "bulkDeleteRecords",
  description: "Bulk deletes records — delayed for safety review",
  permission: "records.bulkDelete",
  inputSchema: z.object({
    table: z.string(),
    filter: z.record(z.unknown()).optional(),
    reason: z.string().optional(),
  }),
  riskTier: "delayed",
  delayWindowMs: 5 * 60 * 1000, // 5 minutes
  handler: async (input) => {
    return { deleted: true, table: input.table, reason: input.reason };
  },
});

registry.register(createNoteAction as any);
registry.register(restrictedNoteAction as any);
registry.register(notifyWatchersAction as any);
registry.register(deleteAllCustomersAction as any);
registry.register(deleteCustomerAction as any);
registry.register(deleteWorkspaceAction as any);
registry.register(archiveNoteAction as any);
registry.register(bulkDeleteRecordsAction as any);

export const defaultWorkspaceId = "default-workspace";

export const workspaceContactResolver: WorkspaceContactResolver = {
  async getContact(workspaceId: string): Promise<WorkspaceContact | null> {
    if (workspaceId === defaultWorkspaceId) {
      return {
        channel: "email",
        destination: "admin@example.com",
      };
    }
    return null;
  },
};

(globalThis as any).__TERA_CONTACT_RESOLVER__ = workspaceContactResolver;

export { resolveActorFromRequest };