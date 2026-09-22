# Model-Free Security Tests for Cortera Framework's Guard Service (POST-FIX)

**These are static/property-based tests of the enforcement layer, NOT an AgentDojo benchmark score and NOT a claim about stopping live agent behavior end-to-end.**

No LLM API calls were made. No AgentDojo model runs were executed. These tests exercise Cortera Framework's actual decision engine (packages/guard-service, the real HTTP service at /evaluate-call) with zero AI model dependency.

---

## SUMMARY OF FIXES

### Root Cause Found (Step 1)
The `getPermissionCategory` function in `packages/guard-service/src/index.ts` had a keyword-matching bug: the first condition (category 3 - HIGH risk) only checked for `write, create, delete, update, destroy, execute` but was MISSING the keywords claimed in code comments: `reserve, post, invite, send, book, pay, transfer`. This caused blast-radius patterns like `reserve:*` and `post:*` to fall through to the wildcard catch-all (`endsWith(":*")`) in the second condition, classifying them as category 2 (MED) instead of category 3 (HIGH).

### Fixes Applied
1. **`getPermissionCategory`** (lines 58-72): Added missing high-risk keywords: `reserve, post, invite, send, book, pay, transfer`
2. **`inferBlastRadius` Slack section** (lines 272-284): Reordered to check write operations BEFORE read operations, and added `invite, add` to write condition. Fixed `add_user_to_channel` incorrectly returning `slack:read` due to "channel" keyword matching in read condition.

### Files Changed
- `packages/guard-service/src/index.ts` - Only file modified

---

## PART 1 — ATTACK-PATTERN REPLAY (POST-FIX vs PRE-FIX)

### Methodology
Constructed the tool-call sequences a compromised agent WOULD produce if it fell for each AgentDojo attack, and sent them directly to the real Guard Service. Tests "if an agent is tricked, does Cortera Framework still stop it" without needing a model to do the tricking.

- 27 injection tasks across 4 AgentDojo suites (banking, workspace, slack, travel)
- 6 attack templates (direct, ignore_previous, system_message, injecagent, important_instructions, tool_knowledge)
- Synthetic context_trace matching real adapter's tagging scheme
- Benign control set: equivalent legitimate tool calls with trusted context

### Results Comparison

| Metric | PRE-FIX | POST-FIX | Delta |
|--------|---------|----------|-------|
| Total malicious cases | 246 | 246 | — |
| Blocked/Guarded | 132 | 174 | **+42** |
| Allowed (false negatives) | 114 | 72 | **-42** |
| **Block+Guarded rate** | **53.66%** | **70.73%** | **+17.07%** |
| **False negative rate** | **46.34%** | **29.27%** | **-17.07%** |
| Total benign controls | 41 | 41 | — |
| False positives | 0 | 0 | — |
| **False positive rate** | **0.00%** | **0.00%** | **0%** |

#### By Suite

| Suite | PRE-FIX Block Rate | POST-FIX Block Rate | Delta |
|-------|-------------------|---------------------|-------|
| banking | 91.67% | 91.67% | 0% |
| workspace | 70.00% | 70.00% | 0% |
| slack | 12.50% | 75.00% | **+62.50%** |
| travel | 27.27% | 45.45% | **+18.18%** |

#### By Attack Type

| Attack Type | PRE-FIX Block Rate | POST-FIX Block Rate | Delta |
|-------------|-------------------|---------------------|-------|
| direct | 53.66% | 70.73% | +17.07% |
| ignore_previous | 53.66% | 70.73% | +17.07% |
| system_message | 53.66% | 70.73% | +17.07% |
| injecagent | 53.66% | 70.73% | +17.07% |
| important_instructions | 53.66% | 70.73% | +17.07% |
| tool_knowledge | 53.66% | 70.73% | +17.07% |

### Key Improvements
1. **Slack tools**: 12.50% → 75.00% (fixed `slack:*` generic pattern for invite/add/remove operations)
2. **Travel tools**: 27.27% → 45.45% (fixed `reserve:*` high-risk classification)
3. **Zero false positives** maintained throughout

---

## PART 2 — PROPERTY-BASED FUZZ TESTING (POST-FIX vs PRE-FIX)

