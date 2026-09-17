# Tera Architecture

## Locked Decisions

This document records the architecture decisions for the Tera framework.
These decisions are **locked** — future stages must reference this file and
must not change these semantics without a full architectural review.

---

## 1. Core Primitive: The Action

An Action is the single source of truth for an operational capability.
One Action definition generates four surfaces automatically:

1. **REST Endpoint** — HTTP interface for human/AI clients
2. **MCP Tool Schema** — Agent-callable tool definition
3. **UI Form / Trigger** — Auto-generated form for human operators
4. **Trace Span** — Structured audit log entry for observability

An Action is defined by:
- `name` (string)
- `description` (required, human-authored — never auto-generated)
- `inputSchema` (Zod schema)
- `permission` key (string or pattern)
- `handler` (async function)

---

## 2. Actor Model

Every invocation has an `Actor` attached:

```typescript
interface Actor {
  actorType: "human" | "agent" | "system";
  actorId: string;
}
```

The actor is polymorphic across the entire system. There are **no** separate
code paths for human vs. agent callers. Permission checks and audit logging
treat all actors uniformly.

---

## 3. Permission Model

Permissions are checked **before** the handler executes.

Results:
- `"allow"` — handler runs, event is logged
- `"deny"` — handler is skipped, event is logged with `permission_denied`
- `"approval_required"` — handler is skipped, event is logged, approval
  workflow is initiated

**Default is deny** for anything not explicitly listed.

### Approval TTL

`approval_required` events auto-deny after a TTL (default: **24 hours**,
configurable per-action). Auto-denied events receive the reason
`"approval_expired"`.

---

## 4. Event Log

Each Action invocation produces **one row** in a Postgres table `action_events`.

Schema key fields:
- `event_id` (UUID primary key)
- `action_name` (text)
- `actor_type` (text: "human" | "agent" | "system")
- `actor_id` (text)
- `permission_result` (text)
- `status` (text)
- `input` (jsonb)
- `output` (jsonb, nullable)
- `error` (text, nullable)
- `parent_event_id` (UUID, nullable) — for chaining
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### Event Chaining

`parent_event_id` links related events. If an agent calls Action A which
calls Action B, the tree is preserved — not flattened into a flat list.

---

## 6. Blast Radius & Actor Containment (Stage 3.5)

### ActionConfig Extension

`ActionConfig` has an optional `blastRadius?: string[]` field — an array of
permission-key patterns (e.g. `["invoices.*", "notifications.send"]`). If
omitted, the action has no restriction beyond normal permission checks (a
warning is logged at definition time).

### Actor State Machine

Actors have a state: `"active" | "contained" | "revoked"`.

- **active**: normal operation.
- **contained**: triggered automatically when a call chain exceeds the
  triggering action's declared blastRadius. ALL future calls from that actor
  in that workspace auto-deny immediately (hard gate, no approval queue)
  until a human reviews.
- **revoked**: a separate, permanent state set only by explicit human action
  after reviewing a contained actor. Requires re-provisioning (new
  key/registration) to become active again.

### Containment Scope

Containment is **per-workspace**, not global. An actor contained in one
workspace remains active in others.

### Chain-Boundary Checking

Before running an Action's permission check (Stage 3's engine), a chain-
boundary check runs first:

1. Look up the actor's current state for this workspace. If `"contained"` or
   `"revoked"`: deny immediately, write an `action_events` row with
   `permission_result: "deny"` and error code `"ACTOR_CONTAINED"` or
   `"ACTOR_REVOKED"`.
2. If the actor is `"active"` and the call has a `parentEventId`: walk the
   parent chain to find the root triggering action's declared `blastRadius`.
   If the current action's `permission` key is not covered by that
   blastRadius, this is a violation:
   - Deny this specific call (`permission_result: "deny"`, error code
     `"BLAST_RADIUS_EXCEEDED"`).
   - Upsert the actor's state to `"contained"` with `contained_at: now()`
     and a `contained_reason` describing the violation.
   - The error JSONB encodes the containment detail so the trace viewer
     (later stage) can render it distinctly from a normal deny.
3. If within blast radius (or no parent chain / root action has no
   blastRadius restriction): proceed to Stage 3's normal permission engine.

### Wildcard Matching

`blastRadius` patterns support simple `*` wildcard matching (e.g.
`"invoices.*"` matches `"invoices.create"`, `"invoices.delete"`, etc.),
consistent with Stage 3's permission key matching.

