# Tera

**An observability-first, agent-native web app framework.**

Tera is built around a simple idea: the same definition that powers a UI action should also power its REST endpoint, its audit trail, and its callable tool schema for AI agents — without extra glue code.

---

## Why Tera

Modern apps increasingly need to be usable by both humans and AI agents, and both need to be observable and safe by default. Most frameworks bolt these concerns on after the fact — a separate APM vendor for tracing, a separate tool-schema layer for agent access, a separate audit log for compliance. Tera builds all three into its core primitive from day one.

- **Observability-first** — every request, mutation, and error automatically produces structured traces and events. No APM vendor required.
- **Agent-native** — every route/action is automatically exposed as both a UI trigger and a callable tool schema, with built-in permissions and audit logging.

## The Core Primitive: Action

Everything in Tera is built on the **Action** — a single definition that auto-generates:

- A REST endpoint
- An MCP tool schema (for agent calling)
- A UI form/trigger
- A trace span

```ts
defineAction({
  name: "createInvoice",
  description: "Creates a new invoice for a customer", // required — no auto-generation from name
  input: InvoiceSchema,
  permission: "invoices:write",
  blastRadius: ["invoices:*", "notifications:send"],
  handler: async (input, ctx) => {
    // ...
  },
});
```

## Signature Features

### Blast Radius + Auto-Containment
Every Action declares a `blastRadius` — the set of downstream actions/resources it's allowed to touch. If a live action chain tries to exceed its declared scope, Tera **freezes that actor**, auto-denying all further calls until a human reviews and lifts containment. This is Tera's core defense against rogue or runaway agent chains.

### Risk Modes
Each agent/Action can be configured with a `riskMode`:

- **`guarded`** (default) — three-tier gating:
  - Read-only / reversible actions run instantly
  - Moderate-risk reversible actions get a delayed, cancelable window with automatic rollback scaffolding
  - Irreversible actions hard-block pending a second, **out-of-band** confirmation (a channel the agent's own session can't spoof)
- **`autonomous`** — no action-level gating; runs at full speed, relying solely on Blast Radius + Auto-Containment as the after-the-fact backstop

You choose the risk posture — Tera doesn't impose one.

### Dry Runs
Any Action can be invoked with `--dry-run` to execute its permission check, blast-radius evaluation, and trace emission **without** running the handler — safe simulation before committing to a real call.

### Approvals
Requests requiring `approval_required` auto-deny after a configurable TTL rather than waiting indefinitely on a human.

## Philosophy: Core Stays Headless

Tera follows the Laravel model: **core ships primitives only** — routing, actions, traces, approvals, permissions. Any prebuilt admin UI (trace viewer, live tail, approvals inbox, contained-actors panel, API key management) is deliberately **not** bundled into core, the same way Nova is optional on top of Laravel, not part of it.

`@tera/core` exposes the underlying headless primitives — event queries, a streaming endpoint, approval queries — so you build the dashboard that fits your app. A first-party admin package may come later; it's deferred, not abandoned.

## Installation

Tera supports three ways to get started:

```bash
# Scaffold a new app
npx create-tera-app my-app

# Or add to an existing Next.js app
npm install @tera/core

# Ongoing dev tooling
npx tera dev
```

## Status

Tera is under active build, targeting a public release around November. Cortera — a separate AI agent control plane — will be built on top of Tera once the framework itself ships.

## License

MIT LICENSE 
