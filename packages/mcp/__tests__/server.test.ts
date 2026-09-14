import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionRegistry,
  type ActionContext,
  type DbClient,
  type InsertActionEvent,
  type InsertActionApproval,
} from "@tera/core";
import { createMcpActionServer } from "../src/server";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";

function makeMockDbClient(): DbClient {
  const events: InsertActionEvent[] = [];
  const idMap = new Map<string, InsertActionEvent>();
  const actorStates = new Map<string, { actorId: string; workspaceId: string; status: string; containedAt: Date | null; containedReason: string | null; reviewedBy: string | null; reviewedAt: Date | null }>();
  const apiKeys = new Map<string, { id: string; keyHash: string; actorId: string; workspaceId: string; name: string; createdAt: Date; revokedAt: Date | null; lastUsedAt: Date | null }>();

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
      return { id: `approval-${events.length + 1}` };
    },

    async updateActionApproval(_id: string, _event: Partial<InsertActionApproval>): Promise<void> {},

    async findPendingApprovals(): Promise<any[]> { return []; },
    async findAllPendingApprovals(): Promise<any[]> { return []; },
    async findApprovalById(_id: string): Promise<any | null> { return null; },

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

    async findActorState(actorId: string, workspaceId: string): Promise<any | null> {
      const key = `${actorId}:${workspaceId}`;
      const state = actorStates.get(key);
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
    },

    async upsertActorState(state: any): Promise<void> {
      const key = `${state.actorId}:${state.workspaceId}`;
      actorStates.set(key, {
        actorId: state.actorId,
        workspaceId: state.workspaceId,
        status: state.status,
        containedAt: state.containedAt,
        containedReason: state.containedReason,
        reviewedBy: state.reviewedBy,
        reviewedAt: state.reviewedAt,
      });
    },
  };
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
    requestInfo: new Request("http://localhost", { headers: { "x-tera-api-key": "test-key" } }),
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
    params._meta = { "x-tera-parent-event-id": parentEventId };
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
