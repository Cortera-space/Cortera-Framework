import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TraceList } from "../src/TraceList";

const BASE_PATH = "";

describe("TraceList", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it("renders loading state initially", () => {
    (global.fetch as any).mockImplementation(() => new Promise(() => {}));
    render(<TraceList workspaceId="ws-1" basePath={BASE_PATH} />);
    expect(screen.getByText(/loading/i)).toBeDefined();
  });

  it("renders events after fetch", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            eventId: "evt-1",
            actionName: "createNote",
            actorType: "human",
            actorId: "user-1",
            permissionResult: "allow",
            startedAt: "2024-01-02T00:00:00Z",
            durationMs: 50,
            error: null,
          },
          {
            eventId: "evt-2",
            actionName: "deleteAllCustomers",
            actorType: "agent",
            actorId: "agent-1",
            permissionResult: "deny",
            startedAt: "2024-01-01T00:00:00Z",
            durationMs: null,
            error: { code: "BLAST_RADIUS_EXCEEDED", message: "exceeds blast radius" },
          },
        ],
        nextCursor: null,
      }),
    });

    render(<TraceList workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText("createNote")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("createNote")).toBeDefined();
    });

    const containedBadge = screen.getByText("CONTAINED");
    expect(containedBadge).toBeDefined();
    expect(containedBadge.textContent).toBe("CONTAINED");

    const denyBadge = screen.getAllByText("deny");
    expect(denyBadge.length).toBeGreaterThanOrEqual(1);
  });

  it("shows no events message when empty", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ events: [], nextCursor: null }),
    });

    render(<TraceList workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText(/no events found/i)).toBeDefined();
    });
  });

  it("loads more events on Load More click", async () => {
    const eventsPage1 = [
      {
        eventId: "evt-1",
        actionName: "note1",
        actorType: "human",
        actorId: "user-1",
        permissionResult: "allow",
        startedAt: "2024-01-02T00:00:00Z",
        durationMs: 50,
        error: null,
      },
    ];
    const eventsPage2 = [
      {
        eventId: "evt-2",
        actionName: "note2",
        actorType: "human",
        actorId: "user-1",
        permissionResult: "allow",
        startedAt: "2024-01-01T00:00:00Z",
        durationMs: 50,
        error: null,
      },
    ];

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: eventsPage1, nextCursor: { startedAt: "2024-01-02T00:00:00Z", id: "evt-1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: eventsPage2, nextCursor: null }),
      });

    render(<TraceList workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText("note1")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Load More"));

    await waitFor(() => {
      expect(screen.getByText("note2")).toBeDefined();
    });
  });

  it("navigates to detail on row click", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            eventId: "evt-1",
            actionName: "createNote",
            actorType: "human",
            actorId: "user-1",
            permissionResult: "allow",
            startedAt: "2024-01-01T00:00:00Z",
            durationMs: 50,
            error: null,
          },
        ],
        nextCursor: null,
      }),
    });

    render(<TraceList workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText("createNote")).toBeDefined();
    });

    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      value: { set href(_val: string) { hrefSetter(_val); } },
      writable: true,
    });
    await userEvent.click(screen.getByText("createNote"));
    expect(hrefSetter).toHaveBeenCalledWith(expect.stringContaining("/traces/evt-1"));
  });
});
