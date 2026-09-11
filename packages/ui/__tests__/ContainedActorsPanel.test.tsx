import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContainedActorsPanel } from "../src/ContainedActorsPanel";

const BASE_PATH = "";

describe("ContainedActorsPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it("renders loading state initially", () => {
    (global.fetch as any).mockImplementation(() => new Promise(() => {}));
    render(<ContainedActorsPanel workspaceId="ws-1" basePath={BASE_PATH} />);
    expect(screen.getByText(/loading/i)).toBeDefined();
  });

  it("renders no actors message when empty", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ actors: [] }),
    });

    render(<ContainedActorsPanel workspaceId="ws-1" basePath={BASE_PATH} />);

    await waitFor(() => {
      expect(screen.getByText(/no contained actors/i)).toBeDefined();
    });
  });

  it("renders contained actors and lifts one", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          actors: [
            {
              actorId: "agent-1",
              workspaceId: "ws-1",
              status: "contained",
              containedAt: "2024-01-01T00:00:00Z",
              containedReason: "exceeded blast radius",
              reviewedBy: null,
              reviewedAt: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ actors: [] }),
      });

    render(<ContainedActorsPanel workspaceId="ws-1" basePath={BASE_PATH} currentActorId="reviewer-1" />);

    await waitFor(() => {
      expect(screen.getByText("agent-1")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("CONTAINED")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Lift"));

    await waitFor(() => {
      expect(screen.getByText(/no contained actors/i)).toBeDefined();
    });
  });

  it("revokes a contained actor", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          actors: [
            {
              actorId: "agent-1",
              workspaceId: "ws-1",
              status: "contained",
              containedAt: "2024-01-01T00:00:00Z",
              containedReason: "exceeded blast radius",
              reviewedBy: null,
              reviewedAt: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          actors: [
            {
              actorId: "agent-1",
              workspaceId: "ws-1",
              status: "revoked",
              containedAt: "2024-01-01T00:00:00Z",
              containedReason: "exceeded blast radius",
              reviewedBy: "reviewer-1",
              reviewedAt: "2024-01-02T00:00:00Z",
            },
          ],
        }),
      });

    render(<ContainedActorsPanel workspaceId="ws-1" basePath={BASE_PATH} currentActorId="reviewer-1" />);

    await waitFor(() => {
      expect(screen.getByText("agent-1")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Revoke"));

    await waitFor(() => {
      expect(screen.getByText("agent-1")).toBeDefined();
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("shows error on failed lift/revoke", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          actors: [
            {
              actorId: "agent-1",
              workspaceId: "ws-1",
              status: "contained",
              containedAt: "2024-01-01T00:00:00Z",
              containedReason: "exceeded blast radius",
              reviewedBy: null,
              reviewedAt: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Server error" }),
      });

    render(<ContainedActorsPanel workspaceId="ws-1" basePath={BASE_PATH} currentActorId="reviewer-1" />);

    await waitFor(() => {
      expect(screen.getByText("agent-1")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Lift"));

    await waitFor(() => {
      expect(screen.getByText(/error: server error/i)).toBeDefined();
    });
  });
});
