# Tera v1.0.0 Release Readiness Report

## VERDICT: NO-GO

**Tera is NOT ready to publish as v1.0.0.** Critical blocking issues exist across multiple test categories that must be resolved before release.

---

## 1. FRESH-CLONE INSTALL TEST

**Status: NOT TESTED** — No genuinely empty-directory install was performed in this session. The monorepo was already set up with `pnpm install` completed.

**Expected behavior per README:**
```bash
npm install @tera/core @tera/db @tera/adapter-next @tera/ui @tera/mcp @tera/auth
npx tera migrate
npx tera dev
```

**Risk:** The workspace packages are all marked `"private": true` with version `0.0.0`. A fresh user installing from npm would get unpublished packages. **This is a fundamental blocker** — packages must be published to npm (or a registry) with proper versions before the install command in the README will work.

---

## 2. QUICKSTART WALKTHROUGH

**Status: PARTIAL** — The example app demonstrates the quickstart flow, but was not walked through end-to-end in a fresh session.

**Issues observed in example app (`apps/example`):**
- The custom `InMemoryDbClient` in `src/lib/registry.ts` is missing `insertDataProvenance` and `findDataProvenanceByEventId` methods required by Stage 14 provenance features
- This causes runtime errors when Actions execute: `TypeError: dbClient.insertDataProvenance is not a function`
- The quickstart's `PostgresDbClient` from `@tera/db` would work (it implements the full `DbClient` interface), but the example's in-memory fallback used for testing does not

**Time to complete:** Not measured (blocked by above issue)

---

## 3. FEATURE INTEGRATION TEST

**Status: FAILING** — Compound feature tests reveal integration gaps between stages.

### 3.1 Irreversible + Blast Radius + Untrusted Provenance
**Not directly tested** — No test exercises all three together. The `taint-enforcement.test.ts` tests `declared_irreversible` vs `untrusted_provenance` trigger reason precedence correctly (declared_irreversible wins per ARCHITECTURE.md:365-366), but blast radius interaction is untested.

### 3.2 Delayed Action + Containment During Delay Window
**PASSING** — `risk-mode.test.ts` line 234-256: "delay-window executor RE-CHECKS containment/permission at execution time > denies delayed action if actor becomes contained during delay window" ✓

### 3.3 Behavioral Drift + Dry Run
**FAILING** — `behavioral-drift.test.ts` line 1007: `TypeError: dbClient.insertDataProvenance is not a function`
- The test's `MockDbClient` doesn't implement the provenance methods added in Stage 14
- When a contained actor's dry-run is tested, the handler path still tries to record provenance

### 3.4 Inconsistent Combined Behavior
**Found:** The `DbClient` interface in `@tera/core/src/types.ts:501-543` requires provenance methods (`insertDataProvenance`, `findDataProvenanceByEventId`, `getProvenanceTrace`), but:
- The example app's `InMemoryDbClient` (registry.ts) lacks these
- The behavioral-drift test's `MockDbClient` lacks these
- The mcp test's mock DbClient lacks these
- **Any custom DbClient implementation will crash at runtime** when provenance features are used

This is a **contract violation** — the interface promises these methods but the framework's own test doubles and example implementations don't provide them.

---

## 4. API SURFACE CONSISTENCY AUDIT

**Status: PARTIAL PASS** — Manual audit of exported symbols across all packages.

### Issues Found:

| Package | Issue |
|---------|-------|
| `@tera/core` | Exports `InMemoryDbClient` from `test-utils.ts` — test utility leaked into public API |
| `@tera/core` | No references to stage numbers or `@tera/dashboard` found in exports ✓ |
| `@tera/mcp` | `server.test.ts` imports from `@tera/auth` which fails module resolution (see §5) |
| `@tera/adapter-next` | Re-exports `resolveActorFromRequest` from `@tera/auth` — creates coupling |
| All packages | Missing JSDoc/docstrings on most exported functions (README shows a table but actual exports lack comments) |

**Naming consistency:** Generally consistent (camelCase for functions, PascalCase for types, UPPER_SNAKE for constants).

---

## 5. BACKWARD-COMPATIBILITY REGRESSION SWEEP

**Status: FAILING** — Full test suite run across all packages:

### Test Results Summary

