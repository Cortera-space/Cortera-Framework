import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryDbClient,
  type ActionEvent,
  type ActionEventWithChain,
  type ContainedActor,
  type PendingApprovalWithEvent,
  type ListEventsOptions,
  type ListPendingApprovalsOptions,
} from "@tera/core";

function makeEvent(overrides: Partial<ActionEvent> = {}): ActionEvent {
  return {
    eventId: `event-${Math.random().toString(36).slice(2, 8)}`,
    actionName: "testAction",
    actorType: "agent",
    actorId: "agent-1",
    permissionResult: "allow",
    status: "completed",
    input: { test: true },
    output: { result: "ok" },
    error: null,
    parentEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("InMemoryDbClient - Observability Queries", () => {
  let db: InMemoryDbClient;

  beforeEach(() => {
    db = new InMemoryDbClient();
  });

  describe("listEvents", () => {
    beforeEach(async () => {
      const now = new Date();
      await db.insertActionEvent({
        actionName: "actionA",
        actorType: "agent",
        actorId: "agent-1",
        input: { n: 1 },
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(now.getTime() - 3000),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      await db.insertActionEvent({
        actionName: "actionB",
        actorType: "human",
        actorId: "user-1",
        input: { n: 2 },
        output: null,
        error: null,
        permissionResult: "deny",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(now.getTime() - 2000),
        durationMs: 5,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      await db.insertActionEvent({
        actionName: "actionA",
        actorType: "agent",
        actorId: "agent-1",
        input: { n: 3 },
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(now.getTime() - 1000),
        durationMs: 8,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      await db.insertActionEvent({
        actionName: "actionC",
        actorType: "system",
        actorId: "sys-1",
        input: { n: 4 },
        output: null,
        error: null,
        permissionResult: "approval_required",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(now.getTime() - 500),
        durationMs: 12,
        workspaceId: "ws-1",
        blastRadius: null,
      });
    });

    it("returns all events for workspace, most recent first", async () => {
      const result = await db.listEvents("ws-1", { limit: 10 });
      expect(result.items).toHaveLength(4);
      expect(result.items[0].actionName).toBe("actionC");
      expect(result.items[3].actionName).toBe("actionA");
    });

    it("filters by actorType", async () => {
      const result = await db.listEvents("ws-1", {
        filters: { actorType: "agent" },
        limit: 10,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items.every((e) => e.actorType === "agent")).toBe(true);
    });

    it("filters by actionName", async () => {
      const result = await db.listEvents("ws-1", {
        filters: { actionName: "actionA" },
        limit: 10,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items.every((e) => e.actionName === "actionA")).toBe(true);
    });

    it("filters by permissionResult", async () => {
      const result = await db.listEvents("ws-1", {
        filters: { permissionResult: "allow" },
        limit: 10,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items.every((e) => e.permissionResult === "allow")).toBe(true);
    });

    it("filters by from date", async () => {
      const from = new Date(Date.now() - 1500);
      const result = await db.listEvents("ws-1", {
        filters: { from },
        limit: 10,
      });
      expect(result.items.length).toBeLessThanOrEqual(2);
      expect(result.items.every((e) => e.createdAt >= from)).toBe(true);
    });

    it("filters by to date", async () => {
      const to = new Date(Date.now() - 2500);
      const result = await db.listEvents("ws-1", {
        filters: { to },
        limit: 10,
      });
      expect(result.items.length).toBeLessThanOrEqual(2);
      expect(result.items.every((e) => e.createdAt <= to)).toBe(true);
    });

    it("respects limit", async () => {
      const result = await db.listEvents("ws-1", { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });

    it("paginates with cursor", async () => {
      const first = await db.listEvents("ws-1", { limit: 2 });
      expect(first.items).toHaveLength(2);

      const second = await db.listEvents("ws-1", {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items).toHaveLength(2);
      expect(second.items[0].eventId).not.toBe(first.items[0].eventId);
    });

    it("returns empty for different workspace", async () => {
      const result = await db.listEvents("ws-2", { limit: 10 });
      expect(result.items).toHaveLength(0);
    });

    it("combines multiple filters", async () => {
      const result = await db.listEvents("ws-1", {
        filters: { actorType: "agent", actionName: "actionA", permissionResult: "allow" },
        limit: 10,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items.every((e) => e.actorType === "agent")).toBe(true);
      expect(result.items.every((e) => e.actionName === "actionA")).toBe(true);
      expect(result.items.every((e) => e.permissionResult === "allow")).toBe(true);
    });
  });

  describe("getEventWithChain", () => {
    it("returns null for non-existent event", async () => {
      const result = await db.getEventWithChain("non-existent");
      expect(result).toBeNull();
    });

    it("returns single event with empty ancestors/descendants", async () => {
      await db.insertActionEvent({
        actionName: "root",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });

      const events = db.events;
      const eventId = events[0].id;

      const result = await db.getEventWithChain(eventId);
      expect(result).not.toBeNull();
      expect(result!.eventId).toBe(eventId);
      expect(result!.ancestors).toHaveLength(0);
      expect(result!.descendants).toHaveLength(0);
    });

    it("assembles ancestor chain", async () => {
      await db.insertActionEvent({
        actionName: "grandparent",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(Date.now() - 2000),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const gpId = db.events[db.events.length - 1].id;

      await db.insertActionEvent({
        actionName: "parent",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: gpId,
        startedAt: new Date(Date.now() - 1000),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const pId = db.events[db.events.length - 1].id;

      await db.insertActionEvent({
        actionName: "child",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: pId,
        startedAt: new Date(),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const childId = db.events[db.events.length - 1].id;

      const result = await db.getEventWithChain(childId);
      expect(result).not.toBeNull();
      expect(result!.ancestors).toHaveLength(2);
      expect(result!.ancestors[0].actionName).toBe("grandparent");
      expect(result!.ancestors[1].actionName).toBe("parent");
      expect(result!.descendants).toHaveLength(0);
    });

    it("assembles descendant tree", async () => {
      await db.insertActionEvent({
        actionName: "root",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(Date.now() - 2000),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const rootId = db.events[db.events.length - 1].id;

      await db.insertActionEvent({
        actionName: "child1",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: rootId,
        startedAt: new Date(Date.now() - 1000),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const c1Id = db.events[db.events.length - 1].id;

      await db.insertActionEvent({
        actionName: "child2",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: rootId,
        startedAt: new Date(Date.now() - 500),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const c2Id = db.events[db.events.length - 1].id;

      await db.insertActionEvent({
        actionName: "grandchild",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: c1Id,
        startedAt: new Date(),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });

      const result = await db.getEventWithChain(rootId);
      expect(result).not.toBeNull();
      expect(result!.ancestors).toHaveLength(0);
      expect(result!.descendants).toHaveLength(2);
      expect(result!.descendants.map((d) => d.actionName).sort()).toEqual(["child1", "child2"]);
      expect(result!.descendants[0].descendants).toHaveLength(1);
      expect(result!.descendants[0].descendants[0].actionName).toBe("grandchild");
    });

    it("assembles full tree with both ancestors and descendants", async () => {
      await db.insertActionEvent({
        actionName: "grandparent",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date(Date.now() - 3000),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const gpId = db.events[db.events.length - 1].id;

      await db.insertActionEvent({
        actionName: "parent",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: gpId,
        startedAt: new Date(Date.now() - 2000),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const pId = db.events[db.events.length - 1].id;

      await db.insertActionEvent({
        actionName: "target",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: pId,
        startedAt: new Date(Date.now() - 1000),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const targetId = db.events[db.events.length - 1].id;

      await db.insertActionEvent({
        actionName: "child",
        actorType: "agent",
        actorId: "agent-1",
        input: {},
        output: null,
        error: null,
        permissionResult: "allow",
        approvedBy: null,
        parentEventId: targetId,
        startedAt: new Date(Date.now() - 500),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });

      const result = await db.getEventWithChain(targetId);
      expect(result).not.toBeNull();
      expect(result!.ancestors).toHaveLength(2);
      expect(result!.ancestors[0].actionName).toBe("grandparent");
      expect(result!.ancestors[1].actionName).toBe("parent");
      expect(result!.descendants).toHaveLength(1);
      expect(result!.descendants[0].actionName).toBe("child");
    });
  });

  describe("listContainedActors", () => {
    it("returns empty when no contained actors", async () => {
      const result = await db.listContainedActors("ws-1");
      expect(result).toHaveLength(0);
    });

    it("returns contained actors with reason and timestamp", async () => {
      await db.upsertActorState({
        actorId: "agent-1",
        workspaceId: "ws-1",
        status: "contained",
        containedAt: new Date("2024-01-15T10:00:00Z"),
        containedReason: "blast radius exceeded",
        reviewedBy: null,
        reviewedAt: null,
      });

      await db.upsertActorState({
        actorId: "agent-2",
        workspaceId: "ws-1",
        status: "revoked",
        containedAt: new Date("2024-01-14T10:00:00Z"),
        containedReason: "repeated violations",
        reviewedBy: "reviewer-1",
        reviewedAt: new Date("2024-01-14T11:00:00Z"),
      });

      await db.upsertActorState({
        actorId: "agent-3",
        workspaceId: "ws-2",
        status: "contained",
        containedAt: new Date(),
        containedReason: "other workspace",
        reviewedBy: null,
        reviewedAt: null,
      });

      const result = await db.listContainedActors("ws-1");
      expect(result).toHaveLength(2);
      expect(result[0].actorId).toBe("agent-1");
      expect(result[0].status).toBe("contained");
      expect(result[0].containedReason).toBe("blast radius exceeded");
      expect(result[1].actorId).toBe("agent-2");
      expect(result[1].status).toBe("revoked");
      expect(result[1].reviewedBy).toBe("reviewer-1");
    });

    it("excludes active actors", async () => {
      await db.upsertActorState({
        actorId: "agent-1",
        workspaceId: "ws-1",
        status: "active",
        containedAt: null,
        containedReason: null,
        reviewedBy: null,
        reviewedAt: null,
      });

      const result = await db.listContainedActors("ws-1");
      expect(result).toHaveLength(0);
    });

    it("sorts by containedAt descending", async () => {
      await db.upsertActorState({
        actorId: "agent-1",
        workspaceId: "ws-1",
        status: "contained",
        containedAt: new Date("2024-01-14T10:00:00Z"),
        containedReason: "old",
        reviewedBy: null,
        reviewedAt: null,
      });

      await db.upsertActorState({
        actorId: "agent-2",
        workspaceId: "ws-1",
        status: "contained",
        containedAt: new Date("2024-01-15T10:00:00Z"),
        containedReason: "new",
        reviewedBy: null,
        reviewedAt: null,
      });

      const result = await db.listContainedActors("ws-1");
      expect(result[0].actorId).toBe("agent-2");
      expect(result[1].actorId).toBe("agent-1");
    });
  });

  describe("listPendingApprovals", () => {
    beforeEach(async () => {
      await db.insertActionEvent({
        actionName: "deleteCustomer",
        actorType: "human",
        actorId: "user-1",
        input: { id: "cust-1" },
        output: null,
        error: null,
        permissionResult: "approval_required",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date("2024-01-15T10:00:00Z"),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const event1Id = db.events[db.events.length - 1].id;

      await db.insertActionApproval({
        actionEventId: event1Id,
        actionName: "deleteCustomer",
        input: { id: "cust-1" },
        actorType: "human",
        actorId: "user-1",
        workspaceId: "ws-1",
        status: "pending",
        requestedAt: new Date("2024-01-15T10:00:00Z"),
        expiresAt: new Date("2024-01-16T10:00:00Z"),
        resolvedAt: null,
        approvedBy: null,
      });

      await db.insertActionEvent({
        actionName: "deleteAllCustomers",
        actorType: "agent",
        actorId: "agent-1",
        input: { reason: "cleanup" },
        output: null,
        error: null,
        permissionResult: "approval_required",
        approvedBy: null,
        parentEventId: null,
        startedAt: new Date("2024-01-15T11:00:00Z"),
        durationMs: 10,
        workspaceId: "ws-1",
        blastRadius: null,
      });
      const event2Id = db.events[db.events.length - 1].id;

      await db.insertActionApproval({
        actionEventId: event2Id,
        actionName: "deleteAllCustomers",
        input: { reason: "cleanup" },
        actorType: "agent",
        actorId: "agent-1",
        workspaceId: "ws-1",
        status: "pending",
        requestedAt: new Date("2024-01-15T11:00:00Z"),
        expiresAt: new Date("2024-01-16T11:00:00Z"),
        resolvedAt: null,
        approvedBy: null,
      });

      await db.insertActionApproval({
        actionEventId: event1Id,
        actionName: "deleteCustomer",
        input: { id: "cust-2" },
        actorType: "human",
        actorId: "user-2",
        workspaceId: "ws-2",
        status: "pending",
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        resolvedAt: null,
        approvedBy: null,
      });
    });

    it("returns pending approvals with event data", async () => {
      const result = await db.listPendingApprovals("ws-1");
      expect(result).toHaveLength(2);
      expect(result[0].approval.actionName).toBe("deleteCustomer");
      expect(result[0].event.actionName).toBe("deleteCustomer");
      expect(result[0].event.actorId).toBe("user-1");
      expect(result[1].approval.actionName).toBe("deleteAllCustomers");
      expect(result[1].event.actorId).toBe("agent-1");
    });

    it("filters by actionName", async () => {
      const result = await db.listPendingApprovals("ws-1", {
        filters: { actionName: "deleteCustomer" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].approval.actionName).toBe("deleteCustomer");
    });

    it("sorts by requestedAt ascending", async () => {
      const result = await db.listPendingApprovals("ws-1");
      expect(result[0].approval.requestedAt.getTime()).toBeLessThan(
        result[1].approval.requestedAt.getTime()
      );
    });

    it("excludes non-pending approvals", async () => {
      const approval = db.approvals.find((a) => a.actionName === "deleteCustomer");
      if (approval) {
        await db.updateActionApproval(approval.id, { status: "approved", resolvedAt: new Date() });
      }

      const result = await db.listPendingApprovals("ws-1");
      expect(result).toHaveLength(1);
      expect(result[0].approval.actionName).toBe("deleteAllCustomers");
    });

    it("excludes approvals from other workspaces", async () => {
      const result = await db.listPendingApprovals("ws-2");
      expect(result).toHaveLength(1);
      expect(result[0].approval.workspaceId).toBe("ws-2");
    });

    it("uses event data when available, falls back to approval data", async () => {
      const result = await db.listPendingApprovals("ws-1");
      for (const item of result) {
        expect(item.event.actionName).toBe(item.approval.actionName);
        expect(item.event.actorId).toBe(item.approval.actorId);
      }
    });
  });
});