### Review / Lift Functions

- `reviewContainedActor(actorId, workspaceId, decision, reviewerActorId)`:
  - `"lift"`: sets status back to `"active"`, records `reviewed_by` and
    `reviewed_at`.
  - `"revoke"`: sets status to `"revoked"`, records `reviewed_by` and
    `reviewed_at`. Permanent — cannot be lifted via this function.

---

## 7. Platform Layer

Tera ships **on top of Next.js**. Developers keep their existing Next app and
add Actions to it. Tera is not a standalone framework.

---

## 8. Realtime / Live-Tail

Realtime features (live audit tail, realtime approval notifications) use
**Postgres LISTEN/NOTIFY** or **Supabase Realtime**. No separate message
queue is introduced at this stage.

## 9. Adapter Layer — REST (Stage 4)

Tera ships on top of Next.js. The `@tera/adapter-next` package provides
route handler generators that expose every registered Action as a REST
endpoint with zero manual route code per Action.

### Routes

| Path | Method | Description |
|------|--------|-------------|
| `/app/actions/[actionName]/route.ts` | POST | Execute an Action |
| `/app/actions/approvals/[approvalId]/route.ts` | POST | Resolve an approval |
| `/app/actors/[actorId]/review/route.ts` | POST | Review containment |

### Error Mapping

- `200` — success with `{ result }`
- `400` — `ActionValidationError` with `{ error, details }`
- `401` — no actor identity found
- `403` — `ActionPermissionError` or `ActionContainmentError` with `{ error, reason }`
- `404` — action not found or approval not found
- `202` — `ActionPendingApprovalError` with `{ status: "pending", approvalId }`
- `409` — approval is not pending or expired, or cannot lift a revoked actor
- `500` — unhandled error (internal details logged only)

### Placeholder Auth Strategy

The adapter provides a simple actor resolution strategy. This is a
placeholder for real auth/API-key management (later stage).

Resolution order:

1. **API Key**: If an `x-tera-api-key` header is present, look it up in a
   simple `ApiKeyMapping` map. Each key maps to `{ actorId, actorType }`.
   Example: `{ "sk-agent-123": { actorId: "agent-1", actorType: "agent" } }`.
2. **Session Cookie**: If a `tera-session` cookie is present, parse it as
   JSON containing `{ actorId, actorType }`. This represents a human
   session from the app's auth layer.
3. **Fallback**: If neither is present, the request is unauthenticated
   and receives a `401` response.

In production, the `resolveActor` function should be replaced with a
proper integration to the app's auth system (NextAuth, Clerk, Supabase,
etc.) that extracts the actor identity from the authenticated session.

---

## 10. Observability & Approval Query API (Stage 7)

Tera does not ship a prebuilt admin dashboard. This stage exposes the
data/streaming primitives a developer needs to build their own. A
first-party `@tera/dashboard` package may be added later, once real
usage patterns are understood — deferred intentionally, not because
it's out of scope forever.

The following primitives are exposed:

1. **REST Query Endpoints** (authenticated via API key/session):
   - `GET /tera/events` — paginated action events with filters
   - `GET /tera/events/:id/chain` — full ancestor/descendant event tree
   - `GET /tera/actors/contained` — currently contained actors
   - `GET /tera/approvals/pending` — pending approvals with full context

2. **SSE Live Stream**:
   - `GET /tera/events/stream` — Server-Sent Events stream of new action_events
     matching workspace/filters, using Postgres LISTEN/NOTIFY

3. **Action Endpoints** (already exist from Stages 3/3.5/4):
   - `POST /actions/approvals/:approvalId` — resolve approval (approve/reject)
   - `POST /actors/:actorId/review` — review containment (lift/revoke)

Developers can build any dashboard UI against these primitives without
depending on Tera's internal implementation.

---

## 11. Dry-Run Execution Mode

Any Action call may pass `{ dryRun: true }`. In dry-run mode, Tera runs
the full pre-execution pipeline — actor state check (contained/revoked),
blast-radius evaluation, permission check, and input validation — exactly
as a real call would, but stops before invoking the handler. The result
reports what WOULD have happened (`{ wouldSucceed: true }` on success, or
the same error/result shape a real failed call would produce) without any
handler side effects occurring.

### Dry-Run Behavior