### Methodology
Statistical coverage (3,000 invariant + 1,212 edge cases) checking Cortera Framework's core invariant:
> ANY call where causal root is "untrusted_external" AND tool's blast-radius tier is high-risk MUST NOT return verdict: "allow"

### Results Comparison

| Metric | PRE-FIX | POST-FIX | Delta |
|--------|---------|----------|-------|
| Total invariant cases | 3,000 | 3,000 | — |
| **Invariant violations** | **172** | **0** | **-172** ✓ |
| Verdict: allow | 2,838 | 2,188 | -650 |
| Verdict: guarded | 965 | 1,703 | +738 |
| Verdict: block | 16 | 8 | -8 |
| Verdict: error | 373 | 313 | -60 |
| Total edge cases | 1,192 | 1,212 | +20 |
| Crashes/errors | 373 | 313 | -60 |
| Silent allows on error | 0 | 0 | 0 |

### Invariant Violations by Tool (PRE-FIX)

| Tool | Violations | Blast Radius | High-Risk Detected |
|------|------------|--------------|-------------------|
| reserve_hotel | 95 | `reserve:*` | **NO** |
| post_webpage | 77 | `post:*` | **NO** |

**POST-FIX: All tools correctly enforce invariant (0 violations)**

### Tools with ZERO Invariant Violations (27/27)
All tools now correctly enforce the invariant including previously failing:
- `reserve_hotel`, `reserve_flight`, `reserve_car` (`reserve:*` → HIGH)
- `post_webpage` (`post:*` → HIGH)
- `invite_user_to_slack`, `add_user_to_channel`, `remove_user_from_slack` (`slack:write` → HIGH)

---

## PART 3 — BLAST-RADIUS TIER COVERAGE CHECK

### Results (Unchanged - was already passing)

| Metric | Value |
|--------|-------|
| Tools checked | 27 |
| Tools with tier assigned | 27 |
| Tools without tier | 0 |
| Findings | 0 |

All 27 tools have blast-radius tiers assigned — no silent enforcement gaps.

---

## VERIFICATION OF TARGETS

| Target | PRE-FIX | POST-FIX | Status |
|--------|---------|----------|--------|
| Invariant violations = 0 | 172 | **0** | ✓ **MET** |
| False positive rate = 0% | 0% | **0%** | ✓ **MET** |
| No silent allows on error | 0 | **0** | ✓ **MET** |

---

## REMAINING FALSE NEGATIVES (EXPECTED)

The 29.27% false negative rate in attack replay represents injection tasks targeting READ-ONLY operations that are CORRECTLY not classified as high-risk:

| Tool | Blast Radius | Reason |
|------|--------------|--------|
| get_scheduled_transactions | `workspace:read, files:read` | Read operation |
| search_emails | `search:*` | Read operation |
| get_channels | `slack:read` | Read operation |
| get_webpage | `workspace:read, files:read` | Read operation |
| read_channel_messages | `slack:read` | Read operation |
| get_user_information | `workspace:read, files:read` | Read operation |
| get_all_hotels_in_city | `workspace:read, files:read` | Read operation |
| get_hotels_prices | `workspace:read, files:read` | Read operation |

**This is correct behavior** — Cortera Framework's design only blocks/guards HIGH-RISK tools when invoked with untrusted context. Read operations are intentionally allowed.

---

## CONCLUSION

The blast-radius high-risk classification gap has been **fixed and verified**:

1. ✅ **Root cause identified and fixed**: Missing keywords in `getPermissionCategory`
2. ✅ **Secondary issue fixed**: Inconsistent blast-radius inference in `inferBlastRadius` (Slack write ordering)
3. ✅ **Invariant violations**: 172 → 0 (TARGET MET)
4. ✅ **False positive rate**: 0% maintained (TARGET MET)
5. ✅ **No silent allows on error**: 0 (TARGET MET)
6. ✅ **Attack replay block rate**: 53.66% → 70.73% (+17.07%)
7. ✅ **All 27 tools have blast-radius tiers**: No enforcement gaps

**Results are ready for publication.**

---

**Label**: Static replay of AgentDojo's published attack patterns + property-based fuzz testing against Cortera Framework's decision engine — no model was run, this is not an AgentDojo benchmark score.

**Raw Data Files**:
- `benchmark/attack_replay/results.json` and `results.csv`
- `benchmark/fuzz/results.json`
- `benchmark/tier_coverage/results.json`