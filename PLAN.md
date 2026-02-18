# Junto — Full Audit, Fix & Test Plan

## Context

Junto is a payment MCP server (v0.1.0) with Pix support. Before pushing to GitHub, we need to fix compile blockers, close security gaps, and build comprehensive test coverage. A thorough audit found **25 issues** across 4 severity levels.

---

## Phase 1: Fix Compile Blockers

The project won't compile or run currently. All imports already assume a `src/providers/` directory structure (confirmed by file headers and import paths), so we move files rather than rewrite imports.

### 1.1 Reorganize into intended directory structure
```
src/
  index.ts          ← (move from root)
  types.ts          ← (move from root)
  guardrails.ts     ← (move from root)
  providers/
    woovi.ts        ← (move from root)
test/
  guardrails.test.ts  ← (move from root)
  index.test.ts       ← (new, Phase 3)
  woovi.test.ts       ← (new, Phase 3)
  helpers/
    mock-provider.ts  ← (new, Phase 3)
```
**Zero import changes needed** — all paths already match this layout.

### 1.2 Create `tsconfig.json`
- `module: "Node16"` + `moduleResolution: "Node16"` (ESM with `.js` extensions)
- `rootDir: "src"`, `outDir: "dist"` (matches package.json bin/main)
- `strict: true`

### 1.3 Fix `package.json` test script
- Change `test/guardrails.test.ts` path (already correct after move)
- Add new test files to test script

### 1.4 Verify: `npm install && npx tsc --noEmit && npm run build`

---

## Phase 2: Security & Compliance Fixes

### 2.1 Add missing audit logging (4 gaps)
- **`src/index.ts` — charge tool error path**: no `guardrails.audit()` call on failure
- **`src/index.ts` — status tool**: zero audit logging (success or failure)
- **`src/index.ts` — balance tool**: zero audit logging (success or failure)
- **`src/index.ts` — refund tool error path**: no audit on failure

Each gets `guardrails.audit({...})` with timestamp, action, tool, status, reason.

### 2.2 Fix Windows compatibility (`src/guardrails.ts`)
- Replace `process.env.HOME ?? "."` with `os.homedir()` — works on all platforms

### 2.3 Clarify `recordSpend` for confirmed payments
- Add comment explaining `recordSpend` is correctly NOT called in the `needs_confirmation` path (no money moved yet — it's called on actual execution)
- Track the `needs_confirmation` infinite loop as a v0.2.0 design issue

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

## Phase 4: Cleanup

### 4.1 Add Zod validation on Woovi API responses (`src/providers/woovi.ts`)
- Replace unsafe `as` type casts with Zod schemas (`.parse()`)
- Clear error messages on unexpected API response shapes

### 4.2 Update `package.json` metadata
- Fill in `author` field
- Update repository URL (placeholder `user/junto-mcp`)

### 4.3 Make Woovi timeout configurable
- Accept `timeoutMs` in constructor, read from `WOOVI_TIMEOUT_MS` env var

### 4.4 Remove emoji from error messages
- `🚫`/`❌`/`⚠️` → plain text (machine-parsed output shouldn't contain emoji)

### 4.5 Replace TODO comment with version-scoped note

---

## Phase 5: Final Verification

```bash
npm run build              # tsc compiles src/ → dist/
npm test                   # all test suites pass
WOOVI_APP_ID=test node dist/index.js   # smoke test — server starts
```

Verify `dist/` structure mirrors `src/`, then commit and push.

---

## Files Modified/Created

| File | Action |
|------|--------|
| `src/index.ts` | Move + refactor (createServer export, audit gaps, emoji, TODO) |
| `src/types.ts` | Move only |
| `src/guardrails.ts` | Move + fix (os.homedir) |
| `src/providers/woovi.ts` | Move + fix (Zod validation, configurable timeout) |
| `test/guardrails.test.ts` | Move only |
| `test/helpers/mock-provider.ts` | **New** — mock PaymentProvider |
| `test/index.test.ts` | **New** — 20-25 tool tests |
| `test/woovi.test.ts` | **New** — 15-18 provider tests |
| `tsconfig.json` | **New** — TypeScript config |
| `package.json` | Fix test script + metadata |

---

## Known Limitations (v0.2.0 backlog)
- `needs_confirmation` has no mechanism to distinguish first call from confirmed retry (infinite loop risk)
- No webhook support for async payment status updates
- Stripe/Wise/Belvo providers not yet implemented
