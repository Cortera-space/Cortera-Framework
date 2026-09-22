# Quickstart

Get Cortera Framework running in your Next.js app in under 10 minutes.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (or Supabase/Neon)
- A Next.js 14+ app (App Router)

---

## 1. Install Packages

```bash
pnpm add @cortera/core @cortera/db @cortera/adapter-next @cortera/ui @cortera/mcp @cortera/auth
```

---

## 2. Configure Database

Create `.env.local`:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/cortera"
```

---

## 3. Run Migrations

```bash
npx cortera migrate
```

This creates 6 tables:
- `action_events` — audit log
- `action_approvals` — approval workflow
- `actor_states` — containment state
- `pending_delayed_actions` — delayed execution queue
- `irreversible_confirmations` — out-of-band confirmations
- `api_keys` — API key management

---

## 4. Define an Action

Create `src/actions/createInvoice.ts`:

```ts
import { z } from "zod";
import { defineAction } from "@cortera/core";

export const createInvoiceAction = defineAction({
  name: "createInvoice",
  description: "Creates a new invoice for a customer",
  permission: "invoices:write",
  blastRadius: ["invoices:*", "notifications:send"],
  inputSchema: z.object({
    customerId: z.string().min(1),
    amount: z.number().positive(),
    dueDate: z.string().datetime(),
  }),
  handler: async (input, ctx) => {
    const invoice = await db.invoices.create(input);
    return invoice;
  },
});
```

---

## 5. Register Actions & Configure Runtime

Create `src/lib/registry.ts`:

```ts
import { ActionRegistry, InMemoryPermissionEngine } from "@cortera/core";
import { PostgresDbClient } from "@cortera/db";
import { createInvoiceAction } from "@/actions/createInvoice";

export const registry = new ActionRegistry();
registry.register(createInvoiceAction);

export const dbClient = new PostgresDbClient({ connectionString: process.env.DATABASE_URL! });

export const permissionEngine = new InMemoryPermissionEngine();
permissionEngine.addRule({ actorType: "human", permissionKey: "invoices:write", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "invoices:write", result: "allow" });

export const defaultWorkspaceId = "default-workspace";
```

---

## 6. Create the REST Endpoint

Create `src/app/api/actions/[actionName]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { registry, dbClient, permissionEngine, defaultWorkspaceId } from "@/lib/registry";
import { createActionHandler, resolveActorFromRequest } from "@cortera/adapter-next";

const actionHandler = createActionHandler({
  registry,
  dbClient,
  permissionEngine,
  resolveActor: (req: NextRequest) => resolveActorFromRequest(req, { dbClient }),
  defaultWorkspaceId,
});

export async function POST(req: NextRequest, { params }: { params: { actionName: string } }) {
  return actionHandler(req, { params });
}

export async function GET(_req: NextRequest, { params }: { params: { actionName: string } }) {
  const action = registry.get(params.actionName);
  if (!action) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ name: action.name, description: action.description, permission: action.permission });
}
```

---

## 7. Try It Out

### Start the dev server

```bash
npm run dev
```

### Call via REST (curl)

```bash
curl -X POST http://localhost:3000/api/actions/createInvoice \
  -H "Content-Type: application/json" \
  -H "x-cortera-api-key: cortera_abc123..." \
  -d '{"customerId": "cust-1", "amount": 99.99, "dueDate": "2024-12-31T23:59:59Z"}'
```

### Call via UI Form

Create `src/app/invoice/page.tsx`:

```tsx
import { ActionForm } from "@cortera/ui";
import { createInvoiceAction } from "@/actions/createInvoice";

export default function InvoicePage() {
  return (
    <ActionForm action={createInvoiceAction} apiBaseUrl="/api/actions" />
  );
}
```

Visit `http://localhost:3000/invoice` — you'll see a fully functional form generated from the Zod schema.

### Call via MCP (AI Agent)

Create `src/app/api/mcp/route.ts`:

```ts
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpActionServer } from "@cortera/mcp";
import { registry, dbClient, permissionEngine, defaultWorkspaceId } from "@/lib/registry";

const mcpServer = createMcpActionServer({ registry, dbClient, permissionEngine, defaultWorkspaceId });
export const { GET, POST, DELETE } = createMcpHandler(mcpServer.factory);
```

Configure your MCP client (e.g., Cursor, Claude Desktop) to connect to `http://localhost:3000/api/mcp`.

### Dry Run

```bash
curl -X POST "http://localhost:3000/api/actions/createInvoice?dryRun=true" \
  -H "Content-Type: application/json" \
  -H "x-cortera-api-key: cortera_abc123..." \
  -d '{"customerId": "cust-1", "amount": 99.99, "dueDate": "2024-12-31T23:59:59Z"}'
```

Returns `{ "wouldSucceed": true, "eventId": "..." }` without executing the handler.

---

## Next Steps

- [Core Concepts](core-concepts.md) — Actor model, blast radius, risk modes
- [API Reference](api-reference.md) — Complete function signatures
- [Building a Dashboard](building-a-dashboard.md) — Observability API
- [Migration & Deployment](migration-deployment.md) — Production setup