- **Actor state check (Stage 3.5)**: Runs normally. A contained actor's
  dry run reports "would be denied: actor is contained" — does not
  silently pass.
- **Blast-radius evaluation (Stage 3.5)**: Runs against the live parent
  chain if present. If the check would fail, reports "would be contained"
  but does NOT actually flip the actor's state to "contained" in
  `actor_states`. Only a REAL execution attempt causes a real containment
  transition.
- **Permission check (Stage 3)**: Runs normally.
- **Input validation (Stage 1)**: Runs normally.
- **Handler**: NOT called in dry-run mode.
- **Event logging**: Dry-run calls are logged to `action_events` with
  `dry_run: true`, `output: null` (never populated), and the same
  `permission_result` value a real call would have gotten.

### Observability API Default Behavior

`listEvents` and `getEventWithChain` default to EXCLUDING dry-run events
unless explicitly requested via a `dryRun` filter parameter, since most
callers querying "what actually happened" don't want simulated calls
mixed in.

### REST Adapter

Accepts a `?dryRun=true` query parameter on the existing Action-call
route (`POST /actions/[actionName]`).

### MCP Tool Schema

An optional `dryRun` boolean is automatically injected into every
generated tool's input schema (framework-level capability, not
per-Action).

---

## 12. Trust Propagation & Data Provenance (Stage 14)

### Trust Labels

Every piece of data flowing through the system carries a trust label:
- **`trusted`** — data originating from authenticated, authorized actors within the system
- **`untrusted-external`** — data originating from external tools, APIs, or unverified sources

### ActionConfig Extension

`ActionConfig` has an optional `sanitizes?: boolean` field. When `true`, this Action's output is treated as `trusted` regardless of input taint, because the Action author asserts the handler genuinely validates/cleans the data (e.g., an Action whose entire job is validating an external API response against a strict allowlist). Default is `false` — taint propagates through by default, sanitization is opt-in and the author is asserting a real guarantee.

### Provenance Propagation Rules

Trust labels propagate through causal chains: an Action's output is labeled `untrusted-external` if any contributing input was `untrusted-external` — taint is contagious downstream, never automatically cleaned by passing through a handler. An Action author may explicitly mark specific outputs as re-trusted via a `sanitizes: true` declaration ONLY when the handler performs a genuine validation/sanitization step — this must be an explicit, deliberate opt-in per Action, never a default.

**Propagation Algorithm:**
1. If `actionConfig.sanitizes === true`: output is `trusted` regardless of input labels
2. Otherwise: if ANY input field's provenance is `untrusted-external`, the output is `untrusted-external`
3. Only if ALL inputs are `trusted` is the output `trusted`

### Data Provenance Storage

Provenance is recorded in a `data_provenance` table linked to `action_events`:

```sql
CREATE TABLE data_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES action_events(id) ON DELETE CASCADE,
  field_path text NOT NULL,           -- e.g., "output", "input.fieldName"
  label text NOT NULL CHECK (label IN ('trusted', 'untrusted-external')),
  source_event_id uuid REFERENCES action_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Each Action execution records one `data_provenance` row for its **output** (field_path = "output"), capturing:
- The computed trust label
- The `source_event_id` (the parent event that provided the input, if any)

### Automatic Input Resolution

When a downstream Action calls a prior Action's output as its input (via the existing `ctx.withParent()` chaining mechanism), the input field's provenance is **automatically resolved** from the parent event's output-provenance record — no manual redeclaration required by the caller. This makes propagation automatic across multi-hop chains.

### Provenance Trace Query

`getProvenanceTrace(eventId)` returns the full chain of provenance decisions leading to a given event:
- Which upstream event(s) contributed untrusted data
- Whether any intermediate Action sanitized the data (`isSanitized: true`)
- The complete causal chain from source to target

This is inspectable/debuggable the same way the action chain itself is inspectable via `getEventWithChain`.

### Sanitization Does Not Rewrite History

When an Action with `sanitizes: true` cleans taint:
- Its output becomes `trusted` for downstream propagation
- **Upstream provenance records remain unchanged** — the original `untrusted-external` source is still recorded in history
- `getProvenanceTrace` shows both the original taint and the sanitization point

### Enforcement (Stage 14c)

This stage builds propagation logic only. Enforcement — forcing confirmation on untrusted-rooted calls — is Stage 14c.