# Core Concepts

Deep dive into Tera's foundational primitives.

---

## The Action Primitive

An Action is the single source of truth for an operational capability. One definition generates four surfaces automatically:

1. **REST Endpoint** — `POST /actions/:name`
2. **MCP Tool Schema** — Agent-callable via Model Context Protocol
3. **UI Form** — `<ActionForm action={...} />` from `@tera/ui`
4. **Trace Span** — Structured `action_events` row in Postgres

### ActionConfig

```ts
interface ActionConfig<TInput extends z.ZodTypeAny, TOutput = unknown> {
  name: string;                          // Unique identifier
  description: string;                   // Human-authored (required)
  inputSchema: TInput;                   // Zod schema — single source for validation + tool schema
  permission: string;                    // Permission key (e.g., "invoices:write")
  handler: (input, ctx) => Promise<TOutput>;
  blastRadius?: string[];                // Downstream permissions this action may touch
  riskTier?: "instant" | "delayed" | "irreversible";  // Reversibility tier
  delayWindowMs?: number;                // Window for "delayed" tier (default: 5 min)
  confirmationTtlMs?: number;            // TTL for "irreversible" confirmation (default: 15 min)
  rollback?: (output, ctx) => Promise<void>;  // Rollback for "delayed" tier
  approvalTtlMs?: number;                // Approval TTL (default: 24h)
}
```

---

## Actor Model

Every invocation has an `Actor`:

```ts
interface Actor {
  actorType: "human" | "agent" | "system";
  actorId: string;
}
```

**Key principle**: No separate code paths for human vs. agent callers. Permission checks, blast radius evaluation, and audit logging treat all actors uniformly.

### Actor Resolution

The adapter provides `resolveActorFromRequest` which checks (in order):

1. **API Key** — `x-tera-api-key` header → lookup in `api_keys` table
2. **Session Cookie** — `tera-session` cookie with `{ actorId, actorType }`
3. **Fallback** — Returns `null` → 401 Unauthorized

In production, replace with your auth integration (NextAuth, Clerk, Supabase, etc.).

---

## Permission Model

Permissions are checked **before** the handler executes.

| Result | Behavior |
|--------|----------|
| `"allow"` | Handler runs, event logged with `permission_result: "allow"` |
| `"deny"` | Handler skipped, event logged with `permission_result: "deny"` |
| `"approval_required"` | Handler skipped, event logged, approval workflow initiated |

**Default is deny** for anything not explicitly listed.

### InMemoryPermissionEngine

```ts
const engine = new InMemoryPermissionEngine();
engine.addRule({ actorType: "human", permissionKey: "invoices:write", result: "allow" });
engine.addRule({ actorType: "agent", permissionKey: "invoices:write", result: "allow" });
engine.addRule({ actorType: "human", permissionKey: "customers:delete", result: "approval_required" });
```

Rules match by `permissionKey` + optional `actorType` + optional `actorId`. First match wins.

### Approval TTL

`approval_required` events auto-deny after TTL (default: **24 hours**, configurable per-action via `approvalTtlMs`). Auto-denied events receive reason `"approval_expired"`.

---

## Event Log

Each Action invocation produces **one row** in `action_events`:

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | UUID | Primary key |
| `action_name` | text | Action name |
| `actor_type` | text | `"human" \| "agent" \| "system"` |
| `actor_id` | text | Actor identifier |
| `permission_result` | text | `"allow" \| "deny" \| "approval_required" \| "delayed" \| "pending_confirmation"` |
| `status` | text | `"completed" \| "failed" \| "pending" \| "canceled"` |
| `input` | jsonb | Validated input |
| `output` | jsonb | Handler return value (null on error) |
| `error` | text | Error message if failed |
| `parent_event_id` | UUID | For chaining |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `dry_run` | boolean | Whether this was a dry run |

### Event Chaining

`parent_event_id` links related events. If an agent calls Action A which calls Action B, the tree is preserved.

```ts
// In a handler, chain to another action:
const result = await otherAction.execute(input, withParent(ctx, eventId), db, perms);
```

---

## Blast Radius & Auto-Containment

### Blast Radius

```ts
blastRadius: ["invoices:*", "notifications:send"]
```

An array of permission-key patterns. `*` wildcard supported (`invoices.*` matches `invoices.create`, `invoices.delete`, etc.).

If omitted, the action has no restriction beyond normal permission checks (a warning is logged at definition time).

### Actor State Machine

```
active → contained → revoked
```

- **active**: Normal operation
- **contained**: Triggered automatically when a call chain exceeds the root action's declared blastRadius. ALL future calls from that actor in that workspace auto-deny immediately (hard gate, no approval queue) until human review.
- **revoked**: Permanent state set only by explicit human action after reviewing a contained actor. Requires re-provisioning to become active again.

**Containment is per-workspace** — an actor contained in one workspace remains active in others.

### Chain-Boundary Checking

Before running the permission check, a chain-boundary check runs:

1. Look up actor's state. If `"contained"` or `"revoked"`: deny immediately, write event with `permission_result: "deny"` and error code `"ACTOR_CONTAINED"` or `"ACTOR_REVOKED"`.
2. If `"active"` and call has `parentEventId`: walk parent chain to find root action's `blastRadius`. If current action's `permission` key not covered:
   - Deny this call (`permission_result: "deny"`, error code `"BLAST_RADIUS_EXCEEDED"`)
   - Upsert actor state to `"contained"` with `contained_at: now()` and reason
