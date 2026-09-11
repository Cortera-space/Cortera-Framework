import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveTail } from "../src/LiveTail";

function createMockEventSource(): ReturnType<typeof vi.fn> {
  const listeners: Record<string, Function[]> = {};

  const instance = {
    addEventListener: vi.fn((type: string, fn: Function) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    }),
    removeEventListener: vi.fn(),
    close: vi.fn(),
  };

  const MockConstructor = vi.fn(() => instance);
  return MockConstructor;
}

describe("LiveTail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders waiting state initially", () => {
    render(<LiveTail workspaceId="ws-1" />);
    expect(screen.getByText(/waiting for events/i)).toBeDefined();
  });

  it("receives and displays events from SSE stream", async () => {
    const EventSourceMock = createMockEventSource();
    globalThis.EventSource = EventSourceMock as unknown as typeof EventSource;

    render(<LiveTail workspaceId="ws-1" />);

    const messageHandler = EventSourceMock.mock.results[0].value.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "message"
    )![1] as (data: string) => void;

    messageHandler({ data: JSON.stringify({
      event_id: "evt-1",
      action_name: "createNote",
      actor_type: "agent",
      actor_id: "agent-1",
      permission_result: "allow",
      status: "completed",
      input: {},
      output: null,
      error: null,
      parent_event_id: null,
      started_at: "2024-01-01T00:00:00Z",
      duration_ms: 10,
      workspace_id: "ws-1",
      blast_radius: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    })});

    await waitFor(() => {
      expect(screen.getByText("createNote")).toBeDefined();
    });
    expect(screen.getByText("agent:agent-1")).toBeDefined();
    expect(screen.getByText("allow")).toBeDefined();
  });

  it("renders CONTAINED badge for containment events", async () => {
    const EventSourceMock = createMockEventSource();
    globalThis.EventSource = EventSourceMock as unknown as typeof EventSource;

    render(<LiveTail workspaceId="ws-1" />);

    const messageHandler = EventSourceMock.mock.results[0].value.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "message"
    )![1] as (data: string) => void;

    messageHandler({ data: JSON.stringify({
      event_id: "evt-contained",
      action_name: "deleteAllCustomers",
      actor_type: "agent",
      actor_id: "agent-1",
      permission_result: "deny",
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
      parent_event_id: "evt-parent",
      started_at: "2024-01-01T00:00:00Z",
      duration_ms: null,
      workspace_id: "ws-1",
      blast_radius: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    })});

    await waitFor(() => {
      expect(screen.getByText("CONTAINED")).toBeDefined();
    });
    expect(screen.getByText("CONTAINED").textContent).toBe("CONTAINED");
    expect(screen.getByText("deleteAllCustomers")).toBeDefined();
  });

  it("pauses and resumes event display", async () => {
    const EventSourceMock = createMockEventSource();
    globalThis.EventSource = EventSourceMock as unknown as typeof EventSource;

    render(<LiveTail workspaceId="ws-1" />);

    await userEvent.click(screen.getByText("Pause"));
    expect(screen.getByText("Resume")).toBeDefined();
    expect(screen.getByText(/paused/i)).toBeDefined();

    await userEvent.click(screen.getByText("Resume"));
    expect(screen.getByText("Pause")).toBeDefined();
    expect(screen.queryByText("Paused")).toBeNull();
  });

  it("shows reconnecting indicator on connection drop", async () => {
    const EventSourceMock = createMockEventSource();
    globalThis.EventSource = EventSourceMock as unknown as typeof EventSource;

    render(<LiveTail workspaceId="ws-1" />);

    const errorHandler = EventSourceMock.mock.results[0].value.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "error"
    )![1] as () => void;

    errorHandler();

    await waitFor(() => {
      expect(screen.getByText(/reconnecting/i)).toBeDefined();
    });
  });

  it("navigates to trace detail on row click", async () => {
    const EventSourceMock = createMockEventSource();
    globalThis.EventSource = EventSourceMock as unknown as typeof EventSource;

    render(<LiveTail workspaceId="ws-1" basePath="/api" />);

    const messageHandler = EventSourceMock.mock.results[0].value.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "message"
    )![1] as (data: string) => void;

    messageHandler({ data: JSON.stringify({
      event_id: "evt-1",
      action_name: "createNote",
      actor_type: "human",
      actor_id: "user-1",
      permission_result: "allow",
      status: "completed",
      input: {},
      output: null,
      error: null,
      parent_event_id: null,
      started_at: "2024-01-01T00:00:00Z",
      duration_ms: 50,
      workspace_id: "ws-1",
      blast_radius: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    })});

    await waitFor(() => {
      expect(screen.getByText("createNote")).toBeDefined();
    });

    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      value: { set href(_val: string) { hrefSetter(_val); } },
      writable: true,
    });

    await userEvent.click(screen.getByText("createNote"));
    expect(hrefSetter).toHaveBeenCalledWith(
      expect.stringContaining("/api/traces/evt-1")
    );
  });
});
