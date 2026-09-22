import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  dbClient,
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

describe("GET /api/cortera/events", () => {
  beforeEach(() => {
    dbClient.events = [];
    dbClient.actorStates.clear();
    (dbClient as any).approvals = [];
  });

  it("returns 200 with paginated events", async () => {
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    await actionPost(
      makeRequest("http://localhost/app/actions/createNote", {
        method: "POST",
        body: { title: "Note 1", content: "Content 1" },
        headers: { "x-cortera-api-key": "sk-agent-123" },
      }),
      { params: { actionName: "createNote" } }
    );
    await actionPost(
      makeRequest("http://localhost/app/actions/createNote", {
        method: "POST",
        body: { title: "Note 2", content: "Content 2" },
        headers: { "x-cortera-api-key": "sk-agent-123" },
      }),
      { params: { actionName: "createNote" } }
    );

    const { GET } = await import("@/app/api/cortera/events/route");
    const request = makeRequest("http://localhost/api/cortera/events?workspaceId=default-workspace&limit=10", {
      headers: { "x-cortera-api-key": "sk-agent-123" },
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items).toHaveLength(2);
    expect(json.items[0].actionName).toBe("createNote");
    expect(json.nextCursor).toBeDefined();
  });

  it("filters by actorType", async () => {
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    await actionPost(
      makeRequest("http://localhost/app/actions/createNote", {
        method: "POST",
        body: { title: "Agent Note", content: "Content" },
        headers: { "x-cortera-api-key": "sk-agent-123" },
      }),
      { params: { actionName: "createNote" } }
    );
    await actionPost(
      makeRequest("http://localhost/app/actions/createNote", {
        method: "POST",
        body: { title: "Human Note", content: "Content" },
        headers: {
          cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
        },
      }),
      { params: { actionName: "createNote" } }
    );

    const { GET } = await import("@/app/api/cortera/events/route");
    const request = makeRequest(
      "http://localhost/api/cortera/events?workspaceId=default-workspace&actorType=agent",
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].actorType).toBe("agent");
  });

  it("filters by actionName", async () => {
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    await actionPost(
      makeRequest("http://localhost/app/actions/createNote", {
        method: "POST",
        body: { title: "Note", content: "Content" },
        headers: { "x-cortera-api-key": "sk-agent-123" },
      }),
      { params: { actionName: "createNote" } }
    );
    await actionPost(
      makeRequest("http://localhost/app/actions/notifyWatchers", {
        method: "POST",
        body: { noteId: "1", title: "Test" },
        headers: { "x-cortera-api-key": "sk-agent-123" },
      }),
      { params: { actionName: "notifyWatchers" } }
    );

    const { GET } = await import("@/app/api/cortera/events/route");
    const request = makeRequest(
      "http://localhost/api/cortera/events?workspaceId=default-workspace&actionName=createNote",
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].actionName).toBe("createNote");
  });

  it("filters by permissionResult", async () => {
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    await actionPost(
      makeRequest("http://localhost/app/actions/createNote", {
        method: "POST",
        body: { title: "Note", content: "Content" },
        headers: { "x-cortera-api-key": "sk-agent-123" },
      }),
      { params: { actionName: "createNote" } }
    );
    await actionPost(
      makeRequest("http://localhost/app/actions/notifyWatchers", {
        method: "POST",
        body: { noteId: "1", title: "Test" },
        headers: {
          cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
        },
      }),
      { params: { actionName: "notifyWatchers" } }
    );

    const { GET } = await import("@/app/api/cortera/events/route");
    const request = makeRequest(
      "http://localhost/api/cortera/events?workspaceId=default-workspace&permissionResult=deny",
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].permissionResult).toBe("deny");
  });

  it("paginates with cursor", async () => {
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    for (let i = 0; i < 5; i++) {
      await actionPost(
        makeRequest("http://localhost/app/actions/createNote", {
          method: "POST",
          body: { title: `Note ${i}`, content: "Content" },
          headers: { "x-cortera-api-key": "sk-agent-123" },
        }),
        { params: { actionName: "createNote" } }
      );
    }

    const { GET } = await import("@/app/api/cortera/events/route");
    const first = await GET(
      makeRequest("http://localhost/api/cortera/events?workspaceId=default-workspace&limit=2", {
        headers: { "x-cortera-api-key": "sk-agent-123" },
      })
    );
    const firstJson = await first.json();

    const second = await GET(
      makeRequest(
        `http://localhost/api/cortera/events?workspaceId=default-workspace&limit=2&cursor=${firstJson.nextCursor}`,
        { headers: { "x-cortera-api-key": "sk-agent-123" } }
      )
    );
    const secondJson = await second.json();

    expect(firstJson.items).toHaveLength(2);
    expect(secondJson.items).toHaveLength(2);
    expect(firstJson.items[0].eventId).not.toBe(secondJson.items[0].eventId);
  });

  it("returns 401 without auth", async () => {
    const { GET } = await import("@/app/api/cortera/events/route");
    const request = makeRequest("http://localhost/api/cortera/events?workspaceId=default-workspace");

    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});

