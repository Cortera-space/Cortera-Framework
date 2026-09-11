# Tera Example App

This app demonstrates Tera's Stage 4 Next.js adapter. Every Action registered in the `ActionRegistry` is automatically exposed as a REST endpoint.

## Running

```bash
pnpm dev
```

Then visit `http://localhost:3000`.

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/actions/[actionName]` | Execute an Action |
| POST | `/actions/approvals/[approvalId]` | Resolve an approval |
| POST | `/actors/[actorId]/review?workspaceId=...` | Review containment |

## Actor Resolution

The adapter resolves actors from requests in this order:

1. **API Key**: `x-tera-api-key` header. Example keys:
   - `sk-agent-123` → `actorId: "agent-1", actorType: "agent"`
2. **Session Cookie**: `tera-session` cookie containing JSON `{ actorId, actorType }`.

## Example Calls

### Successful Action Call

```bash
curl -X POST http://localhost:3000/actions/createNote \
  -H "Content-Type: application/json" \
  -H "x-tera-api-key: sk-agent-123" \
  -d '{"title":"Hello Tera","content":"First note via REST"}'
```

Response:
```json
{"result":{"id":"note-...","title":"Hello Tera","content":"First note via REST"}}
```

### Denied Call (Permission)

```bash
curl -X POST http://localhost:3000/actions/notifyWatchers \
  -H "Content-Type: application/json" \
  -b 'tera-session={"actorId":"user-1","actorType":"human"}' \
  -d '{"noteId":"1","title":"Hi"}'
```

Response:
```json
{"error":"actor lacks permission: notifications.send","reason":"deny"}
```

### Pending Approval Flow

```bash
# Step 1: Request action that requires approval
curl -X POST http://localhost:3000/actions/deleteCustomer \
  -H "Content-Type: application/json" \
  -b 'tera-session={"actorId":"user-1","actorType":"human"}' \
  -d '{"id":"cust-1"}'
```

Response:
```json
{"status":"pending","approvalId":"approval-..."}
```

```bash
# Step 2: Approve the action (use the approvalId from step 1)
curl -X POST http://localhost:3000/actions/approvals/approval-... \
  -H "Content-Type: application/json" \
  -b 'tera-session={"actorId":"reviewer-1","actorType":"human"}' \
  -d '{"decision":"approved"}'
```

Response:
```json
{"status":"ok"}
```

### Containment Review

```bash
# Lift a contained actor
curl -X POST "http://localhost:3000/actors/agent-1/review?workspaceId=default-workspace" \
  -H "Content-Type: application/json" \
  -b 'tera-session={"actorId":"reviewer-1","actorType":"human"}' \
  -d '{"decision":"lift"}'
```

Response:
```json
{"status":"ok"}
```

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| 200 | Success | `{ result }` |
| 400 | Validation error | `{ error, details }` |
| 401 | No actor identity | `{ error }` |
| 403 | Permission or containment denied | `{ error, reason }` |
| 404 | Action/approval not found | `{ error }` |
| 202 | Approval required | `{ status: "pending", approvalId }` |
| 409 | Invalid approval state or cannot lift revoked actor | `{ error }` |
| 500 | Unhandled error | `{ error }` |
