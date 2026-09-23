# Security Policy

Cortera Framework (`@cortera/*` on npm) includes security-sensitive components —
the Guard Service, Blast Radius / Auto-Containment, and Taint-Tracked Provenance —
that gate what AI agents are allowed to do. A vulnerability here can mean an agent
bypasses a permission check, not just an app bug. Please report privately.

## Reporting a Vulnerability

**Do not open a public GitHub issue for a security report.**

Instead:
1. Go to the repo's **Security** tab → **Report a vulnerability** (GitHub Private
   Vulnerability Reporting), or
2. Email **security@cortera.space** (or the maintainer contact listed in the repo)
   with:
   - Affected package(s) and version (e.g. `@cortera/guard-service@1.0.0-28`)
   - Steps to reproduce / proof-of-concept
   - Impact (what an attacker/agent could do)
   - Whether it's already public

## What counts as a security issue here

- Blast Radius scope bypass — an Action executes outside its declared blast
  radius without triggering containment
- Guard Service permission-category misclassification (e.g. the `reserve:*` /
  `post:*` gap found and fixed pre-launch) that lets untrusted-context calls
  return `allow` when they should be `guarded`/`block`
- Taint-provenance mislabeling that lets untrusted external content drive an
  Action without forcing out-of-band confirmation
- Auth/API-key handling flaws (`@cortera/auth`)
- Any RCE, injection, or auth-bypass in `@cortera/core`, `@cortera/db`, or
  `@cortera/adapter-next`

## Response targets

| Stage | Target |
|---|---|
| Acknowledgment | 48 hours |
| Initial assessment / severity | 5 business days |
| Fix or mitigation for critical issues | 30 days (best effort) |

## Disclosure

We'll coordinate a disclosure timeline with the reporter once a fix is ready.
Credit is given in the release notes unless you prefer to stay anonymous.

## Known, already-disclosed gaps

These are tracked openly (not embargoed) — no need to re-report:
- CLI duplicate `keys` command bug
- Missing automated test coverage on `@cortera/auth`, `@cortera/db`,
  `@cortera/adapter-next`, `@cortera/guard-service`