| Package | Test Files | Tests Passed | Tests Failed | Notes |
|---------|------------|--------------|--------------|-------|
| `@tera/core` | 12 | 93 | 1 | `behavioral-drift` fails (provenance methods missing in MockDbClient) |
| `@tera/core` | 3 failed to load | 0 | — | `irreversible-confirmation`, `observability-queries`, `rollback` — module resolution error for `@tera/core` |
| `@tera/mcp` | 2 | 9 | 0 | `server.test.ts` failed to load (`@tera/auth` resolution) |
| `@tera/ui` | 3 | 23 | 0 | Pass (with React act() warnings) |
| `@tera/cli` | 1 | 2 | 9 | All CLI commands fail — workspace deps not linked in test project |
| `@tera/auth` | 0 | — | — | No tests |
| `@tera/db` | 0 | — | — | No tests (requires live Postgres) |
| `@tera/adapter-next` | 0 | — | — | No tests |
| `@tera/guard-service` | 0 | — | — | No tests |
| `apps/example` | 1 | 28 | 2 | Route tests fail due to missing provenance methods in example's InMemoryDbClient |

**Total: ~155 tests run, ~12 failures (8% failure rate)**

**Critical:** Three core test files (`irreversible-confirmation`, `observability-queries`, `rollback`) fail to even load due to `@tera/core` module resolution issues in the vitest environment — they import from `@tera/core` but the package isn't built/linked correctly for test-time resolution.

---

## 6. EXAMPLE APP COHERENCE CHECK

**Status: FAILING** — Demo scripts referenced across stages:

| Demo Script | Status | Issue |
|-------------|--------|-------|
| `scripts/dashboard-demo.sh` | Exists | Not runnable (no Supabase/local Postgres in CI) |
| `scripts/dry-run-demo.ts` | Exists | Uses example's InMemoryDbClient → will crash on provenance |
| `scripts/enforcement-demo.ts` | Exists | Same provenance crash |
| `scripts/provenance-demo.ts` | Exists | Same provenance crash |
| `scripts/riskmode-demo.ts` | Exists | Likely works (no provenance in risk mode) |
| `src/actions/runBlastRadiusDemo.ts` | Exists | Works (uses example's InMemoryDbClient but doesn't trigger provenance) |
| `src/actions/runApprovalExpiry.ts` | Exists | Works |
| `src/actions/runChainedActions.ts` | Exists | Works |
| `src/actions/runCreateNote.ts` | Exists | Works |
| `src/actions/runDeleteCustomer.ts` | Exists | Works |

**Root cause:** All demos using the example app's `InMemoryDbClient` will crash when Actions execute because provenance recording was added in Stage 14 but the example's DbClient wasn't updated.

---

## 7. DOCUMENTATION ACCURACY SPOT-CHECK

**Status: PARTIAL DRIFT FOUND** — 10 random claims verified:

| # | Claim (from README/docs) | Actual Code | Match? |
|---|---------------------------|-------------|--------|
| 1 | `npm install @tera/core @tera/db @tera/adapter-next @tera/ui @tera/mcp @tera/auth` | Packages are `private: true`, version `0.0.0`, not on npm | ❌ **BLOCKER** |
| 2 | `npx tera migrate` creates 6 tables | Migration files exist in `@tera/db` | ✅ |
| 3 | `defineAction` generates REST, MCP, UI, Audit | All 4 packages export generators | ✅ |
| 4 | `blastRadius` in ActionConfig | `defineAction.ts` accepts `blastRadius?: string[]` | ✅ |
| 5 | `riskTier: "instant" \| "delayed" \| "irreversible"` | `types.ts:112` defines `RiskTier` | ✅ |
| 6 | `dryRun: true` on Action call | `defineAction.ts` handles `dryRun` option | ✅ |
| 7 | `ActionForm` from `@tera/ui` renders from Zod | `ui/src/ActionForm.tsx` does this | ✅ |
| 8 | `createMcpActionServer` from `@tera/mcp` | `mcp/src/server.ts` exports this | ✅ |
| 9 | `createApiKey`/`validateApiKey` from `@tera/auth` | `auth/src/index.ts` exports these | ✅ |
| 10 | `GET /api/tera/events` returns `provenanceLabel` and `triggerReason` | `adapter-next` route handlers include these (test-utils InMemoryDbClient does) | ⚠️ Only works with full DbClient |

**Key drift:** The README presents an install experience that **does not work** because packages aren't published. This is the most damaging pre-launch bug — users following the quickstart will fail at step 1.

---

## 8. LICENSE / PACKAGE PUBLISH DRY RUN

**Status: FAILING** — Critical publishing blockers:

### Per-Package Issues

