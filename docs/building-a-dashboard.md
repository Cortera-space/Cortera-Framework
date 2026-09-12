# Building a Dashboard with Tera's Observability API

Tera does not ship a prebuilt admin dashboard. Instead, it exposes clean, headless, queryable/streamable APIs that you can build your own dashboard against. This document shows example calls against every endpoint.

## Authentication

All endpoints use the same authentication as action endpoints:

- **API Key**: `x-tera-api-key` header
- **Session Cookie**: `tera-session` cookie with `{ actorId, actorType }`

## Base URL

All examples assume your Next.js app runs at `http://localhost:3000`. Adjust for your deployment.

---

## 1. List Events

**GET** `/api/tera/events`

Paginated, most recent first. Supports filtering.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | string | Workspace UUID (required) |
| `actorType` | string | Filter by `human`, `agent`, or `system` |
| `actionName` | string | Filter by action name |
| `permissionResult` | string | Filter by `allow`, `deny`, `approval_required` |
| `from` | ISO 8601 | Start time (inclusive) |
| `to` | ISO 8601 | End time (inclusive) |
| `limit` | number | Page size (default: 50, max: 100) |
| `cursor` | ISO 8601 | Pagination cursor (timestamp of last item) |

### Example

```bash
# List recent events
curl -G "http://localhost:3000/api/tera/events" \
  -H "x-tera-api-key: sk-agent-123" \
  -d workspaceId=default-workspace \
  -d limit=20
```

```bash
# Filter by actor type and action
curl -G "http://localhost:3000/api/tera/events" \
  -H "x-tera-api-key: sk-agent-123" \
  -d workspaceId=default-workspace \
  -d actorType=agent \
  -d actionName=createNote \
  -d permissionResult=allow \
  -d from=2024-01-01T00:00:00Z
```

### Response

```json
{
  "items": [
    {
      "eventId": "event-123...",
      "actionName": "createNote",
      "actorType": "agent",
      "actorId": "agent-1",
      "permissionResult": "allow",
      "status": "completed",
      "input": { "title": "Hello", "content": "World" },
      "output": { "id": "note-123", "title": "Hello", "content": "World" },
      "error": null,
      "parentEventId": null,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "nextCursor": "2024-01-15T10:25:00.000Z"
}
```

### Pagination

Use `nextCursor` as the `cursor` parameter for the next page:

```bash
curl -G "http://localhost:3000/api/tera/events" \
  -H "x-tera-api-key: sk-agent-123" \
  -d workspaceId=default-workspace \
  -d cursor=2024-01-15T10:25:00.000Z
```

---

## 2. Get Event Chain

**GET** `/api/tera/events/:eventId/chain`

Returns the full ancestor/descendant tree for an event, assembled as a nested structure.

### Example

```bash
curl "http://localhost:3000/api/tera/events/event-123.../chain" \
  -H "x-tera-api-key: sk-agent-123"
```

### Response

```json
{
  "eventId": "event-123...",
  "actionName": "restrictedNote",
  "actorType": "agent",
  "actorId": "agent-1",
  "permissionResult": "allow",
  "status": "completed",
  "input": { "title": "Root", "content": "Blast radius root" },
  "output": { "id": "note-456", "title": "Root", "content": "Blast radius root" },
  "error": null,
  "parentEventId": null,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z",
  "ancestors": [],
  "descendants": [
    {
      "eventId": "event-124...",
      "actionName": "deleteAllCustomers",
      "actorType": "agent",
      "actorId": "agent-1",
      "permissionResult": "deny",
      "status": "completed",
      "input": { "reason": "oops" },
      "output": null,
      "error": { "code": "BLAST_RADIUS_EXCEEDED", "message": "..." },
      "parentEventId": "event-123...",
      "createdAt": "2024-01-15T10:30:05.000Z",
      "updatedAt": "2024-01-15T10:30:05.000Z",
      "ancestors": [/* parent reference */],
      "descendants": []
    }
  ]
}
```

---

## 3. List Contained Actors

**GET** `/api/tera/actors/contained`

