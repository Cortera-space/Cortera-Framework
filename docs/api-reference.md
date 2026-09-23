# API Reference

Complete function signatures and types for all Cortera Framework packages.

---

## `@cortera/core`

### `defineAction`

```ts
function defineAction<TInput extends z.ZodTypeAny, TOutput = unknown>(
  config: ActionConfig<TInput, TOutput>
): DefinedAction<TInput, TOutput>;
```

Creates an Action definition from a config object.

**ActionConfig:**

```ts
interface ActionConfig<TInput extends z.ZodTypeAny, TOutput = unknown> {
  name: string;
  description: string;
  permission: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>, ctx: ActionContext) => Promise<TOutput>;
  blastRadius?: string[];
  riskTier?: "instant" | "delayed" | "irreversible";
  delayWindowMs?: number;
  confirmationTtlMs?: number;
  rollback?: (output: TOutput, ctx: ActionContext) => Promise<void>;
  approvalTtlMs?: number;
}
```

**Returns:** `DefinedAction` — includes `execute()` method plus all config fields.

---

### `ActionRegistry`

```ts
class ActionRegistry {
  register(action: DefinedAction): void;
  get(name: string): DefinedAction | undefined;
  list(): DefinedAction[];
}
```

Register and lookup actions by name.

---

### `recordEvent`

```ts
function recordEvent(db: DbClient, event: InsertActionEvent): Promise<{ id: string }>;
```

Low-level event logging. Called automatically by `action.execute()`.

---

### `updateEvent`

```ts
function updateEvent(db: DbClient, id: string, patch: Partial<InsertActionEvent>): Promise<void>;
```

Update an event row (output, error, duration, etc.).

---

### `InMemoryPermissionEngine`

```ts
class InMemoryPermissionEngine implements PermissionEngine {
  addRule(rule: PermissionRule): void;
  async check(actor, action, input, workspaceId): Promise<PermissionResult>;
}
```

Simple rule-based permission engine.

**PermissionRule:**

```ts
interface PermissionRule {
  actorId?: string;
  actorType?: "human" | "agent" | "system";
  permissionKey: string;
  result: "allow" | "deny" | "approval_required";
}
```

---

### Approval Service

```ts
function resolveApproval(
  db: DbClient,
  approvalId: string,
  decision: "approved" | "rejected",
  actor: Actor
): Promise<void>;

function expirePendingApprovals(db: DbClient): Promise<void>;

function buildApprovalError(approval: ActionApproval): ActionPendingApprovalError;
```

---

### Containment

```ts
function checkActorContainment(
  db: DbClient,
  actor: Actor,
  workspaceId: string,
  dryRun?: boolean
): Promise<void>;  // Throws ActionContainmentError if contained/revoked

function checkBlastRadius(
  db: DbClient,
  ctx: ActionContext,
  action: DefinedAction,
  dryRun?: boolean
): Promise<void>;  // Throws ActionContainmentError if blast radius exceeded

function reviewContainedActor(
  db: DbClient,
  actorId: string,
  workspaceId: string,
  decision: "lift" | "revoke",
  reviewerActorId: string
): Promise<void>;

function getActorState(
  db: DbClient,
  actorId: string,
  workspaceId: string
): Promise<ActorState | null>;
```

---

### Delayed Actions

```ts
function cancelDelayedAction(
  db: DbClient,
  pendingId: string,
  cancelingActorId: string
): Promise<void>;

function processPendingDelayedActions(db: DbClient): Promise<void>;  // Background sweep
```

---

### Irreversible Confirmations

```ts
function requestIrreversibleConfirmation(
  actionEventId: string,
  action: DefinedAction,
  actor: Actor,
  input: unknown,
  workspaceId: string,
  db: DbClient,
  contactResolver: WorkspaceContactResolver,
  ttlMs: number
): Promise<{ confirmationId: string }>;

function confirmIrreversibleConfirmation(
  db: DbClient,
  token: string
): Promise<void>;

function rejectIrreversibleConfirmation(
  db: DbClient,
  token: string
): Promise<void>;

function expirePendingIrreversibleConfirmations(db: DbClient): Promise<void>;
```

---

### Rollback

```ts
function rollbackAction(
  db: DbClient,
  eventId: string,
  actor: Actor
): Promise<void>;

class ActionRollbackError extends Error {
  constructor(message: string, public readonly originalError: Error);
}
```

---

### InMemoryDbClient

```ts
class InMemoryDbClient implements DbClient {
  // Full DbClient implementation in memory for testing
}
```

---

### Types

