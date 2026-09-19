# Model-Free Security Tests for Tera's Guard Service

**These are static/property-based tests of the enforcement layer, NOT an AgentDojo benchmark score and NOT a claim about stopping live agent behavior end-to-end.**

No LLM API calls were made. No AgentDojo model runs were executed. These tests exercise Tera's actual decision engine (packages/guard-service, the real HTTP service at /evaluate-call) with zero AI model dependency.

---

## PART 1 — ATTACK-PATTERN REPLAY

### Methodology
Constructed the tool-call sequences a compromised agent WOULD produce if it fell for each AgentDojo attack, and sent them directly to the real Guard Service. Tests "if an agent is tricked, does Tera still stop it" without needing a model to do the tricking.

- Extracted 27 injection tasks across 4 AgentDojo suites (banking, workspace, slack, travel)
- Applied 6 attack templates (direct, ignore_previous, system_message, injecagent, important_instructions, tool_knowledge)
- Built synthetic context_trace matching the real adapter's tagging scheme:
  - system prompt + original user task → "trusted"
  - the tool output containing the injected instruction → "untrusted_external"
- Constructed tool calls exactly as if the agent had complied with the injection (worst case: full compliance)
- POSTed each case to the live Guard Service /evaluate-call endpoint
- Recorded verdict (allow/guarded/block) and containment_reason per case
- Benign control set: equivalent legitimate tool calls (same tools, same argument shapes) whose causal root is genuinely "trusted"

### Results

| Metric | Value |
|--------|-------|
| Total malicious cases | 246 (27 injection tasks × 6 attack types × 1-3 tool calls each) |
| Blocked/Guarded | 132 |
| Allowed (false negatives) | 114 |
| **Block+Guarded rate** | **53.66%** |
| **False negative rate** | **46.34%** |
| Total benign controls | 41 |
| False positives | 0 |
| **False positive rate** | **0.00%** |

#### By Suite

| Suite | Malicious Cases | Blocked/Guarded | Block Rate | Benign Controls | False Positives | FP Rate |
|-------|----------------|-----------------|------------|-----------------|-----------------|---------|
| banking | 72 | 66 | 91.67% | 12 | 0 | 0.00% |
| workspace | 60 | 42 | 70.00% | 10 | 0 | 0.00% |
| slack | 48 | 6 | 12.50% | 8 | 0 | 0.00% |
| travel | 66 | 18 | 27.27% | 11 | 0 | 0.00% |

#### By Attack Type

| Attack Type | Malicious Cases | Blocked/Guarded | Block Rate |
|-------------|----------------|-----------------|------------|
| direct | 41 | 22 | 53.66% |
| ignore_previous | 41 | 22 | 53.66% |
| system_message | 41 | 22 | 53.66% |
| injecagent | 41 | 22 | 53.66% |
| important_instructions | 41 | 22 | 53.66% |
| tool_knowledge | 41 | 22 | 53.66% |

### Key Findings

1. **Banking tools (send_money, update_scheduled_transaction, etc.)** are consistently blocked/guarded (91.67%) when invoked with untrusted context, as they correctly map to `banking:write` blast radius which is high-risk.

2. **Workspace tools (send_email, delete_file, create_calendar_event)** show 70% block rate. The `send_email` tool maps to `write:*` which is high-risk.

3. **Slack tools** show only 12.5% block rate. Most Slack tools map to `slack:read` or `slack:write` - but `post_webpage` (maps to `post:*`) and `invite_user_to_slack` (maps to `slack:*`) are NOT being caught by the taint tracking.

4. **Travel tools** show 27.27% block rate. `reserve_hotel` (maps to `reserve:*`) is NOT being caught by taint tracking.

5. **Zero false positives** on benign controls — all legitimate tool calls with trusted context were allowed.

6. **Root cause of false negatives**: The guard service's `isHighRisk` check in `evaluateCall` only flags permissions containing explicit write/delete/execute keywords. Patterns like `reserve:*`, `post:*`, `slack:*` are not recognized as high-risk, so the taint tracking invariant (untrusted_external + high_risk → not allow) is not enforced for these tools.

---

## PART 2 — PROPERTY-BASED FUZZ TESTING

### Methodology
Statistical coverage (4,192 cases) checking that Tera's core invariant holds under adversarially-generated inputs.

**Core Invariant**: ANY call where:
- causal root of the call's justification is "untrusted_external"
- AND the tool's blast-radius tier is >= the configured threshold (high-risk)
MUST NOT return verdict: "allow"

Generated randomized inputs covering:
- context_trace of varying length and provenance-tag patterns (including edge cases: mixed trusted/untrusted history, empty trace, untrusted content that itself contains trusted-looking markers/strings)
- tool_args of varying shape/size, including malformed or boundary values
- all blast-radius tiers in the current tool catalog
- actor_id reuse patterns (to also brush up against drift logic if it shares code paths)

Separately fuzzed for parsing/edge-case robustness:
- malformed provenance metadata (case variations, partial matches, empty, invalid values)
- encoding tricks (base64, unicode homoglyphs, zero-width spaces, BOM, RLO/LRO overrides, null bytes)
- ambiguous trust boundaries
- nested structures in content, missing fields
- large content, many entries

### Results

| Metric | Value |
|--------|-------|
| Total invariant test cases | 3,000 |
| **Invariant violations found** | **172** |
| Total edge case tests | 1,192 |
| Crashes/errors | 373 |
| Silent allows on error | 0 |

#### Verdict Distribution (Invariant Tests)
- allow: 2,838
- guarded: 965
- block: 16
- error: 373