3. If within blast radius (or no parent chain / root has no blastRadius): proceed to normal permission engine.

### Review / Lift Functions

```ts
await reviewContainedActor(db, actorId, workspaceId, "lift", reviewerActorId);
// Sets status back to "active", records reviewed_by and reviewed_at

await reviewContainedActor(db, actorId, workspaceId, "revoke", reviewerActorId);
// Sets status to "revoked" — permanent, cannot be lifted via this function
```

---

## Risk Modes

Each agent/Action can be configured with a `riskMode`:

| Mode | Behavior |
|------|----------|
| **`guarded`** (default) | Three-tier gating based on `riskTier` |
| **`autonomous`** | No action-level gating; runs at full speed, relying solely on Blast Radius + Containment as after-the-fact backstop |

### Guarded Mode Tiers

| Tier | Reversibility | Behavior |
|------|---------------|----------|
| `instant` | Read-only / reversible | Executes immediately |
| `delayed` | Reversible with side effects | Schedules execution; cancelable window; auto-rollback on cancel |
| `irreversible` | Destructive, non-reversible | Hard-blocks pending out-of-band confirmation (email/SMS to pre-registered workspace contact) |

```ts
defineAction({
  name: "deleteWorkspace",
  riskTier: "irreversible",
  blastRadius: ["workspaces:*"],
  handler: async (input) => { /* actually deletes workspace */ },
});

// In autonomous mode, runs immediately regardless of tier
await action.execute(input, ctx, db, perms, { riskMode: "autonomous" });
```

### Delayed Execution (riskTier: "delayed")

1. Scheduling checks run (containment + permission, **NOT blast radius**)
2. Action event logged with `permission_result: "delayed"`
3. Row inserted into `pending_delayed_actions` with `scheduledRunAt`
4. Background sweep (`processPendingDelayedActions`) **re-checks all checks at execution time** (containment, blast radius, permission)
5. If actor became contained during delay → correctly denied

### Irreversible Execution (riskTier: "irreversible")

1. Scheduling checks run
2. Action event logged with `permission_result: "pending_confirmation"`
3. Secure random token generated
4. Pre-registered workspace contact resolved (anti-spoofing)
5. Out-of-band notification sent (email/SMS with mock fallback)
6. At confirmation time: **re-checks permission and containment**
7. If confirmed: executes handler, writes linked event for audit trail

---

## Dry-Run Execution Mode

Any Action call may pass `{ dryRun: true }`. In dry-run mode, Tera runs the full pre-execution pipeline **without** invoking the handler:

- Actor state check (contained/revoked)
- Blast-radius evaluation
- Permission check
- Input validation

**Result**: `{ wouldSucceed: true }` on success, or the same error/result shape a real failed call would produce.

| Interface | Usage |
|-----------|-------|
| REST | `POST /actions/:name?dryRun=true` |
| MCP | `dryRun` boolean auto-injected into every tool schema |
| Programmatic | `action.execute(input, ctx, db, perms, { dryRun: true })` |

**Dry-run events** are logged to `action_events` with `dry_run: true`, `output: null`, and the same `permission_result` a real call would have gotten. Observability API defaults to EXCLUDING dry-run events unless explicitly requested.

---

## Out-of-Band Confirmation

For `riskTier: "irreversible"` actions, Tera implements a confirmation flow that the agent's own session cannot spoof:

1. Workspace contact pre-registered via `WorkspaceContactResolver`
2. Secure random token generated (cryptographically strong)
3. Notification sent to pre-registered email/SMS (mock fallback in dev)
3. Confirmation endpoint validates token, **re-checks permission + containment**
4. Only then executes handler

```ts
const resolver: WorkspaceContactResolver = {
  async getContact(workspaceId) {
    if (workspaceId === "default-workspace") {
      return { channel: "email", destination: "admin@example.com" };
    }
    return null;
  },
};

(globalThis as any).__TERA_CONTACT_RESOLVER__ = resolver;
```

---

## Rollback Scaffolding

For `riskTier: "delayed"` actions with a `rollback` function:

```ts
defineAction({
  name: "transferFunds",
  riskTier: "delayed",
  rollback: async (output, ctx) => {
    await db.transfers.reverse(output.transferId);
  },
  handler: async (input) => {
    const transfer = await db.transfers.create(input);
    return { transferId: transfer.id };
  },
});
```

- Cancel during delay window: `cancelDelayedAction(db, pendingId, cancelingActorId)` → calls rollback if executed
- Sweep at execution time: if checks fail, rollback NOT called (handler never ran)

---

## Summary: What You Get For Free

| Concern | Traditional Approach | Tera |
|---------|---------------------|------|
| Input validation | Manual Zod in route | From `inputSchema` |
| Audit log | Manual DB write | Automatic `action_events` row |
| Agent tool schema | Manual OpenAPI/MCP | Zod → JSON Schema |
| UI form | Manual React | `<ActionForm action={...} />` |
| Permission check | Middleware per route | `permission` key + engine |
| Blast radius | Manual if statements | Declarative `blastRadius` |
| Containment | N/A | Automatic actor freeze |
| Approval workflow | Custom queue | Built-in with TTL |
| Dry-run simulation | Custom flag | `{ dryRun: true }` |
| Reversibility tiers | Custom logic | `riskTier` + riskMode |
| Out-of-band confirmation | Custom infra | Built-in for irreversible |

All from **one** `defineAction` call.