| Type | Description |
|------|-------------|
| `Actor` | `{ actorType: "human" \| "agent" \| "system"; actorId: string }` |
| `ActionContext` | `{ actor, workspaceId, parentEventId?, eventId? }` |
| `ExecuteOptions` | `{ dryRun?: boolean }` |
| `PermissionResult` | `"allow" \| "deny" \| "approval_required"` |
| `RiskTier` | `"instant" \| "delayed" \| "irreversible"` |
| `RiskMode` | `"guarded" \| "autonomous"` |
| `DefinedAction` | Action with `execute()` method |
| `ActionEvent` | Single audit log row |
| `ActionEventWithChain` | Event with ancestors/descendants |
| `ContainedActor` | Actor in contained/revoked state |
| `ActionApproval` | Approval workflow record |
| `PendingDelayedAction` | Scheduled delayed execution |
| `IrreversibleConfirmation` | Out-of-band confirmation record |
| `WorkspaceContact` | `{ channel: "email" \| "sms"; destination: string }` |
| `WorkspaceContactResolver` | `{ getContact(workspaceId) }` |
| `DbClient` | Interface for all database operations |

---

## `@cortera/db`

### `PostgresDbClient`

```ts
class PostgresDbClient implements DbClient {
  constructor(options: PostgresDbClientOptions);
  async close(): Promise<void>;
}
```

**PostgresDbClientOptions:**

```ts
interface PostgresDbClientOptions {
  connectionString: string;
}
```

Full PostgreSQL implementation of `DbClient` interface.

---

## `@cortera/adapter-next`

### `createActionHandler`

```ts
function createActionHandler(options: CreateActionHandlerOptions): (
  req: NextRequest,
  context: { params: { actionName: string } }
) => Promise<NextResponse>;
```

**CreateActionHandlerOptions:**

```ts
interface CreateActionHandlerOptions {
  registry: ActionRegistry;
  dbClient: DbClient;
  permissionEngine: PermissionEngine;
  resolveActor: (req: NextRequest) => Promise<Actor | null>;
  defaultWorkspaceId: string;
}
```

Creates a Next.js route handler that:
- Resolves actor from request
- Finds action by name
- Runs `action.execute()` with full pipeline
- Maps errors to HTTP responses

**Error Mapping:**

| Status | Condition |
|--------|-----------|
| 200 | Success |
| 400 | `ActionValidationError` |
| 401 | No actor identity |
| 403 | `ActionPermissionError` / `ActionContainmentError` |
| 404 | Action not found |
| 202 | `ActionPendingApprovalError` |
| 500 | Unhandled error |

---

### `resolveActorFromRequest`

```ts
function resolveActorFromRequest(
  req: NextRequest,
  options?: ResolveActorOptions
): Promise<Actor | null>;
```

**ResolveActorOptions:**

```ts
interface ResolveActorOptions {
  dbClient?: DbClient;  // For API key validation
}
```

Resolution order:
1. `x-cortera-api-key` header → API key lookup (requires `dbClient`)
2. `cortera-session` cookie → parse JSON `{ actorId, actorType }`
3. Returns `null` (→ 401)

---

### Route Handlers

```ts
function createApprovalRouteHandler(options: ApprovalRouteOptions);
function createReviewRouteHandler(options: ReviewRouteOptions);
function createConfirmationRouteHandler(options: ConfirmationRouteOptions);
function createRollbackRouteHandler(options: RollbackRouteOptions);
function createEventsRouteHandler(options: ObservabilityRouteOptions);
function createEventChainRouteHandler(options: ObservabilityRouteOptions);
function createContainedActorsRouteHandler(options: ObservabilityRouteOptions);
function createPendingApprovalsRouteHandler(options: ObservabilityRouteOptions);
function createEventStreamRouteHandler(options: ObservabilityRouteOptions);
```

**ObservabilityRouteOptions:**

```ts
interface ObservabilityRouteOptions {
  dbClient: DbClient;
  resolveActor: (req: NextRequest) => Promise<Actor | null>;
  defaultWorkspaceId: string;
}
```

---

## `@cortera/ui`

### `ActionForm`

```tsx
function ActionForm<T = unknown>(props: ActionFormProps<T>): JSX.Element;
```

**ActionFormProps:**

```ts
interface ActionFormProps<T = unknown> {
  action: DefinedAction;
  onSuccess?: (result: T) => void;
  onError?: (error: Error | string) => void;
  basePath?: string;  // Default: "/actions"
  actorId?: string;
  actorType?: "human" | "agent" | "system";
}
```

