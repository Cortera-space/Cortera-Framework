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