Returns actors currently in `contained` or `revoked` state for a workspace.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | string | Workspace UUID (required) |

### Example

```bash
curl -G "http://localhost:3000/api/tera/actors/contained" \
  -H "x-tera-api-key: sk-agent-123" \
  -d workspaceId=default-workspace
```

### Response

```json
{
  "items": [
    {
      "actorId": "agent-1",
      "workspaceId": "default-workspace",
      "status": "contained",
      "containedAt": "2024-01-15T10:30:05.000Z",
      "containedReason": "action \"deleteAllCustomers\" (customers.delete) exceeds blast radius of root action \"restrictedNote\" (notes.*)",
      "reviewedBy": null,
      "reviewedAt": null
    }
  ]
}
```

---

## 4. List Pending Approvals

**GET** `/api/tera/approvals/pending`

Returns pending approvals joined with their originating action events.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | string | Workspace UUID (required) |
| `actionName` | string | Optional filter by action name |

### Example

```bash
curl -G "http://localhost:3000/api/tera/approvals/pending" \
  -H "x-tera-api-key: sk-agent-123" \
  -d workspaceId=default-workspace
```

### Response

```json
{
  "items": [
    {
      "approval": {
        "id": "approval-789...",
        "actionEventId": "event-456...",
        "actionName": "deleteCustomer",
        "input": { "id": "cust-1", "reason": "no longer needed" },
        "actorType": "human",
        "actorId": "user-1",
        "workspaceId": "default-workspace",
        "status": "pending",
        "requestedAt": "2024-01-15T11:00:00.000Z",
        "expiresAt": "2024-01-16T11:00:00.000Z",
        "resolvedAt": null,
        "approvedBy": null
      },
      "event": {
        "actionName": "deleteCustomer",
        "actorType": "human",
        "actorId": "user-1",
        "input": { "id": "cust-1", "reason": "no longer needed" },
        "requestedAt": "2024-01-15T11:00:00.000Z",
        "expiresAt": "2024-01-16T11:00:00.000Z"
      }
    }
  ]
}
```

---

## 5. Live Event Stream (SSE)

**GET** `/api/tera/events/stream`

Server-Sent Events stream pushing new `action_events` rows as they're inserted, using Postgres `LISTEN/NOTIFY`.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | string | Workspace UUID (required) |
| `actorType` | string | Optional filter |
| `actionName` | string | Optional filter |

### Example (curl)

```bash
curl -N "http://localhost:3000/api/tera/events/stream" \
  -H "x-tera-api-key: sk-agent-123" \
  -G \
  -d workspaceId=default-workspace \
  -d actorType=agent
```

### Example (JavaScript EventSource)

```javascript
const eventSource = new EventSource(
  "http://localhost:3000/api/tera/events/stream?workspaceId=default-workspace&actorType=agent",
  {
    headers: {
      "x-tera-api-key": "sk-agent-123",
    },
  }
);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "connected") {
    console.log("Stream connected");
    return;
  }
  console.log("New event:", data);
  // { event_id, action_name, actor_type, actor_id, permission_result, workspace_id, started_at }
};

eventSource.onerror = (err) => {
  console.error("SSE error:", err);
};
```

### Stream Format

Each message is a JSON object:

```json
{
  "event_id": "uuid",
  "action_name": "createNote",
  "actor_type": "agent",
  "actor_id": "agent-1",
  "permission_result": "allow",
  "workspace_id": "default-workspace",
  "started_at": "2024-01-15T10:30:00.000Z"
}
```

Connection message:
```json
{ "type": "connected" }
```

---

## 6. Resolve Approval (Action)

**POST** `/api/actions/approvals/:approvalId`

Approve or reject a pending approval.

### Example

```bash
# Approve
curl -X POST "http://localhost:3000/api/actions/approvals/approval-789..." \
  -H "Content-Type: application/json" \
  -H "x-tera-api-key: sk-agent-123" \
  -d '{"decision": "approved"}'

# Reject
curl -X POST "http://localhost:3000/api/actions/approvals/approval-789..." \
  -H "Content-Type: application/json" \
  -H "x-tera-api-key: sk-agent-123" \
  -d '{"decision": "rejected"}'
```

