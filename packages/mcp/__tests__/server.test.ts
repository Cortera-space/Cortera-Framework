import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionRegistry,
  type ActionContext,
  type DbClient,
  type InsertActionEvent,
  type InsertActionApproval,
  type ActionApproval,
  type ActorState,
  type InsertActorState,
  type PaginatedResult,
  type ContainedActor,
  type PendingDelayedAction,
  type InsertPendingDelayedAction,
  type ListPendingDelayedActionsOptions,
  type IrreversibleConfirmation,
  type InsertIrreversibleConfirmation,
  type ListPendingApprovalsOptions,
  type PendingApprovalWithEvent,
  type PendingIrreversibleConfirmationWithEvent,
  type DataProvenance,
  type InsertDataProvenance,
  type ProvenanceTrace,
  type ProvenanceTraceEntry,
  type ActorBehaviorBaseline,
  type InsertActorBehaviorBaseline,
  type ActorCallHistoryEntry,
} from "@cortera/core";
import { createMcpActionServer } from "../src/server";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";

function makeMockDbClient(): DbClient {
  const events: (InsertActionEvent & { _id: string })[] = [];
  const idMap = new Map<string, InsertActionEvent & { _id: string }>();
  const actorStates = new Map<string, ActorState>();
  const apiKeys = new Map<string, { id: string; keyHash: string; actorId: string; workspaceId: string; name: string; createdAt: Date; revokedAt: Date | null; lastUsedAt: Date | null }>();
  const approvals: ActionApproval[] = [];
  const pendingDelayedActions: (PendingDelayedAction & { id: string })[] = [];
  const confirmations: (IrreversibleConfirmation & { id: string })[] = [];
  const provenance: (DataProvenance & { id: string })[] = [];
  const behaviorBaselines = new Map<string, ActorBehaviorBaseline>();

  // Pre-populate test API key
  const testKey = "test-key";
  const testKeyHash = require("crypto").createHash("sha256").update(testKey).digest("hex");
  apiKeys.set(testKeyHash, { id: "key-1", keyHash: testKeyHash, actorId: "test-agent", workspaceId: "ws-1", name: "Test Key", createdAt: new Date(), revokedAt: null, lastUsedAt: null });

  return {
    async query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
      // Normalize SQL for matching (remove extra whitespace and newlines)
      const normalizedSql = sql.replace(/\s+/g, " ").trim();

      if (normalizedSql.startsWith("INSERT INTO api_keys")) {
        const [, keyHash, actorId, workspaceId, name] = params as [string, string, string, string, string];
        const id = `key-${apiKeys.size + 1}-${Date.now()}`;
        apiKeys.set(keyHash, { id, keyHash, actorId, workspaceId, name, createdAt: new Date(), revokedAt: null, lastUsedAt: null });
        return { rows: [{ id }], rowCount: 1 };
      }
      if (normalizedSql.startsWith("SELECT id FROM api_keys WHERE key_hash")) {
        const [keyHash] = params as [string];
        const key = apiKeys.get(keyHash);
        return { rows: key ? [{ id: key.id }] : [], rowCount: key ? 1 : 0 };
      }
      if (normalizedSql.startsWith("SELECT id, actor_id, workspace_id, revoked_at FROM api_keys WHERE key_hash")) {
        const [keyHash] = params as [string];
        const key = apiKeys.get(keyHash);
        return { rows: key ? [{ id: key.id, actor_id: key.actorId, workspace_id: key.workspaceId, revoked_at: key.revokedAt }] : [], rowCount: key ? 1 : 0 };
      }
      if (normalizedSql.startsWith("UPDATE api_keys SET last_used_at = now() WHERE id")) {
        const [id] = params as [string];
        for (const key of apiKeys.values()) {
          if (key.id === id) {
            key.lastUsedAt = new Date();
            break;
          }
        }
        return { rows: [], rowCount: 1 };
      }
      if (normalizedSql.startsWith("UPDATE api_keys SET revoked_at = now() WHERE id")) {
        const [id] = params as [string];
        for (const key of apiKeys.values()) {
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
        for (const key of apiKeys.values()) {
          if (key.workspaceId === workspaceId) {
            keys.push({ id: key.id, actor_id: key.actorId, workspace_id: key.workspaceId, name: key.name, created_at: key.createdAt, revoked_at: key.revokedAt, last_used_at: key.lastUsedAt });
          }
        }
        keys.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return { rows: keys, rowCount: keys.length };
      }
      return { rows: [], rowCount: 0 };
    },
    async insertActionEvent(event: InsertActionEvent): Promise<{ id: string }> {
      const id = `event-${events.length + 1}`;
      const stored = { ...event, _id: id } as InsertActionEvent & { _id: string };
      events.push(stored);
      idMap.set(id, stored);
      return { id };
    },

    async updateActionEvent(id: string, event: Partial<InsertActionEvent>): Promise<void> {
      const existing = idMap.get(id);
      if (existing) Object.assign(existing, event);
    },

    async insertActionApproval(approval: InsertActionApproval): Promise<{ id: string }> {
      const id = `approval-${approvals.length + 1}`;
      const record: ActionApproval = { ...approval, id };
      approvals.push(record);
      return { id };
    },

    async updateActionApproval(id: string, event: Partial<InsertActionApproval>): Promise<void> {
      const existing = approvals.find((a) => a.id === id);
      if (existing) Object.assign(existing, event);
    },

    async findPendingApprovals(workspaceId: string): Promise<ActionApproval[]> {
      return approvals.filter((a) => a.status === "pending" && a.workspaceId === workspaceId);
    },

    async findAllPendingApprovals(): Promise<ActionApproval[]> {
      return approvals.filter((a) => a.status === "pending");
    },

    async findApprovalById(id: string): Promise<ActionApproval | null> {
      return approvals.find((a) => a.id === id) ?? null;
    },

    async findEventById(id: string) {
      const stored = idMap.get(id);
      if (!stored) return null;
      return {
        id: stored._id,
        actionName: stored.actionName,
        parentEventId: stored.parentEventId,
        blastRadius: stored.blastRadius,
      };
    },

    async findActorState(actorId: string, workspaceId: string): Promise<ActorState | null> {
      return actorStates.get(`${actorId}:${workspaceId}`) ?? null;
    },

    async upsertActorState(state: InsertActorState): Promise<void> {
      actorStates.set(`${state.actorId}:${state.workspaceId}`, {
        actorId: state.actorId,
        workspaceId: state.workspaceId,
        status: state.status,
        containedAt: state.containedAt,
        containedReason: state.containedReason,
        containmentReason: state.containmentReason,
        reviewedBy: state.reviewedBy,
        reviewedAt: state.reviewedAt,
      });
    },

    async listEvents(workspaceId: string, options?: any): Promise<PaginatedResult<any>> {
      const { filters, limit = 50, cursor } = options ?? {};
      let filtered = events.filter((e) => e.workspaceId === workspaceId);

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
        filtered = filtered.filter((e) => e.dryRun !== true);
      }
      if (cursor) {
        const cursorDate = new Date(cursor);
        filtered = filtered.filter((e) => e.startedAt < cursorDate);
      }

      filtered.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

      const items = filtered.slice(0, limit).map((e) => ({
        eventId: e._id,
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
        dryRun: e.dryRun ?? false,
      }));

      const nextCursor = filtered.length > limit ? filtered[limit - 1].startedAt.toISOString() : null;
      return { items, nextCursor };
    },

    async getEventWithChain(eventId: string, includeDryRun = false): Promise<any> {
      const eventMap = new Map<string, any>();
      const allEventIds = new Set<string>();

      let currentId: string | null = eventId;
      while (currentId) {
        const event = events.find((e) => e._id === currentId);
        if (!event) break;
        if (!includeDryRun && event.dryRun) break;
        allEventIds.add(currentId);
        currentId = event.parentEventId ?? null;
      }

      const stack = [eventId];
      while (stack.length > 0) {
        const parentId = stack.pop()!;
        const children = events.filter((e) => e.parentEventId === parentId && (includeDryRun || !e.dryRun));
        for (const child of children) {
          allEventIds.add(child._id);
          stack.push(child._id);
        }
      }

      for (const id of allEventIds) {
        const event = events.find((e) => e._id === id);
        if (!event) continue;
        eventMap.set(id, {
          eventId: event._id,
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
      // buildFullAncestorChain would go here
      return targetEvent;
    },

    async listContainedActors(workspaceId: string): Promise<ContainedActor[]> {
      const contained: ContainedActor[] = [];
      for (const state of actorStates.values()) {
        if (state.workspaceId === workspaceId && (state.status === "contained" || state.status === "revoked")) {
          contained.push({
            actorId: state.actorId,
            workspaceId: state.workspaceId,
            status: state.status,
            containedAt: state.containedAt ?? new Date(),
            containedReason: state.containedReason,
            containmentReason: state.containmentReason,
            reviewedBy: state.reviewedBy,
            reviewedAt: state.reviewedAt,
          });
        }
      }
      contained.sort((a, b) => b.containedAt.getTime() - a.containedAt.getTime());
      return contained;
    },

    async listPendingApprovals(workspaceId: string, options?: ListPendingApprovalsOptions): Promise<PendingApprovalWithEvent[]> {
      const { filters } = options ?? {};
      let pending = approvals.filter((a) => a.status === "pending" && a.workspaceId === workspaceId);

      if (filters?.actionName) {
        pending = pending.filter((a) => a.actionName === filters.actionName);
      }

      pending.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());

      return pending.map((approval) => {
        const event = events.find((e) => e._id === approval.actionEventId);
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
    },

    // Delayed actions
    async insertPendingDelayedAction(action: InsertPendingDelayedAction): Promise<{ id: string }> {
      const id = `pending-${pendingDelayedActions.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      pendingDelayedActions.push(record);
      return { id };
    },

    async updatePendingDelayedAction(id: string, action: Partial<InsertPendingDelayedAction>): Promise<void> {
      const existing = pendingDelayedActions.find((a) => a.id === id);
      if (existing) Object.assign(existing, action);
    },

    async findPendingDelayedActionById(id: string): Promise<PendingDelayedAction | null> {
      return pendingDelayedActions.find((a) => a.id === id) ?? null;
    },

    async findPendingDelayedActions(workspaceId: string, options?: ListPendingDelayedActionsOptions): Promise<PaginatedResult<PendingDelayedAction>> {
      const { filters, limit = 50, cursor } = options ?? {};
      let filtered = pendingDelayedActions.filter((a) => a.workspaceId === workspaceId);

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
    },

    async findPendingDelayedActionsDue(workspaceId: string): Promise<PendingDelayedAction[]> {
      const now = new Date();
      return pendingDelayedActions.filter(
        (a) =>
          a.workspaceId === workspaceId &&
          a.status === "pending" &&
          a.scheduledRunAt <= now
      );
    },

    // Irreversible confirmations
    async insertIrreversibleConfirmation(confirmation: InsertIrreversibleConfirmation): Promise<{ id: string }> {
      const id = `confirmation-${confirmations.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record: IrreversibleConfirmation & { id: string } = {
        ...confirmation,
        id,
        createdAt: new Date(),
      };
      confirmations.push(record);
      return { id };
    },

    async findIrreversibleConfirmationByToken(token: string): Promise<IrreversibleConfirmation | null> {
      return confirmations.find((c) => c.confirmationToken === token) ?? null;
    },

    async updateIrreversibleConfirmation(id: string, confirmation: Partial<InsertIrreversibleConfirmation>): Promise<void> {
      const existing = confirmations.find((c) => c.id === id);
      if (existing) Object.assign(existing, confirmation);
    },

    async findPendingIrreversibleConfirmations(): Promise<IrreversibleConfirmation[]> {
      const now = new Date();
      return confirmations.filter((c) => c.status === "pending" && c.expiresAt >= now);
    },

    async findAllPendingIrreversibleConfirmations(): Promise<IrreversibleConfirmation[]> {
      return confirmations.filter((c) => c.status === "pending");
    },

    async listPendingIrreversibleConfirmations(workspaceId: string): Promise<PendingIrreversibleConfirmationWithEvent[]> {
      const pending = confirmations.filter((c) => c.status === "pending" && c.workspaceId === workspaceId);
      return pending.map((confirmation) => {
        const event = events.find((e) => e._id === confirmation.actionEventId);
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
    },

    // Provenance methods
    async insertDataProvenance(p: InsertDataProvenance): Promise<{ id: string }> {
      const id = `prov-${provenance.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record: DataProvenance & { id: string } = {
        ...p,
        id,
        createdAt: new Date(),
      };
      provenance.push(record);
      return { id };
    },

    async findDataProvenanceByEventId(eventId: string): Promise<DataProvenance[]> {
      return provenance
        .filter((p) => p.eventId === eventId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    async getProvenanceTrace(eventId: string): Promise<ProvenanceTrace | null> {
      const event = events.find((e) => e._id === eventId);
      if (!event) return null;

      const outputProvenance = provenance
        .filter((p) => p.eventId === eventId && p.fieldPath === "output")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      const outputLabel = outputProvenance[0]?.label ?? "trusted";

      const trace: ProvenanceTraceEntry[] = [];
      buildProvenanceTrace(eventId, trace);

      return { eventId, outputLabel, trace };
    },

    // Behavioral drift methods
    async findActorBehaviorBaseline(actorId: string, workspaceId: string): Promise<ActorBehaviorBaseline | null> {
      return behaviorBaselines.get(`${actorId}:${workspaceId}`) ?? null;
    },

    async upsertActorBehaviorBaseline(baseline: InsertActorBehaviorBaseline): Promise<void> {
      behaviorBaselines.set(`${baseline.actorId}:${baseline.workspaceId}`, baseline as ActorBehaviorBaseline);
    },

    async findActorCallHistory(
      actorId: string,
      workspaceId: string,
      from: Date,
      to?: Date,
      limit?: number
    ): Promise<ActorCallHistoryEntry[]> {
      let filtered = events.filter(
        (e) => e.workspaceId === workspaceId && e.actorId === actorId && e.startedAt >= from
      );

      if (to) {
        filtered = filtered.filter((e) => e.startedAt <= to!);
      }

      filtered.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

      if (limit) {
        filtered = filtered.slice(0, limit);
      }

      return filtered.map((e) => ({
        actionName: e.actionName,
        permissionKey: (e.error as any)?.violatingPermission ?? e.actionName,
        timestamp: e.startedAt,
        permissionResult: e.permissionResult as ActorCallHistoryEntry["permissionResult"],
      }));
    },
  };

  function buildProvenanceTrace(eventId: string, trace: ProvenanceTraceEntry[]): void {
    const provenanceRecords = provenance
      .filter((p) => p.eventId === eventId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const p of provenanceRecords) {
      const actionEvent = events.find((e) => e._id === p.eventId);
      const entry: ProvenanceTraceEntry = {
        eventId: p.eventId,
        actionName: actionEvent?.actionName ?? "unknown",
        fieldPath: p.fieldPath,
        label: p.label,
        sourceEventId: p.sourceEventId,
        isSanitized: p.label === "trusted" && p.sourceEventId !== null,
      };
      trace.push(entry);

      if (p.sourceEventId) {
        buildProvenanceTrace(p.sourceEventId, trace);
      }
    }
  }
}

function createTestServer(options?: Partial<Parameters<typeof createMcpActionServer>[0]>) {
  const registry = new ActionRegistry();
  const dbClient = makeMockDbClient();

  const server = createMcpActionServer({
    registry,
    dbClient,
    permissionEngine: { check: async () => "allow" as const },
    defaultWorkspaceId: "ws-1",
    ...options,
  });

  return { registry, dbClient, server };
}

async function mcpRoundTrip(
  factory: (ctx: any) => Promise<McpServer>,
  request: Record<string, unknown>,
  parentEventId?: string
): Promise<Record<string, unknown>> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const mcpServer = await factory({
    requestInfo: new Request("http://localhost", { headers: { "x-cortera-api-key": "test-key" } }),
    era: "legacy",
  });
  mcpServer.connect(serverTransport);
  await clientTransport.start();

  clientTransport.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
  });

  const initMsg = await new Promise<Record<string, unknown>>((resolve) => {
    clientTransport.onmessage = resolve;
  });

  clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const params = { ...request.params };
  if (parentEventId) {
    params._meta = { "x-cortera-parent-event-id": parentEventId };
  }

  clientTransport.send({ ...request, id: 2, params });
  const result = await new Promise<Record<string, unknown>>((resolve) => {
    clientTransport.onmessage = resolve;
  });

  await serverTransport.close();
  await clientTransport.close();

  return result;
}

describe("MCP server", () => {
  it("successful tool-call produces correct output", async () => {
    const action = defineAction({
      name: "echo",
      description: "Echoes input",
      permission: "echo.run",
      inputSchema: z.object({ message: z.string() }),
      handler: async (input) => ({ echoed: input.message }),
    });

    const { registry, server } = createTestServer();
    registry.register(action);

    const result = await mcpRoundTrip(server.factory, {
      method: "tools/call",
      params: { name: "echo", arguments: { message: "hello" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.result.content).toBeDefined();
    const content = JSON.parse(result.result.content[0].text);
    expect(content).toEqual({ echoed: "hello" });
  });

  it("tool-call with bad input surfaces validation error via MCP", async () => {
    const action = defineAction({
      name: "strictEcho",
      description: "Echoes with validation",
      permission: "echo.run",
      inputSchema: z.object({ message: z.string().min(3) }),
      handler: async (input) => ({ echoed: input.message }),
    });

    const { registry, server } = createTestServer();
    registry.register(action);

    const result = await mcpRoundTrip((server.createHandler() as any).factory, {
      method: "tools/call",
      params: { name: "strictEcho", arguments: { message: "ab" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.result.isError).toBe(true);
    const content = JSON.parse(result.result.content[0].text);
    expect(content.error).toBeDefined();
    expect(content.details).toBeDefined();
  });

  it("tool-call exceeding blast radius denies and contains the actor", async () => {
    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      blastRadius: ["notes.*"],
      handler: async (input) => ({ title: input.title }),
    });

    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler: async (input) => ({ deleted: true, id: input.id }),
    });

    const { registry, dbClient, server } = createTestServer();
    registry.register(parent);
    registry.register(child);

    const parentResult = await mcpRoundTrip((server.createHandler() as any).factory, {
      method: "tools/call",
      params: { name: "parent", arguments: { title: "Secret" } },
    });

    expect(parentResult.error).toBeUndefined();
    const parentContent = JSON.parse(parentResult.result.content[0].text);
    expect(parentContent).toEqual({ title: "Secret" });

    const parentEventId = parentContent.eventId;
    const childResult = await mcpRoundTrip((server.createHandler() as any).factory, {
      method: "tools/call",
      params: { name: "child", arguments: { id: "cust-1" } },
    }, parentEventId);

    expect(childResult.error).toBeUndefined();
    expect(childResult.result.isError).toBe(true);
    const childContent = JSON.parse(childResult.result.content[0].text);
    expect(childContent.reason).toBe("BLAST_RADIUS_EXCEEDED");

    const actorState = await dbClient.findActorState("test-agent", "ws-1");
    expect(actorState).toBeDefined();
    expect(actorState.status).toBe("contained");
  });

  it("subsequent call from contained actor is auto-denied", async () => {
    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      blastRadius: ["notes.*"],
      handler: async (input) => ({ title: input.title }),
    });

    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "customers.delete",
      inputSchema: z.object({ id: z.string() }),
      handler: async (input) => ({ deleted: true, id: input.id }),
    });

    const unrelated = defineAction({
      name: "unrelated",
      description: "Unrelated action",
      permission: "notes.create",
      inputSchema: z.object({ title: z.string() }),
      handler: async (input) => ({ title: input.title }),
    });

    const { registry, dbClient, server } = createTestServer();
    registry.register(parent);
    registry.register(child);
    registry.register(unrelated);

    const parentResult = await mcpRoundTrip((server.createHandler() as any).factory, {
      method: "tools/call",
      params: { name: "parent", arguments: { title: "Secret" } },
    });

    const parentContent = JSON.parse(parentResult.result.content[0].text);
    const parentEventId = parentContent.eventId;

    await mcpRoundTrip((server.createHandler() as any).factory, {
      method: "tools/call",
      params: { name: "child", arguments: { id: "cust-1" } },
    }, parentEventId);

    const unrelatedResult = await mcpRoundTrip((server.createHandler() as any).factory, {
      method: "tools/call",
      params: { name: "unrelated", arguments: { title: "Should deny" } },
    });

    expect(unrelatedResult.error).toBeUndefined();
    expect(unrelatedResult.result.isError).toBe(true);
    const unrelatedContent = JSON.parse(unrelatedResult.result.content[0].text);
    expect(unrelatedContent.reason).toBe("ACTOR_CONTAINED");
  });

  it("tool-call returns error for ActionPermissionError", async () => {
    const action = defineAction({
      name: "adminOnly",
      description: "Admin only action",
      permission: "admin.power",
      inputSchema: z.object({ cmd: z.string() }),
      handler: async () => ({}),
    });

    const { registry, server } = createTestServer({
      permissionEngine: { check: async () => "deny" as const },
    });
    registry.register(action);

    const result = await mcpRoundTrip((server.createHandler() as any).factory, {
      method: "tools/call",
      params: { name: "adminOnly", arguments: { cmd: "do-thing" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.result.isError).toBe(true);
    const content = JSON.parse(result.result.content[0].text);
    expect(content.reason).toBe("deny");
  });

  it("tool-call returns pending status for ActionPendingApprovalError", async () => {
    const action = defineAction({
      name: "needsApproval",
      description: "Needs approval",
      permission: "sensitive.run",
      inputSchema: z.object({ cmd: z.string() }),
      approvalTtlMs: 1000,
      handler: async () => ({}),
    });

    const { registry, server } = createTestServer({
      permissionEngine: { check: async () => "approval_required" as const },
    });
    registry.register(action);

    const result = await mcpRoundTrip((server.createHandler() as any).factory, {
      method: "tools/call",
      params: { name: "needsApproval", arguments: { cmd: "do-thing" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.result.isError).toBe(true);
    const content = JSON.parse(result.result.content[0].text);
    expect(content.status).toBe("pending");
    expect(content.approvalId).toBeDefined();
  });
});
