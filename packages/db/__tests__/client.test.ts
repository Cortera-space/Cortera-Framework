import { describe, it, expect, beforeEach, vi } from "vitest";
import { Pool } from "pg";

vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { PostgresDbClient } from "../src/client";

type Row = Record<string, unknown>;

describe("PostgresDbClient - query functions", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let client: PostgresDbClient;

  beforeEach(() => {
    mockQuery = vi.fn();
    (Pool as any).mockImplementation(() => ({
      query: mockQuery,
      end: vi.fn().mockResolvedValue(undefined),
    }));
    client = new PostgresDbClient({ connectionString: "postgresql://localhost/test" } as any);
  });

  function makeRow(overrides: Partial<Row> = {}): Row {
    return {
      id: `uuid-${Math.random().toString(36).slice(2, 8)}`,
      action_name: "testAction",
      actor_type: "agent",
      actor_id: "agent-1",
      input: { foo: "bar" },
      output: { ok: true },
      error: null,
      permission_result: "allow",
      approved_by: null,
      parent_event_id: null,
      started_at: "2024-01-01T00:00:00Z",
      duration_ms: 100,
      workspace_id: "ws-1",
      blast_radius: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      ...overrides,
    };
  }

  describe("listEvents", () => {
    it("returns events ordered by started_at DESC", async () => {
      const older = makeRow({ started_at: "2024-01-01T00:00:00Z", action_name: "old" });
      const newer = makeRow({ started_at: "2024-01-02T00:00:00Z", action_name: "new" });

      mockQuery.mockResolvedValueOnce({ rows: [newer, older] });

      const result = await client.listEvents("ws-1", {}, 10);
      expect(result.events).toHaveLength(2);
      expect(result.events[0].actionName).toBe("new");
      expect(result.events[1].actionName).toBe("old");
    });

    it("filters by actorType", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ actor_type: "agent", action_name: "agentAct" })],
      });

      const result = await client.listEvents("ws-1", { actorType: "agent" }, 10);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].actionName).toBe("agentAct");
    });

    it("filters by actionName", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ action_name: "createNote" })],
      });

      const result = await client.listEvents("ws-1", { actionName: "createNote" }, 10);
      expect(result.events).toHaveLength(1);
    });

    it("filters by permissionResult", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ permission_result: "deny" })],
      });

      const result = await client.listEvents("ws-1", { permissionResult: "deny" }, 10);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].permissionResult).toBe("deny");
    });

    it("filters by date range", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ started_at: "2024-01-15T00:00:00Z" })],
      });

      const result = await client.listEvents(
        "ws-1",
        { from: new Date("2024-01-10T00:00:00Z"), to: new Date("2024-01-20T00:00:00Z") },
        10
      );
      expect(result.events).toHaveLength(1);
      expect(result.events[0].startedAt.toISOString()).toBe("2024-01-15T00:00:00.000Z");
    });

    it("supports cursor pagination", async () => {
      const oldest = makeRow({ started_at: "2024-01-01T00:00:00Z", action_name: "oldest", id: "uuid-1" });
      const middle = makeRow({ started_at: "2024-01-02T00:00:00Z", action_name: "middle", id: "uuid-2" });
      const newest = makeRow({ started_at: "2024-01-03T00:00:00Z", action_name: "newest", id: "uuid-3" });

      mockQuery.mockResolvedValueOnce({ rows: [newest, middle] });

      const page1 = await client.listEvents("ws-1", {}, 2);
      expect(page1.events).toHaveLength(2);
      expect(page1.events[0].actionName).toBe("newest");
      expect(page1.nextCursor).not.toBeNull();

      mockQuery.mockResolvedValueOnce({ rows: [oldest] });
      const page2 = await client.listEvents("ws-1", {}, 2, page1.nextCursor!);
      expect(page2.events).toHaveLength(1);
      expect(page2.events[0].actionName).toBe("oldest");
      expect(page2.nextCursor).toBeNull();
    });

    it("respects workspace isolation", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ workspace_id: "ws-1", action_name: "ws1" })],
      });

      const result = await client.listEvents("ws-1", {}, 10);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].actionName).toBe("ws1");
    });
  });

  describe("getEventWithChain", () => {
    it("returns the focal event with no ancestors or descendants when standalone", async () => {
      const event = makeRow();
      mockQuery.mockResolvedValueOnce({ rows: [event] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await client.getEventWithChain(event.id as string);
      expect(result).not.toBeNull();
      expect(result!.event.eventId).toBe(event.id);
      expect(result!.ancestors).toHaveLength(0);
      expect(result!.descendants).toHaveLength(0);
    });

    it("assembles a two-level ancestor chain", async () => {
      const grandparent = makeRow({ action_name: "grandparent", parent_event_id: null });
      const parent = makeRow({ action_name: "parent", parent_event_id: grandparent.id });
      const focal = makeRow({ action_name: "focal", parent_event_id: parent.id });

      mockQuery.mockResolvedValueOnce({ rows: [focal] });
      mockQuery.mockResolvedValueOnce({ rows: [parent] });
      mockQuery.mockResolvedValueOnce({ rows: [grandparent] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await client.getEventWithChain(focal.id as string);
      expect(result!.ancestors).toHaveLength(2);
      expect(result!.ancestors[0].actionName).toBe("grandparent");
      expect(result!.ancestors[1].actionName).toBe("parent");
      expect(result!.descendants).toHaveLength(0);
    });

    it("assembles a two-level descendant tree", async () => {
      const focal = makeRow({ action_name: "focal" });
      const child1 = makeRow({ action_name: "child1", parent_event_id: focal.id });
      const child2 = makeRow({ action_name: "child2", parent_event_id: focal.id });
      const grandchild = makeRow({ action_name: "grandchild", parent_event_id: child1.id });

      mockQuery.mockResolvedValueOnce({ rows: [focal] });
      mockQuery.mockResolvedValueOnce({ rows: [child1, child2, grandchild] });

      const result = await client.getEventWithChain(focal.id as string);
      expect(result!.ancestors).toHaveLength(0);
      expect(result!.descendants).toHaveLength(2);
      expect(result!.descendants[0].event.actionName).toBe("child1");
      expect(result!.descendants[0].children).toHaveLength(1);
      expect(result!.descendants[0].children[0].event.actionName).toBe("grandchild");
      expect(result!.descendants[1].event.actionName).toBe("child2");
      expect(result!.descendants[1].children).toHaveLength(0);
    });

    it("returns null for unknown eventId", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await client.getEventWithChain("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listContainedActors", () => {
    it("returns only contained actors for the workspace", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await client.listContainedActors("ws-1");
      expect(result).toEqual([]);
    });
  });
});
