import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TraceDetail } from "../src/TraceDetail";

const BASE_PATH = "";

describe("TraceDetail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it("renders event details", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        event: {
          eventId: "evt-1",
          actionName: "createNote",
          actorType: "human",
          actorId: "user-1",
          permissionResult: "allow",
          status: "completed",
          input: { title: "Hello" },
          output: { id: "note-1" },
          error: null,
          parentEventId: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          startedAt: "2024-01-01T00:00:00Z",
          durationMs: 50,
          workspaceId: "ws-1",
          blastRadius: null,
        },
        ancestors: [],
        descendants: [],
      }),
    });

    render(<TraceDetail eventId="evt-1" workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText("Trace Detail")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText(/createNote/)).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("human:user-1")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText(/"title": "Hello"/)).toBeDefined();
    });
  });

  it("renders containment violation banner", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        event: {
          eventId: "evt-1",
          actionName: "deleteAllCustomers",
          actorType: "agent",
          actorId: "agent-1",
          permissionResult: "deny",
          status: "failed",
          input: { reason: "oops" },
          output: null,
          error: {
            code: "BLAST_RADIUS_EXCEEDED",
            message: "exceeds blast radius",
            rootAction: "restrictedNote",
            rootBlastRadius: ["notes.*"],
            violatingAction: "deleteAllCustomers",
            violatingPermission: "customers.delete",
          },
          parentEventId: "evt-parent",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          startedAt: "2024-01-01T00:00:00Z",
          durationMs: null,
          workspaceId: "ws-1",
          blastRadius: null,
        },
        ancestors: [],
        descendants: [],
      }),
    });

    render(<TraceDetail eventId="evt-1" workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText("CONTAINMENT VIOLATION")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getAllByText(/deleteAllCustomers/).length).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      expect(screen.getAllByText(/customers\.delete/).length).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      expect(screen.getAllByText(/notes\.\*/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders ancestor chain", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        event: {
          eventId: "evt-3",
          actionName: "child",
          actorType: "agent",
          actorId: "agent-1",
          permissionResult: "allow",
          status: "completed",
          input: {},
          output: {},
          error: null,
          parentEventId: "evt-2",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          startedAt: "2024-01-01T00:00:00Z",
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        },
        ancestors: [
          {
            eventId: "evt-1",
            actionName: "grandparent",
            actorType: "system",
            actorId: "system",
            permissionResult: "allow",
            status: "completed",
            input: {},
            output: {},
            error: null,
            parentEventId: null,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
            startedAt: "2024-01-01T00:00:00Z",
            durationMs: 5,
            workspaceId: "ws-1",
            blastRadius: null,
          },
          {
            eventId: "evt-2",
            actionName: "parent",
            actorType: "agent",
            actorId: "agent-1",
            permissionResult: "allow",
            status: "completed",
            input: {},
            output: {},
            error: null,
            parentEventId: "evt-1",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
            startedAt: "2024-01-01T00:00:00Z",
            durationMs: 8,
            workspaceId: "ws-1",
            blastRadius: null,
          },
        ],
        descendants: [],
      }),
    });

    render(<TraceDetail eventId="evt-3" workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText("grandparent")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("parent")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText(/child/)).toBeDefined();
    });
  });

  it("renders descendant tree", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        event: {
          eventId: "evt-1",
          actionName: "parent",
          actorType: "agent",
          actorId: "agent-1",
          permissionResult: "allow",
          status: "completed",
          input: {},
          output: {},
          error: null,
          parentEventId: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          startedAt: "2024-01-01T00:00:00Z",
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        },
        ancestors: [],
        descendants: [
          {
            event: {
              eventId: "evt-2",
              actionName: "child1",
              actorType: "agent",
              actorId: "agent-1",
              permissionResult: "allow",
              status: "completed",
              input: {},
              output: {},
              error: null,
              parentEventId: "evt-1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
              startedAt: "2024-01-01T00:00:00Z",
              durationMs: 5,
              workspaceId: "ws-1",
              blastRadius: null,
            },
            children: [
              {
                event: {
                  eventId: "evt-3",
                  actionName: "grandchild",
                  actorType: "agent",
                  actorId: "agent-1",
                  permissionResult: "allow",
                  status: "completed",
                  input: {},
                  output: {},
                  error: null,
                  parentEventId: "evt-2",
                  createdAt: "2024-01-01T00:00:00Z",
                  updatedAt: "2024-01-01T00:00:00Z",
                  startedAt: "2024-01-01T00:00:00Z",
                  durationMs: 2,
                  workspaceId: "ws-1",
                  blastRadius: null,
                },
                children: [],
              },
            ],
          },
          {
            event: {
              eventId: "evt-4",
              actionName: "child2",
              actorType: "system",
              actorId: "system",
              permissionResult: "allow",
              status: "completed",
              input: {},
              output: {},
              error: null,
              parentEventId: "evt-1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
              startedAt: "2024-01-01T00:00:00Z",
              durationMs: 3,
              workspaceId: "ws-1",
              blastRadius: null,
            },
            children: [],
          },
        ],
      }),
    });

    render(<TraceDetail eventId="evt-1" workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText("child1")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("grandchild")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("child2")).toBeDefined();
    });
  });
});
