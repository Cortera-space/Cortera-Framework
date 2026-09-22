# Migration & Deployment Guide

Production-ready setup for Cortera Framework applications.

---

## Environment Variables

```bash
# Required
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"

# Optional
CORTERA_WORKSPACE_ID="production"  # Defaults to "default-workspace"
```

---

## Database Migrations

### Running Migrations

```bash
# Local development
npx cortera migrate

# Production (CI/CD)
npx cortera migrate --connection "$DATABASE_URL"
```

The migration system is **idempotent** — safe to run multiple times. It tracks applied migrations in a `cortera_migrations` table.

### Migration Files

Located in `packages/db/migrations/`:

| Migration | Description |
|-----------|-------------|
| `001_create_action_events.sql` | Core audit log table |
| `002_create_action_approvals.sql` | Approval workflow |
| `003_create_actor_states.sql` | Containment state |
| `004_create_pending_delayed_actions.sql` | Delayed execution queue |
| `005_create_irreversible_confirmations.sql` | Out-of-band confirmations |
| `006_create_api_keys.sql` | API key management |

---

## Auth Integration (Production)

Replace the placeholder `resolveActorFromRequest` with your auth system.

### NextAuth Example

```ts
// lib/auth.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

export async function resolveActor(req: NextRequest): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  return {
    actorType: session.user.role === "admin" ? "system" : "human",
    actorId: session.user.id,
  };
}
```

### Clerk Example

```ts
// lib/auth.ts
import { currentUser } from "@clerk/nextjs/server";

export async function resolveActor(req: NextRequest): Promise<Actor | null> {
  const user = await currentUser();
  if (!user) return null;

  return {
    actorType: "human",
    actorId: user.id,
  };
}
```

### Supabase Example

```ts
// lib/auth.ts
import { createServerClient } from "@supabase/ssr";

export async function resolveActor(req: NextRequest): Promise<Actor | null> {
  const supabase = createServerClient(/* ... */);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  return {
    actorType: "human",
    actorId: user.id,
  };
}
```

### Custom API Key Integration

```ts
// lib/auth.ts
import { validateApiKey } from "@cortera/auth";
import { PostgresDbClient } from "@cortera/db";

const db = new PostgresDbClient({ connectionString: process.env.DATABASE_URL! });

export async function resolveActor(req: NextRequest): Promise<Actor | null> {
  // Check API key first
  const apiKey = req.headers.get("x-cortera-api-key");
  if (apiKey) {
    const valid = await validateApiKey(db, apiKey);
    if (valid) {
      return { actorType: "agent", actorId: valid.actorId };
    }
  }

  // Fall back to session auth
  const session = await getSession(req);
  if (session?.user) {
    return { actorType: "human", actorId: session.user.id };
  }

  return null;
}
```

Then use in your route handler:

```ts
// app/api/actions/[actionName]/route.ts
import { createActionHandler } from "@cortera/adapter-next";
import { resolveActor } from "@/lib/auth";

const actionHandler = createActionHandler({
  registry,
  dbClient,
  permissionEngine,
  resolveActor,  // Your custom resolver
  defaultWorkspaceId,
});
```

---

## API Key Management

### Creating Keys

```bash
# Via CLI
npx cortera keys create "Production Agent" --workspace production

# Via code
import { createApiKey } from "@cortera/auth";
import { PostgresDbClient } from "@cortera/db";

const db = new PostgresDbClient({ connectionString: process.env.DATABASE_URL! });
const { key, keyId } = await createApiKey(db, "agent-1", "production", "Production Agent");
// Store `key` securely — only shown once!
```

### Listing Keys

```bash
npx cortera keys list --workspace production
```

```ts
import { listApiKeys } from "@cortera/auth";
const keys = await listApiKeys(db, "production");
```

### Revoking Keys

```bash
npx cortera keys revoke key_abc123 --workspace production
```

```ts
import { revokeApiKey } from "@cortera/auth";
await revokeApiKey(db, "key_abc123");
```

---

## Workspace Configuration

### Multi-Workspace Setup

```ts
// lib/registry.ts
export const workspaces = {
  production: {
    id: "production",
    contactResolver: {
      async getContact() {
        return { channel: "email", destination: "security@company.com" };
      },
    },
  },
  staging: {
    id: "staging",
    contactResolver: {
      async getContact() {
        return { channel: "email", destination: "dev@company.com" };
      },
    },
  },
};
```

### Workspace Contact Resolver

Required for `riskTier: "irreversible"` actions:

```ts
const resolver: WorkspaceContactResolver = {
  async getContact(workspaceId) {
    const config = workspaces[workspaceId];
    if (!config) return null;
    return config.contactResolver.getContact(workspaceId);
  },
};

(globalThis as any).__CORTERA_CONTACT_RESOLVER__ = resolver;
```

---

## Background Jobs

Run these periodically in production:

### Approval Expiry

```bash
# Every 5 minutes
npx cortera run expire-approvals
```

```ts
// Or in your own scheduler
import { expirePendingApprovals } from "@cortera/core";
setInterval(() => expirePendingApprovals(db), 5 * 60 * 1000);
```

### Delayed Action Sweep

```bash
# Every minute
npx cortera run process-delayed
```

```ts
import { processPendingDelayedActions } from "@cortera/core";
setInterval(() => processPendingDelayedActions(db), 60 * 1000);
```

### Irreversible Confirmation Expiry

```bash
# Every 5 minutes
npx cortera run expire-confirmations
```

```ts
import { expirePendingIrreversibleConfirmations } from "@cortera/core";
setInterval(() => expirePendingIrreversibleConfirmations(db), 5 * 60 * 1000);
```

---

## Deployment Checklist

- [ ] `DATABASE_URL` set with SSL
- [ ] Migrations run (`npx cortera migrate`)
- [ ] Custom `resolveActor` implemented
- [ ] Workspace contact resolver configured (for irreversible actions)
- [ ] Background jobs scheduled (approvals, delayed actions, confirmations)
- [ ] API keys created for agents
- [ ] Permission rules configured for all actors
- [ ] Blast radius declared on all actions
- [ ] Health check endpoint monitors `action_events` table

---

## Monitoring

### Key Metrics to Alert On

| Metric | Threshold | Action |
|--------|-----------|--------|
| Contained actors count | > 0 | Page on-call |
| Pending approvals > 24h | > 0 | Review queue |
| Failed action rate | > 1% | Investigate |
| Event latency (p99) | > 5s | Check DB |

### Useful Queries

```sql
-- Contained actors
SELECT * FROM actor_states WHERE status = 'contained';

-- Pending approvals expiring soon
SELECT * FROM action_approvals
WHERE status = 'pending' AND expires_at < now() + interval '1 hour';

-- Recent failures
SELECT * FROM action_events
WHERE permission_result = 'deny' AND created_at > now() - interval '1 hour';
```