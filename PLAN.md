# Junto — Full Audit, Fix & Test Plan

## Context

Junto is a payment MCP server (v0.1.1, published on npm and MCP Registry) with live Pix support via Woovi. The Woovi/Pix integration has been **verified with real transactions** (charge, status, payment — all confirmed working, March 2026). The project compiles, runs, and has been published. Remaining work focuses on expanding provider coverage and hardening.

---

## Phase 1: Fix Compile Blockers — COMPLETED

All compile blockers resolved. Project structure is in place, `tsc` compiles cleanly, `npm run build` succeeds.

```
src/
  index.ts
  types.ts
  guardrails.ts
  providers/
    woovi.ts
test/
  guardrails.test.ts
  smoke.test.ts
  live-pix.ts
demo/
  demo.ts
```

---

## Phase 2: Security & Compliance Fixes — COMPLETED

- All audit logging gaps closed (charge, status, balance, refund — all paths)
- Windows compatibility fixed (`os.homedir()`)
- `recordSpend` correctly documented (not called on confirmation path)

---

## Phase 3: Test Coverage (~90% of code is untested)

### 3.1 Create `test/helpers/mock-provider.ts`
- Implements `PaymentProvider` interface
- Records all method calls for assertion
- Configurable responses and failure modes
- No real API calls

### 3.2 Refactor `src/index.ts` for testability
- Extract a `createServer(providers, guardrails)` function that registers all 7 tools
- Keep `main()` as thin CLI wrapper (reads env, builds real providers, calls `createServer`)
- Export `createServer` so tests can inject mock providers

### 3.3 Create `test/index.test.ts` (~20-25 tests)
| Tool | Tests |
|------|-------|
| `pay` | success, blocked by per-tx limit, blocked by daily limit, needs confirmation, provider error, recordSpend called |
| `charge` | success, provider error + audit (regression for 2.1) |
| `status` | success + audit, error + audit (regression for 2.1) |
| `refund` | success + audit, error + audit (regression for 2.1) |
| `balance` | single provider, all providers, provider failure doesn't break aggregate |
| `providers` | lists all configured providers |
| `limits` | returns current guardrail status |
| `pickProvider` | forced found, forced not found, auto-route by currency, no match |

### 3.4 Create `test/woovi.test.ts` (~15-18 tests)
- Mock `global.fetch` — no real API calls
- Tests: pay, charge, status, refund request/response mapping
- Balance throws `BALANCE_NOT_SUPPORTED`
- Error handling: HTTP 401/500, timeout (AbortError), network failure
- `mapDestinationType`: all known types + unknown defaults to RANDOM
- `info()` returns correct metadata

---

## Phase 4: Cleanup — COMPLETED

- Zod validation on Woovi API responses (`.parse()` instead of `as` casts)
- `package.json` metadata filled in (author: vrllrv, repo URL, files field, mcpName)
- Woovi timeout configurable via `WOOVI_TIMEOUT_MS` env var
- Emoji removed from error messages
- Published to npm as v0.1.1
- Published to official MCP Registry as `io.github.vrllrv/junto-mcp`

---

## Phase 5: Final Verification — COMPLETED

All checks pass:
- `npm run build` — compiles cleanly
- `npm test` — guardrail tests pass
- `npm run test:smoke` — full flow smoke tests pass
- **Live Pix test** — real charge created, status checked, payment confirmed (March 2026)
- Interactive demo script (`demo/demo.ts`) — runs 7-step demo with real API calls

---

## Current File Structure

| File | Description |
|------|-------------|
| `src/index.ts` | MCP server — 7 tools, routing, guardrails |
| `src/types.ts` | Core interfaces and error types |
| `src/guardrails.ts` | Spend limits, HITL, audit logging |
| `src/providers/woovi.ts` | Woovi/Pix adapter (Zod-validated, live-tested) |
| `test/guardrails.test.ts` | Guardrail unit tests |
| `test/smoke.test.ts` | Full flow smoke tests (mock provider) |
| `test/live-pix.ts` | Live Pix CLI tester |
| `demo/demo.ts` | Interactive demo for screen recordings |

---

## Known Limitations (v0.2.0 backlog)
- `needs_confirmation` has no mechanism to distinguish first call from confirmed retry (infinite loop risk)
- No webhook support for async payment status updates
- Stripe/Wise/Belvo providers not yet implemented
- Woovi `pay()` uses single POST — may need 2-step flow (POST + APPROVE) depending on account config
- Woovi `balance()` not supported (no public API endpoint)
