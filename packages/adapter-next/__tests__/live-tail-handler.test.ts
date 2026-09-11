import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLiveTailHandler } from "../src/live-tail-handler";
import { NextRequest } from "next/server";

function createPool(
  notifications: Array<{ channel: string; payload: string }>
) {
  const storedHandlers: Function[] = [];

  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    on: vi.fn((_event: string, fn: Function) => {
      storedHandlers.push(fn);
    }),
    off: vi.fn(),
    removeListener: vi.fn(),
    release: vi.fn(),
  };

  return {
    connect: vi.fn().mockResolvedValue(client),
    _storedHandlers: storedHandlers,
  };
}

function createRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe("createLiveTailHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when workspaceId is missing", async () => {
    const request = createRequest("http://localhost/api/live-tail");
    const pool = createPool([]);
    const handler = createLiveTailHandler({ pool });
    const response = await handler(request, { params: {} } as any);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("workspaceId");
  });

  it("returns SSE stream with correct headers", async () => {
    const request = createRequest("http://localhost/api/live-tail?workspaceId=ws-1");
    const pool = createPool([]);
    const handler = createLiveTailHandler({ pool });
    const response = await handler(request, { params: {} } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("passes workspaceId filter — only matching events received", async () => {
    const pool = createPool([
      { channel: "action_events", payload: JSON.stringify({ workspace_id: "ws-1", action_name: "test1" }) },
      { channel: "action_events", payload: JSON.stringify({ workspace_id: "ws-2", action_name: "test2" }) },
    ]);

    const handler = createLiveTailHandler({ pool });
    const request = createRequest("http://localhost/api/live-tail?workspaceId=ws-1");
    const response = await handler(request, { params: {} } as any);

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();

    await new Promise((r) => setTimeout(r, 100));

    pool._storedHandlers.forEach((fn) => {
      fn({
        channel: "action_events",
        payload: JSON.stringify({ workspace_id: "ws-1", action_name: "test1" }),
      });
    });

    const body = response.body as ReadableStream<Uint8Array>;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let result = "";

    try {
      for (let i = 0; i < 20; i++) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: boolean; value: undefined }>((r) =>
            setTimeout(() => r({ done: true, value: undefined }), 500)
          ),
        ]);
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.cancel();
    }

    expect(result).toContain("test1");
    expect(result).not.toContain("test2");
  });

  it("filters by actorId when provided", async () => {
    const pool = createPool([
      { channel: "action_events", payload: JSON.stringify({ workspace_id: "ws-1", actor_id: "agent-1", action_name: "target" }) },
      { channel: "action_events", payload: JSON.stringify({ workspace_id: "ws-1", actor_id: "agent-2", action_name: "other" }) },
    ]);

    const handler = createLiveTailHandler({ pool });
    const request = createRequest("http://localhost/api/live-tail?workspaceId=ws-1&actorId=agent-1");
    const response = await handler(request, { params: {} } as any);

    expect(response.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));

    pool._storedHandlers.forEach((fn) => {
      fn({
        channel: "action_events",
        payload: JSON.stringify({ workspace_id: "ws-1", actor_id: "agent-1", action_name: "target" }),
      });
    });

    const body = response.body as ReadableStream<Uint8Array>;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let result = "";

    try {
      for (let i = 0; i < 20; i++) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: boolean; value: undefined }>((r) =>
            setTimeout(() => r({ done: true, value: undefined }), 500)
          ),
        ]);
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.cancel();
    }

    expect(result).toContain("agent-1");
    expect(result).not.toContain("agent-2");
  });

  it("filters by actionName when provided", async () => {
    const pool = createPool([
      { channel: "action_events", payload: JSON.stringify({ workspace_id: "ws-1", action_name: "createNote", actor_id: "a1" }) },
      { channel: "action_events", payload: JSON.stringify({ workspace_id: "ws-1", action_name: "deleteAll", actor_id: "a1" }) },
    ]);

    const handler = createLiveTailHandler({ pool });
    const request = createRequest("http://localhost/api/live-tail?workspaceId=ws-1&actionName=createNote");
    const response = await handler(request, { params: {} } as any);

    expect(response.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));

    pool._storedHandlers.forEach((fn) => {
      fn({
        channel: "action_events",
        payload: JSON.stringify({ workspace_id: "ws-1", action_name: "createNote", actor_id: "a1" }),
      });
    });

    const body = response.body as ReadableStream<Uint8Array>;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let result = "";

    try {
      for (let i = 0; i < 20; i++) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: boolean; value: undefined }>((r) =>
            setTimeout(() => r({ done: true, value: undefined }), 500)
          ),
        ]);
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.cancel();
    }

    expect(result).toContain("createNote");
    expect(result).not.toContain("deleteAll");
  });
});