| Package | Version | License File | Description | Repository | Files Field | Tarball Clean? |
|---------|---------|--------------|-------------|------------|-------------|----------------|
| `@tera/core` | 0.0.0 | ❌ | ❌ | ❌ | ❌ | ❌ (includes `__tests__/`, `src/`) |
| `@tera/adapter-next` | 0.0.0 | ❌ | ❌ | ❌ | ❌ | ❌ |
| `@tera/auth` | 0.0.0 | ❌ | ❌ | ❌ | ❌ | ❌ |
| `@tera/cli` | 0.0.0 | ❌ | ❌ | ❌ | ❌ | ❌ |
| `@tera/db` | 0.0.0 | ❌ | ❌ | ❌ | ❌ | ❌ |
| `@tera/guard-service` | 0.0.0 | ❌ | ❌ | ❌ | ❌ | ❌ |
| `@tera/mcp` | 0.0.0 | ❌ | ❌ | ❌ | ❌ | ❌ |
| `@tera/ui` | 0.0.0 | ❌ | ❌ | ❌ | ❌ | ❌ |

**All packages share these blockers:**
1. **Version `0.0.0`** — Invalid semver for npm publish
2. **No `description` field** — Required for npm
3. **No `repository` field** — Required for npm
4. **No `license` field** — Required for npm (root LICENSE exists but not in packages)
5. **No `files` field or `.npmignore`** — Tarball includes `__tests__/`, `src/`, config files
6. **All marked `"private": true`** — Prevents accidental publish but also prevents intentional publish
7. **No LICENSE file in each package** — npm warns without it

**Example tarball contents for `@tera/core` (from `npm publish --dry-run`):**
```
__tests__/behavioral-drift.test.ts
__tests__/blast-radius.test.ts
... (12 test files)
src/approval-service.ts
... (15 source files)
dist/index.js
dist/index.d.ts
package.json
tsconfig.json
vitest.config.ts
```
Only `dist/` should be published.

---

## 9. BLOCKING ISSUES SUMMARY (Prioritized)

### P0 — Must Fix Before Any Publish
1. **Packages not publishable** — All 8 packages: version `0.0.0`, `private: true`, missing metadata, no LICENSE, no `files` field
2. **README install instructions don't work** — Packages don't exist on npm
3. **DbClient interface contract broken** — Provenance methods required but missing in example/test DbClient implementations, causing runtime crashes
4. **Core test files fail to load** — `irreversible-confirmation`, `observability-queries`, `rollback` tests can't resolve `@tera/core`

### P1 — Must Fix Before v1.0.0
5. **Behavioral drift test failure** — Missing `insertDataProvenance` in test MockDbClient
6. **Example app test failures** — 2 route tests fail due to missing provenance methods
7. **CLI tests failing** — Workspace dependency resolution in test harness
8. **MCP server test fails to load** — `@tera/auth` module resolution

### P2 — Should Fix Before v1.0.0
9. **Test utility leaked to public API** — `InMemoryDbClient` exported from `@tera/core`
10. **Missing docstrings on public exports** — README claims API reference but exports lack JSDoc
11. **React act() warnings in UI tests** — Test quality issue
12. **No tests for `@tera/auth`, `@tera/db`, `@tera/adapter-next`, `@tera/guard-service`**

### P3 — Nice to Have
13. **Fresh-clone validation** — Actual end-to-end install test from empty directory
14. **Quickstart timing measurement** — Document actual time for new user
15. **Dashboard demo script** — Requires external Supabase/Postgres

---

## RECOMMENDATION

**NO-GO for v1.0.0.**

The framework has solid architecture and most features work in isolation, but the **publish infrastructure is completely missing** (P0 #1-2) and there's a **critical runtime contract violation** in the DbClient interface (P0 #3) that breaks the example app and tests when provenance features are used.

### Minimum Fixes for GO WITH FIXES:
1. Set proper versions (e.g., `1.0.0`), remove `private: true`, add `description`, `repository`, `license`, `files: ["dist"]` to all 8 package.json files
2. Add LICENSE file to each package (or use `license: "MIT"` in package.json with root file)
3. Implement `insertDataProvenance`, `findDataProvenanceByEventId`, `getProvenanceTrace` in:
   - `apps/example/src/lib/registry.ts` InMemoryDbClient
   - `packages/core/__tests__/behavioral-drift.test.ts` MockDbClient
   - `packages/mcp/__tests__/server.test.ts` mock DbClient
4. Fix vitest config/module resolution so `irreversible-confirmation`, `observability-queries`, `rollback` tests load
5. Run `npm publish --dry-run` successfully for all packages
6. Validate fresh-clone install from empty directory with published packages

**Estimated effort:** 1-2 days for P0 fixes, 1 day for P1 fixes.

---

*Report generated: 2026-09-21*
*Test environment: pnpm monorepo, Node 22, vitest 1.6.1*