describe("GET /api/cortera/events/:eventId/chain", () => {
  beforeEach(() => {
    dbClient.events = [];
    dbClient.actorStates.clear();
    (dbClient as any).approvals = [];
  });

  it("returns full event chain with ancestors and descendants", async () => {
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");

    const rootReq = makeRequest("http://localhost/app/actions/restrictedNote", {
      method: "POST",
      body: { title: "Root", content: "Blast radius root" },
      headers: { "x-cortera-api-key": "sk-agent-123" },
    });
    const rootRes = await actionPost(rootReq, { params: { actionName: "restrictedNote" } });
    const rootJson = await rootRes.json();
    const rootEventId = rootJson.eventId || dbClient.events[0].id;

    const childReq = makeRequest("http://localhost/app/actions/deleteAllCustomers", {
      method: "POST",
      body: { reason: "oops" },
      headers: {
        "x-cortera-api-key": "sk-agent-123",
        "x-cortera-parent-event-id": rootEventId,
      },
    });
    await actionPost(childReq, { params: { actionName: "deleteAllCustomers" } });

    const { GET } = await import("@/app/api/cortera/events/[eventId]/chain/route");
    const request = makeRequest(
      `http://localhost/api/cortera/events/${rootEventId}/chain`,
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request, { params: { eventId: rootEventId } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.eventId).toBe(rootEventId);
    expect(json.actionName).toBe("restrictedNote");
    expect(json.descendants).toHaveLength(1);
    expect(json.descendants[0].actionName).toBe("deleteAllCustomers");
    expect(json.descendants[0].permissionResult).toBe("deny");
  });

  it("returns 404 for non-existent event", async () => {
    const { GET } = await import("@/app/api/cortera/events/[eventId]/chain/route");
    const request = makeRequest(
      "http://localhost/api/cortera/events/non-existent/chain",
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request, { params: { eventId: "non-existent" } });
    expect(response.status).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const { GET } = await import("@/app/api/cortera/events/[eventId]/chain/route");
    const request = makeRequest("http://localhost/api/cortera/events/some-id/chain");

    const response = await GET(request, { params: { eventId: "some-id" } });
    expect(response.status).toBe(401);
  });
});

describe("GET /api/cortera/actors/contained", () => {
  beforeEach(() => {
    dbClient.events = [];
    dbClient.actorStates.clear();
    (dbClient as any).approvals = [];
  });

  it("returns contained actors with reason and timestamp", async () => {
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    const rootReq = makeRequest("http://localhost/app/actions/restrictedNote", {
      method: "POST",
      body: { title: "Root", content: "Blast radius root" },
      headers: { "x-cortera-api-key": "sk-agent-123" },
    });
    const rootRes = await actionPost(rootReq, { params: { actionName: "restrictedNote" } });
    const rootJson = await rootRes.json();
    const rootEventId = rootJson.eventId || dbClient.events[0].id;

    const childReq = makeRequest("http://localhost/app/actions/deleteAllCustomers", {
      method: "POST",
      body: { reason: "oops" },
      headers: {
        "x-cortera-api-key": "sk-agent-123",
        "x-cortera-parent-event-id": rootEventId,
      },
    });
    await actionPost(childReq, { params: { actionName: "deleteAllCustomers" } });

    const { GET } = await import("@/app/api/cortera/actors/contained/route");
    const request = makeRequest(
      "http://localhost/api/cortera/actors/contained?workspaceId=default-workspace",
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].actorId).toBe("agent-1");
    expect(json.items[0].status).toBe("contained");
    expect(json.items[0].containedReason).toContain("blast radius");
    expect(json.items[0].containedAt).toBeDefined();
  });

  it("returns empty when no contained actors", async () => {
    const { GET } = await import("@/app/api/cortera/actors/contained/route");
    const request = makeRequest(
      "http://localhost/api/cortera/actors/contained?workspaceId=default-workspace",
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items).toHaveLength(0);
  });

  it("returns 401 without auth", async () => {
    const { GET } = await import("@/app/api/cortera/actors/contained/route");
    const request = makeRequest("http://localhost/api/cortera/actors/contained?workspaceId=default-workspace");

    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});

describe("GET /api/cortera/approvals/pending", () => {
  let approvalId: string;

  beforeEach(async () => {
    dbClient.events = [];
    dbClient.actorStates.clear();
    (dbClient as any).approvals = [];

    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    const req = makeRequest("http://localhost/app/actions/deleteCustomer", {
      method: "POST",
      body: { id: "cust-1" },
      headers: {
        cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
      },
    });
    const res = await actionPost(req, { params: { actionName: "deleteCustomer" } });
    const json = await res.json();
    approvalId = json.approvalId;
  });

  it("returns pending approvals with event data", async () => {
    const { GET } = await import("@/app/api/cortera/approvals/pending/route");
    const request = makeRequest(
      "http://localhost/api/cortera/approvals/pending?workspaceId=default-workspace",
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].approval.id).toBe(approvalId);
    expect(json.items[0].approval.actionName).toBe("deleteCustomer");
    expect(json.items[0].approval.status).toBe("pending");
    expect(json.items[0].event.actionName).toBe("deleteCustomer");
    expect(json.items[0].event.actorId).toBe("user-1");
    expect(json.items[0].event.input).toEqual({ id: "cust-1" });
  });

  it("filters by actionName", async () => {
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    await actionPost(
      makeRequest("http://localhost/app/actions/deleteCustomer", {
        method: "POST",
        body: { id: "cust-2" },
        headers: {
          cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-2", actorType: "human" })),
        },
      }),
      { params: { actionName: "deleteCustomer" } }
    );

    const { GET } = await import("@/app/api/cortera/approvals/pending/route");
    const request = makeRequest(
      "http://localhost/api/cortera/approvals/pending?workspaceId=default-workspace&actionName=deleteCustomer",
      { headers: { "x-cortera-api-key": "sk-agent-123" } }
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items.length).toBeGreaterThanOrEqual(1);
    expect(json.items.every((item: any) => item.approval.actionName === "deleteCustomer")).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const { GET } = await import("@/app/api/cortera/approvals/pending/route");
    const request = makeRequest("http://localhost/api/cortera/approvals/pending?workspaceId=default-workspace");

    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});

describe("GET /api/cortera/events/stream", () => {
  it("returns 401 without auth", async () => {
    const { GET } = await import("@/app/api/cortera/events/stream/route");
    const request = makeRequest("http://localhost/api/cortera/events/stream?workspaceId=default-workspace");

    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});

describe("POST /app/actions/[actionName]", () => {
  beforeEach(() => {
    dbClient.events = [];
    dbClient.actorStates.clear();
    (dbClient as any).approvals = [];
  });

  it("returns 200 with result on successful action call", async () => {
    const { POST } = await import("@/app/api/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/createNote", {
      method: "POST",
      body: { title: "Hello", content: "World" },
      headers: { "x-cortera-api-key": "sk-agent-123" },
    });

    const response = await POST(request, { params: { actionName: "createNote" } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.result).toEqual({ id: expect.stringMatching(/^note-\d+/), title: "Hello", content: "World" });
  });

  it("returns 404 for unknown action", async () => {
    const { POST } = await import("@/app/api/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/nonexistent", {
      method: "POST",
      headers: { "x-cortera-api-key": "sk-agent-123" },
    });

    const response = await POST(request, { params: { actionName: "nonexistent" } });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toContain("Action not found");
  });

  it("returns 400 with details on validation failure", async () => {
    const { POST } = await import("@/app/api/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/createNote", {
      method: "POST",
      body: { title: "", content: "" },
      headers: { "x-cortera-api-key": "sk-agent-123" },
    });

    const response = await POST(request, { params: { actionName: "createNote" } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid input");
    expect(json.details).toBeDefined();
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("returns 403 on permission denial", async () => {
    const { POST } = await import("@/app/api/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/notifyWatchers", {
      method: "POST",
      body: { noteId: "1", title: "Hi" },
      headers: {
        cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
      },
    });

    const response = await POST(request, { params: { actionName: "notifyWatchers" } });
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.reason).toBe("deny");
  });

  it("returns 202 with approvalId on approval_required", async () => {
    const { POST } = await import("@/app/api/actions/[actionName]/route");
    const request = makeRequest("http://localhost/app/actions/deleteCustomer", {
      method: "POST",
      body: { id: "cust-1" },
      headers: {
        cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
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
    const { POST } = await import("@/app/api/actions/[actionName]/route");
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

    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    const req = makeRequest("http://localhost/app/actions/deleteCustomer", {
      method: "POST",
      body: { id: "cust-1" },
      headers: {
        cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "user-1", actorType: "human" })),
      },
    });
    const res = await actionPost(req, { params: { actionName: "deleteCustomer" } });
    const json = await res.json();
    approvalId = json.approvalId;
  });

  it("resolves an approved approval and returns ok", async () => {
    const { POST } = await import("@/app/api/actions/approvals/[approvalId]/route");
    const request = makeRequest(
      `http://localhost/app/actions/approvals/${approvalId}`,
      {
        method: "POST",
        body: { decision: "approved" },
        headers: {
          cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
        },
      }
    );

    const response = await POST(request, { params: { approvalId } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("resolves a rejected approval and returns ok", async () => {
    const { POST } = await import("@/app/api/actions/approvals/[approvalId]/route");
    const request = makeRequest(
      `http://localhost/app/actions/approvals/${approvalId}`,
      {
        method: "POST",
        body: { decision: "rejected" },
        headers: {
          cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
        },
      }
    );

    const response = await POST(request, { params: { approvalId } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("returns 404 for unknown approval", async () => {
    const { POST } = await import("@/app/api/actions/approvals/[approvalId]/route");
    const request = makeRequest("http://localhost/app/actions/approvals/unknown", {
      method: "POST",
      body: { decision: "approved" },
      headers: {
        cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
      },
    });

    const response = await POST(request, { params: { approvalId: "unknown" } });

    expect(response.status).toBe(404);
  });

  it("returns 401 when no actor identity is found", async () => {
    const { POST } = await import("@/app/api/actions/approvals/[approvalId]/route");
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
    const { POST: actionPost } = await import("@/app/api/actions/[actionName]/route");
    const req = makeRequest("http://localhost/app/actions/restrictedNote", {
      method: "POST",
      body: { title: "Root", content: "Blast radius root" },
      headers: { "x-cortera-api-key": "sk-agent-123" },
    });
    const rootRes = await actionPost(req, { params: { actionName: "restrictedNote" } });
    const rootJson = await rootRes.json();
    const rootEventId = rootJson.eventId || (dbClient.events[0] && dbClient.events[0].id);

    const req2 = makeRequest("http://localhost/app/actions/deleteAllCustomers", {
      method: "POST",
      body: { reason: "oops" },
      headers: {
        "x-cortera-api-key": "sk-agent-123",
        "x-cortera-parent-event-id": rootEventId,
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
          cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
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
          cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
        },
      }
    );

    const response = await POST(request, { params: { actorId: "nonexistent" } });

    expect(response.status).toBe(404);
  });

  it("returns 400 when workspaceId is missing", async () => {
    const { POST } = await import("@/app/actors/[actorId]/review/route");
    const request = makeRequest("http://localhost/app/actors/actor-1/review", {
      method: "POST",
      body: { decision: "lift" },
      headers: {
        cookie: "cortera-session=" + encodeURIComponent(JSON.stringify({ actorId: "reviewer-1", actorType: "human" })),
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