Renders a form from the Action's Zod schema:
- Text, number, date, datetime, checkbox, select fields
- Nested objects and arrays
- Client-side validation (Zod)
- Server error display
- Loading/pending/success/error states

---

### `ActionButton`

```tsx
function ActionButton(props: ActionButtonProps): JSX.Element;
```

**ActionButtonProps:**

```ts
interface ActionButtonProps {
  action: DefinedAction;
  children: React.ReactNode;
  onSuccess?: (result) => void;
  onError?: (error) => void;
  basePath?: string;
  actorId?: string;
  actorType?: "human" | "agent" | "system";
  disabled?: boolean;
}
```

Button that triggers the Action via API when clicked.

---

### `zodToFormSchema`

```ts
function zodToFormSchema(schema: z.ZodTypeAny): FieldDescriptor[];
```

Converts a Zod schema to an array of field descriptors for custom form rendering.

**FieldDescriptor:**

```ts
interface FieldDescriptor {
  name: string;
  label: string;
  controlType: "text" | "number" | "date" | "datetime" | "checkbox" | "select" | "object" | "array";
  required: boolean;
  metadata?: {
    options?: { value: string; label: string }[];
    fields?: FieldDescriptor[];  // for object
    itemControlType?: FieldDescriptor["controlType"];  // for array
    itemFields?: FieldDescriptor[];  // for array of objects
  };
}
```

---

## `@cortera/mcp`

### `generateMcpToolSchema`

```ts
function generateMcpToolSchema(action: DefinedAction): McpToolSchema;
```

Converts an Action's Zod input schema to MCP tool schema (JSON Schema).

**McpToolSchema:**

```ts
interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}
```

---

### `generateMcpToolList`

```ts
function generateMcpToolList(registry: { list(): DefinedAction[] }): McpToolSchema[];
```

Generates tool list from all registered actions.

---

### `createMcpActionServer`

```ts
function createMcpActionServer(options: McpActionServerOptions): McpActionServer;
```

**McpActionServerOptions:**

```ts
interface McpActionServerOptions {
  registry: ActionRegistry;
  dbClient: DbClient;
  permissionEngine: PermissionEngine;
  defaultWorkspaceId: string;
}
```

**McpActionServer:**

```ts
interface McpActionServer {
  createHandler(): ReturnType<typeof createMcpHandler>;
  factory: (ctx: McpRequestContext) => Promise<McpServer>;
}
```

Creates an MCP server where every registered Action becomes a callable tool. Handles:
- Actor resolution from `x-cortera-api-key` header or auth info
- Full execution pipeline (containment, blast radius, permissions, validation)
- Error mapping to MCP error format

---

## `@cortera/auth`

### `createApiKey`

```ts
async function createApiKey(
  db: DbClient,
  actorId: string,
  workspaceId: string,
  name: string
): Promise<CreateApiKeyResult>;
```

**CreateApiKeyResult:**

```ts
interface CreateApiKeyResult {
  key: string;      // Raw key (only shown once)
  keyId: string;    // Database ID
}
```

---

### `validateApiKey`

```ts
async function validateApiKey(
  db: DbClient,
  rawKey: string
): Promise<ValidateApiKeyResult | null>;
```

**ValidateApiKeyResult:**

```ts
interface ValidateApiKeyResult {
  actorId: string;
  workspaceId: string;
  keyId: string;
}
```

Returns `null` if key not found, revoked, or invalid.

---

### `revokeApiKey`

```ts
async function revokeApiKey(db: DbClient, keyId: string): Promise<void>;
```

---

### `listApiKeys`

```ts
async function listApiKeys(db: DbClient, workspaceId: string): Promise<ApiKey[]>;
```

**ApiKey:**

```ts
interface ApiKey {
  id: string;
  actorId: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}
```

---

## `@cortera/cli`

### Commands

| Command | Description |
|---------|-------------|
| `cortera dev` | Development server with hot reload |
| `cortera generate` | Generate Action scaffolding |
| `cortera migrate` | Run database migrations |
| `cortera check` | Type-check all Actions |
| `cortera keys create <name>` | Create API key |
| `cortera keys list` | List API keys |
| `cortera keys revoke <keyId>` | Revoke API key |

### Options

```bash
cortera keys create <name> -w, --workspace <id> -c, --connection <url>
cortera keys list -w, --workspace <id> -c, --connection <url>
cortera keys revoke <keyId> -c, --connection <url>
```

Defaults:
- `--workspace`: `"default-workspace"`
- `--connection`: `process.env.DATABASE_URL`