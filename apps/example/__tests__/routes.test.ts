import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  registry,
  dbClient,
  permissionEngine,
  apiKeyMapping,
  defaultWorkspaceId,
} from "@/lib/registry";

function makeRequest(url: string, init?: RequestInit & { headers?: Record<string, string> }): NextRequest {
  return new NextRequest(url, {
    method: init?.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
}

describe("POST /app/actions/[actionName]", () => {
  beforeEach(() => {
    dbClient.events = [];
    dbClient.actorStates.clear();
    (dbClient as any).approvals = [];
  });

  it("returns 200 with result on successful action call", async () => {
    const { POST } = await import("@/app/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/createNote", {
      method: "POST",
      body: { title: "Hello", content: "World" },
      headers: { "x-tera-api-key": "sk-agent-123" },
    });

    const response = await POST(request, { params: { actionName: "createNote" } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.result).toEqual({ id: expect.stringMatching(/^note-\d+/), title: "Hello", content: "World" });
  });

  it("returns 404 for unknown action", async () => {
    const { POST } = await import("@/app/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/nonexistent", {
      method: "POST",
      headers: { "x-tera-api-key": "sk-agent-123" },
    });

    const response = await POST(request, { params: { actionName: "nonexistent" } });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toContain("Action not found");
  });

  it("returns 400 with details on validation failure", async () => {
    const { POST } = await import("@/app/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/createNote", {
      method: "POST",
      body: { title: "", content: "" },
      headers: { "x-tera-api-key": "sk-agent-123" },
    });

    const response = await POST(request, { params: { actionName: "createNote" } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid input");
    expect(json.details).toBeDefined();
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("returns 403 on permission denial", async () => {
    const { POST } = await import("@/app/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/notifyWatchers", {
      method: "POST",
      body: { noteId: "1", title: "Hi" },
      headers: {
        cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
      },
    });

    const response = await POST(request, { params: { actionName: "notifyWatchers" } });
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.reason).toBe("deny");
  });

  it("returns 202 with approvalId on approval_required", async () => {
    const { POST } = await import("@/app/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/deleteCustomer", {
      method: "POST",
      body: { id: "cust-1" },
      headers: {
        cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
      },
    });

    const response = await POST(request, { params: { actionName: "deleteCustomer" } });
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json.status).toBe("pending");
    expect(json.approvalId).toBeDefined();
    expect(typeof json.approvalId).toBe("string");
  });

  it("returns 401 when no actor identity is found", async () => {
    const { POST } = await import("@/app/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/createNote", {
      method: "POST",
      body: { title: "Hello", content: "World" },
    });

    const response = await POST(request, { params: { actionName: "createNote" } });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toContain("Unauthorized");
  });
});

describe("POST /app/actions/approvals/[approvalId]", () => {
  let approvalId: string;

  beforeEach(async () => {
    dbClient.events = [];
    dbClient.actorStates.clear();
    (dbClient as any).approvals = [];

    const { POST: actionPost } = await import("@/app/actions/[actionName]/route");
    const req = makeRequest("http://localhost/app/actions/deleteCustomer", {
      method: "POST",
      body: { id: "cust-1" },
      headers: {
        cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
      },
    });
    const res = await actionPost(req, { params: { actionName: "deleteCustomer" } });
    const json = await res.json();
    approvalId = json.approvalId;
  });

  it("resolves an approved approval and returns ok", async () => {
    const { POST } = await import("@/app/actions/approvals/[approvalId]/route");
    const request = makeRequest(
      `http://localhost/app/actions/approvals/${approvalId}`,
      {
        method: "POST",
        body: { decision: "approved" },
        headers: {
          cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
        },
      }
    );

    const response = await POST(request, { params: { approvalId } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("resolves a rejected approval and returns ok", async () => {
    const { POST } = await import("@/app/actions/approvals/[approvalId]/route");
    const request = makeRequest(
      `http://localhost/app/actions/approvals/${approvalId}`,
      {
        method: "POST",
        body: { decision: "rejected" },
        headers: {
          cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
        },
      }
    );

    const response = await POST(request, { params: { approvalId } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("returns 404 for unknown approval", async () => {
    const { POST } = await import("@/app/actions/approvals/[approvalId]/route");
    const request = makeRequest("http://localhost/app/actions/approvals/unknown", {
      method: "POST",
      body: { decision: "approved" },
      headers: {
        cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
      },
    });

    const response = await POST(request, { params: { approvalId: "unknown" } });
    const json = await response.json();

    expect(response.status).toBe(404);
  });

  it("returns 401 when no actor identity is found", async () => {
    const { POST } = await import("@/app/actions/approvals/[approvalId]/route");
    const request = makeRequest(`http://localhost/app/actions/approvals/${approvalId}`, {
      method: "POST",
      body: { decision: "approved" },
    });

    const response = await POST(request, { params: { approvalId } });
    expect(response.status).toBe(401);
  });
});

describe("POST /app/actors/[actorId]/review", () => {
  beforeEach(() => {
    dbClient.events = [];
    dbClient.actorStates.clear();
    (dbClient as any).approvals = [];
  });

  it("lifts a contained actor and returns ok", async () => {
    const { POST: actionPost } = await import("@/app/actions/[actionName]/route");
    const req = makeRequest("http://localhost/app/actions/restrictedNote", {
      method: "POST",
      body: { title: "Root", content: "Blast radius root" },
      headers: { "x-tera-api-key": "sk-agent-123" },
    });
    const rootRes = await actionPost(req, { params: { actionName: "restrictedNote" } });
    const rootJson = await rootRes.json();
    const rootEventId = rootJson.eventId || (dbClient.events[0] && dbClient.events[0].id);

    const req2 = makeRequest("http://localhost/app/actions/deleteAllCustomers", {
      method: "POST",
      body: { reason: "oops" },
      headers: {
        "x-tera-api-key": "sk-agent-123",
        "x-tera-parent-event-id": rootEventId,
      },
    });
    await actionPost(req2, { params: { actionName: "deleteAllCustomers" } });

    const states = dbClient.actorStates;
    const containedActor = Array.from(states.values()).find((s) => s.status === "contained");
    expect(containedActor).toBeDefined();

    const { POST: reviewPost } = await import("@/app/actors/[actorId]/review/route");
    const reviewReq = makeRequest(
      `http://localhost/app/actors/${containedActor!.actorId}/review?workspaceId=${defaultWorkspaceId}`,
      {
        method: "POST",
        body: { decision: "lift" },
        headers: {
          cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
        },
      }
    );

    const response = await reviewPost(reviewReq, { params: { actorId: containedActor!.actorId } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("returns 404 for actor not found", async () => {
    const { POST } = await import("@/app/actors/[actorId]/review/route");
    const request = makeRequest(
      "http://localhost/app/actors/nonexistent/review?workspaceId=default-workspace",
      {
        method: "POST",
        body: { decision: "lift" },
        headers: {
          cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
        },
      }
    );

    const response = await POST(request, { params: { actorId: "nonexistent" } });
    const json = await response.json();

    expect(response.status).toBe(404);
  });

  it("returns 400 when workspaceId is missing", async () => {
    const { POST } = await import("@/app/actors/[actorId]/review/route");
    const request = makeRequest("http://localhost/app/actors/actor-1/review", {
      method: "POST",
      body: { decision: "lift" },
      headers: {
        cookie: "tera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
      },
    });

    const response = await POST(request, { params: { actorId: "actor-1" } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("workspaceId");
  });

  it("returns 401 when no actor identity is found", async () => {
    const { POST } = await import("@/app/actors/[actorId]/review/route");
    const request = makeRequest("http://localhost/app/actors/actor-1/review?workspaceId=default-workspace", {
      method: "POST",
      body: { decision: "lift" },
    });

    const response = await POST(request, { params: { actorId: "actor-1" } });
    expect(response.status).toBe(401);
  });
});