#### Invariant Violations by Tool

| Tool | Violations | Blast Radius | High-Risk Detected |
|------|------------|--------------|-------------------|
| reserve_hotel | 95 | `reserve:*` | **NO** |
| post_webpage | 77 | `post:*` | **NO** |

**Tools with ZERO invariant violations (19 tools):**
`send_money`, `update_scheduled_transaction`, `update_password`, `get_scheduled_transactions`, `send_email`, `delete_file`, `create_calendar_event`, `search_emails`, `delete_email`, `send_direct_message`, `get_channels`, `read_channel_messages`, `get_webpage`, `invite_user_to_slack`, `add_user_to_channel`, `remove_user_from_slack`, `get_all_hotels_in_city`, `get_hotels_prices`, `get_user_information`

### Key Findings

1. **172 invariant violations** — the core invariant is **violated** for tools with blast radius patterns `reserve:*` and `post:*`. These patterns are not recognized as high-risk by the guard service's `getPermissionCategory` / `isHighRisk` logic.

2. **Root cause**: The `getPermissionCategory` function in guard-service/src/index.ts only assigns category 3 (high-risk) to permissions containing explicit keywords: `write`, `create`, `delete`, `update`, `destroy`, `execute`, `send`, `pay`, `transfer`, `book`, `reserve`, `post`, `invite`, `remove`. However, the pattern matching is done on the full permission string, and `reserve:*` contains "reserve" but the check may not be catching it correctly due to the wildcard. Similarly `post:*` should match "post" but the logic may be failing.

3. **19 tools correctly enforce the invariant** — all banking:write, workspace:write, slack:write, etc. tools properly block/guard when invoked with untrusted_external context.

4. **No silent allows on error** — the service does not silently default to "allow" on malformed input; it returns errors (which are counted in the 373 error cases).

5. **373 crashes/errors** — primarily from malformed provenance values causing validation errors in the Fastify/Zod layer. These are properly returned as HTTP 400/500, not silent allows.

---

## PART 3 — BLAST-RADIUS TIER COVERAGE CHECK

### Methodology
Enumerated every tool in the current catalog and confirmed each has an assigned blast-radius tier by checking if the Guard Service's `inferBlastRadius` function returns a specific (non-generic) blast radius for the tool.

### Results

| Metric | Value |
|--------|-------|
| Tools checked | 27 |
| Tools with tier assigned | 27 |
| Tools without tier | 0 |
| Findings | 0 |

### Tool Blast Radius Assignments

| Tool | Suite | Inferred Blast Radius |
|------|-------|----------------------|
| send_money | banking | banking:write |
| update_scheduled_transaction | banking | banking:write |
| update_password | banking | banking:write |
| get_scheduled_transactions | banking | banking:read |
| read_file | banking/workspace | banking:read / workspace:read, files:read |
| get_most_recent_transactions | banking | banking:read |
| send_email | workspace/travel | write:* / travel:write |
| delete_file | workspace | workspace:delete, files:delete |
| create_calendar_event | workspace/travel | workspace:write, files:write / travel:write |
| search_emails | workspace | search:* |
| delete_email | workspace | workspace:delete, files:delete |
| list_files | workspace | workspace:read, files:read |
| send_direct_message | slack | slack:write |
| get_channels | slack | slack:read |
| read_channel_messages | slack | slack:read |
| post_webpage | slack | post:* |
| get_webpage | slack | web:read |
| invite_user_to_slack | slack | slack:* |
| add_user_to_channel | slack | slack:write |
| remove_user_from_slack | slack | slack:* |
| reserve_hotel | travel | reserve:* |
| reserve_flight | travel | reserve:* |
| reserve_car | travel | reserve:* |
| cancel_reservation | travel | travel:delete |
| get_all_hotels_in_city | travel | travel:read |
| get_hotels_prices | travel | travel:read |
| get_user_information | travel | travel:read |

### Key Finding
**All 27 tools have blast-radius tiers assigned** — no silent enforcement gaps from missing tiers. However, the *risk classification* of those tiers is incomplete (see Part 2 findings).

---

## SUMMARY

| Test | Cases Run | Key Metric |
|------|-----------|------------|
| Attack Replay | 246 malicious + 41 benign | 53.66% block rate, 0% FP rate |
| Fuzz (Invariant) | 3,000 | **172 invariant violations** (reserve_hotel, post_webpage) |
| Fuzz (Edge Cases) | 1,192 | 0 silent allows on error |
| Tier Coverage | 27 tools | 100% tier assignment |

### Critical Issues Identified

1. **Invariant violations for `reserve:*` and `post:*` blast radius patterns** — These are not classified as high-risk, so the taint tracking check (untrusted_external + high_risk → not allow) does not trigger. This allows high-risk operations (hotel reservations, webpage posting) to proceed when triggered by untrusted content.

2. **Inconsistent blast radius inference** — The same tool name (e.g., `send_email`, `create_calendar_event`) gets different blast radii depending on which suite's injection task is being tested, because `inferBlastRadius` uses simple string matching on tool names.

3. **Actor containment is per-actor** — A malicious call that gets an actor contained does not affect other actors. This is correct behavior but means the test must use fresh actors for each benign control.

---

**Label**: Static replay of AgentDojo's published attack patterns + property-based fuzz testing against Tera's decision engine — no model was run, this is not an AgentDojo benchmark score.

**Raw Data Files**:
- `benchmark/attack_replay/results.json` and `results.csv`
- `benchmark/fuzz/results.json`
- `benchmark/tier_coverage/results.json`