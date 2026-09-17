# Tera Example App

This app demonstrates Tera's Stage 4 Next.js adapter. Every Action registered in the `ActionRegistry` is automatically exposed as a REST endpoint.

## Quick Start (Fresh Clone)

```bash
# 1. Install dependencies
pnpm install

# 2. Apply database migrations (requires local Postgres/Supabase)
pnpm tera migrate --db-url postgresql://postgres:postgres@localhost:5432/tera

# 3. Start development server (with realtime dependency check)
pnpm tera dev

# 4. In another terminal, generate a new action
pnpm tera generate action myNewAction

# 5. Run pre-deploy safety checks
pnpm tera check
```

## CLI Commands Reference

### `tera dev`
Starts the Next.js development server and checks for realtime dependencies (Supabase Realtime/SSE).

```bash
pnpm tera dev                    # Run from example app directory
pnpm tera dev --example-app      # Run example app from monorepo root
```

**Startup Summary Output:**
```
📋 Startup Summary:
──────────────────────────────────────────────────
Dev Server:       http://localhost:3000
REST Base Path:   /actions
MCP Endpoint:     /mcp
Data API Base:    /api/tera
Supabase Realtime: Connected (or "Not running (run 'supabase start')")
──────────────────────────────────────────────────
```

### `tera generate action <name>`
Scaffolds a new Action file with the correct `ActionConfig` shape.

```bash
pnpm tera generate action createNote
# Creates: src/actions/createNoteAction.ts
```

**Generated template includes:**
- `defineAction` import from `@tera/core`
- Placeholder Zod input schema with `exampleField`
- Required `description` field pre-filled with TODO prompt
- Placeholder `permission` string
- Stub handler matching Stage 1's `ActionConfig` shape
- Commented `approvalTtlMs` and `blastRadius` examples

**Output reminder:** Register the action in your `ActionRegistry` manually — no auto-registration.

### `tera migrate`
Applies pending database migrations using `@tera/db`'s migration tool (node-pg-migrate).

```bash
pnpm tera migrate --db-url postgresql://postgres:postgres@localhost:5432/tera
pnpm tera migrate --down --db-url postgresql://...  # Rollback last migration
```

Requires `DATABASE_URL` environment variable or `--db-url` flag.

### `tera keys`
Manages API keys (stub — requires Stage 9 auth implementation).

```bash
pnpm tera keys create "my-key" --actor-id agent-1 --actor-type agent
pnpm tera keys list
pnpm tera keys revoke <key-id>
```

**Current status:** Shows "not yet implemented" message referencing Stage 9 dependency.

### `tera check`
Pre-deploy safety checklist — audits all registered actions.

```bash
pnpm tera check
```

**Checks performed:**
1. ✅ Every action has a non-empty description (enforced at definition time)
2. ⚠️ Every approval-required action has explicit `approvalTtlMs` or reports default usage
3. ⚠️ Every action has `blastRadius` set or explicitly flags it as unset (Stage 3.5 soft-warning)

**Exit codes:**
- `0` — All checks passed (or passed with warnings)
- `1` — Errors found (missing descriptions)

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/actions/[actionName]` | Execute an Action |
| POST | `/actions/approvals/[approvalId]` | Resolve an approval |
| POST | `/actors/[actorId]/review?workspaceId=...` | Review containment |
| GET | `/api/tera/events` | Paginated action events (Stage 7) |
| GET | `/api/tera/events/:id/chain` | Full event chain (Stage 7) |
| GET | `/api/tera/actors/contained` | Contained actors (Stage 7) |
| GET | `/api/tera/approvals/pending` | Pending approvals (Stage 7) |
| GET | `/api/tera/events/stream` | SSE live stream (Stage 7) |

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