### Response

```json
{ "status": "ok" }
```

---

## 7. Review Containment (Action)

**POST** `/api/actors/:actorId/review`

Lift or revoke a contained actor.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | string | Workspace UUID (required) |

### Body

```json
{ "decision": "lift" }  // or "revoke"
```

### Example

```bash
# Lift containment
curl -X POST "http://localhost:3000/api/actors/agent-1/review?workspaceId=default-workspace" \
  -H "Content-Type: application/json" \
  -H "x-tera-api-key: sk-agent-123" \
  -d '{"decision": "lift"}'

# Revoke (permanent)
curl -X POST "http://localhost:3000/api/actors/agent-1/review?workspaceId=default-workspace" \
  -H "Content-Type: application/json" \
  -H "x-tera-api-key: sk-agent-123" \
  -d '{"decision": "revoke"}'
```

### Response

```json
{ "status": "ok" }
```

---

## Complete Dashboard Workflow Example

Here's a complete script demonstrating all five read capabilities plus the two write actions:

```bash
#!/bin/bash
set -e

BASE="http://localhost:3000"
API_KEY="sk-agent-123"
WS="default-workspace"

echo "=== 1. List Recent Events ==="
EVENTS=$(curl -s -G "$BASE/api/tera/events" \
  -H "x-tera-api-key: $API_KEY" \
  -d workspaceId=$WS \
  -d limit=5)
echo "$EVENTS" | jq .

# Extract first event ID for chain demo
FIRST_EVENT_ID=$(echo "$EVENTS" | jq -r '.items[0].eventId // empty')

echo -e "\n=== 2. Get Event Chain for $FIRST_EVENT_ID ==="
if [ -n "$FIRST_EVENT_ID" ]; then
  curl -s "$BASE/api/tera/events/$FIRST_EVENT_ID/chain" \
    -H "x-tera-api-key: $API_KEY" | jq .
else
  echo "No events found"
fi

echo -e "\n=== 3. List Contained Actors ==="
curl -s -G "$BASE/api/tera/actors/contained" \
  -H "x-tera-api-key: $API_KEY" \
  -d workspaceId=$WS | jq .

echo -e "\n=== 4. List Pending Approvals ==="
curl -s -G "$BASE/api/tera/approvals/pending" \
  -H "x-tera-api-key: $API_KEY" \
  -d workspaceId=$WS | jq .

echo -e "\n=== 5. Live Stream (5 seconds) ==="
timeout 5 curl -N -s -G "$BASE/api/tera/events/stream" \
  -H "x-tera-api-key: $API_KEY" \
  -d workspaceId=$WS \
  -d actorType=agent || true

echo -e "\n=== Done ==="
```

Save as `dashboard-demo.sh`, make executable (`chmod +x dashboard-demo.sh`), and run.

---

## Error Responses

All endpoints return standard error formats:

| Status | Condition | Body |
|--------|-----------|------|
| 200 | Success | Response data |
| 400 | Bad request (missing params) | `{ "error": "..." }` |
| 401 | No actor identity | `{ "error": "Unauthorized: no actor identity found" }` |
| 404 | Not found | `{ "error": "..." }` |
| 500 | Server error | `{ "error": "Internal server error" }` |

---

## Notes for Dashboard Builders

1. **Polling vs Streaming**: Use the SSE stream for real-time updates; poll `/events` for historical data.
2. **Cursor Pagination**: The `nextCursor` is a timestamp. Store it to resume later.
3. **Event Chain Depth**: Chains can be deep. The nested structure avoids N+1 queries.
4. **Containment is Per-Workspace**: An actor contained in one workspace is unaffected in others.
5. **Approval TTL**: Pending approvals expire after 24 hours (configurable per-action). Expired approvals won't appear in `/approvals/pending`.
6. **Revoked is Permanent**: A revoked actor cannot be lifted — they must be re-provisioned.