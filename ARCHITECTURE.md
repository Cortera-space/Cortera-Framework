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

## 5. Platform Layer

Tera ships **on top of Next.js**. Developers keep their existing Next app and
add Actions to it. Tera is not a standalone framework.

---

## 6. Realtime / Live-Tail

Realtime features (live audit tail, realtime approval notifications) use
**Postgres LISTEN/NOTIFY** or **Supabase Realtime**. No separate message
queue is introduced at this stage.
