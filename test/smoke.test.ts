// test/smoke.test.ts
// End-to-end smoke test: mock provider + guardrails + tool flows
// Run: npx tsx test/smoke.test.ts
//
// Validates the full payment flow without real API calls or MCP transport.

import { Guardrails } from "../src/guardrails.js";
import {
  PaymentProvider,
  PayRequest,
  PayResult,
  ChargeRequest,
  ChargeResult,
  StatusResult,
  RefundResult,
  BalanceResult,
  ProviderInfo,
  JuntoError,
} from "../src/types.js";

// --- Minimal test runner ---

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    return result
      .then(() => { console.log(`  ✓ ${name}`); passed++; })
      .catch((err) => { console.error(`  ✗ ${name}`); console.error(`    ${err instanceof Error ? err.message : String(err)}`); failed++; });
  }
  console.log(`  ✓ ${name}`);
  passed++;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// --- Mock Provider ---

class MockProvider implements PaymentProvider {
  name = "mock";
  supportedCurrencies = ["BRL"];
  supportedRails = ["pix"];
  settlementTime = "instant";

  calls: { method: string; args: unknown[] }[] = [];
  shouldFail = false;

  async pay(req: PayRequest): Promise<PayResult> {
    this.calls.push({ method: "pay", args: [req] });
    if (this.shouldFail) throw new JuntoError("Mock pay failed", "MOCK_ERROR", "mock");
    return {
      id: `mock-${Date.now()}`,
      status: "COMPLETED",
      provider: this.name,
      amount: req.amount,
      currency: req.currency,
      destination: req.destination,
      timestamp: new Date().toISOString(),
    };
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ method: "charge", args: [req] });
    if (this.shouldFail) throw new JuntoError("Mock charge failed", "MOCK_ERROR", "mock");
    return {
      id: `mock-charge-${Date.now()}`,
      status: "ACTIVE",
      provider: this.name,
      amount: req.amount,
      currency: req.currency,
      timestamp: new Date().toISOString(),
    };
  }

  async status(id: string): Promise<StatusResult> {
    this.calls.push({ method: "status", args: [id] });
    if (this.shouldFail) throw new JuntoError("Mock status failed", "MOCK_ERROR", "mock");
    return {
      id,
      status: "COMPLETED",
      provider: this.name,
      amount: 1000,
      currency: "BRL",
      timestamp: new Date().toISOString(),
    };
  }

  async refund(id: string): Promise<RefundResult> {
    this.calls.push({ method: "refund", args: [id] });
    if (this.shouldFail) throw new JuntoError("Mock refund failed", "MOCK_ERROR", "mock");
    return {
      id,
      status: "CREATED",
      provider: this.name,
      refunded_amount: 1000,
      timestamp: new Date().toISOString(),
    };
  }

  async balance(): Promise<BalanceResult> {
    this.calls.push({ method: "balance", args: [] });
    if (this.shouldFail) throw new JuntoError("Mock balance failed", "MOCK_ERROR", "mock");
    return { provider: this.name, currency: "BRL", available: 100_000 };
  }

  info(): ProviderInfo {
    return {
      name: this.name,
      currencies: this.supportedCurrencies,
      rails: this.supportedRails,
      settlement: this.settlementTime,
      status: "active",
    };
  }

  reset() {
    this.calls = [];
    this.shouldFail = false;
  }
}

// --- Router (same logic as index.ts) ---

function pickProvider(
  providers: Map<string, PaymentProvider>,
  currency?: string,
  rail?: string,
  forced?: string
): PaymentProvider {
  if (forced) {
    if (providers.has(forced)) return providers.get(forced)!;
    throw new JuntoError(
      `Provider '${forced}' not found. Available: ${Array.from(providers.keys()).join(", ")}`,
      "PROVIDER_NOT_FOUND"
    );
  }
  for (const [, p] of providers) {
    if (currency && !p.supportedCurrencies.includes(currency)) continue;
    if (rail && !p.supportedRails.includes(rail)) continue;
    return p;
  }
  throw new JuntoError(
    `No provider for currency=${currency ?? "any"}, rail=${rail ?? "any"}`,
    "NO_PROVIDER_MATCH"
  );
}

// --- Tests ---

process.env.JUNTO_LOG_DIR = "/tmp/junto-smoke-test";

async function runTests() {
  console.log("\n🔥  Smoke Tests\n");

  const mock = new MockProvider();
  const providers: Map<string, PaymentProvider> = new Map([["mock", mock]]);

  // ==========================================
  // 1. FULL PAY FLOW: guardrails -> route -> provider -> audit
  // ==========================================

  await test("pay flow: small payment goes through", async () => {
    mock.reset();
    const guardrails = new Guardrails({ per_tx_max: 20000, daily_max: 50000, confirm_above: 5000 });
    const req: PayRequest = { amount: 1000, currency: "BRL", destination: "test@email.com" };

    const check = guardrails.checkPay(req);
    assert(check.allowed === true, "guardrails should allow");
    assert(check.needs_confirmation === false, "no confirmation needed");

    const provider = pickProvider(providers, req.currency);
    const result = await provider.pay(req);

    assert(result.status === "COMPLETED", `expected COMPLETED, got ${result.status}`);
    assert(result.amount === 1000, `expected 1000, got ${result.amount}`);
    assert(result.provider === "mock", `expected mock, got ${result.provider}`);
    assert(mock.calls.length === 1, "provider.pay should be called once");
    assert(mock.calls[0].method === "pay", "should call pay method");

    guardrails.recordSpend(req.amount);
    const status = guardrails.getStatus();
    assert(status.daily_spend === 1000, `spend should be 1000, got ${status.daily_spend}`);
  });

  await test("pay flow: blocked by per-tx limit", async () => {
    const guardrails = new Guardrails({ per_tx_max: 5000 });
    const req: PayRequest = { amount: 6000, currency: "BRL", destination: "test@email.com" };
    const check = guardrails.checkPay(req);
    assert(check.allowed === false, "should be blocked");
    assert(check.reason!.includes("per-transaction"), "reason mentions per-transaction");
  });

  await test("pay flow: blocked by daily limit after spending", async () => {
    const guardrails = new Guardrails({ daily_max: 10000, per_tx_max: 100000, confirm_above: 100000 });
    guardrails.recordSpend(8000);
    const req: PayRequest = { amount: 3000, currency: "BRL", destination: "test@email.com" };
    const check = guardrails.checkPay(req);
    assert(check.allowed === false, "should be blocked by daily limit");
  });

  await test("pay flow: needs confirmation above threshold", async () => {
    const guardrails = new Guardrails({ confirm_above: 2000, per_tx_max: 100000 });
    const req: PayRequest = { amount: 3000, currency: "BRL", destination: "test@email.com" };
    const check = guardrails.checkPay(req);
    assert(check.allowed === true, "should be allowed");
    assert(check.needs_confirmation === true, "should need confirmation");
  });

  await test("pay flow: provider failure is catchable", async () => {
    mock.reset();
    mock.shouldFail = true;
    const guardrails = new Guardrails();
    const req: PayRequest = { amount: 1000, currency: "BRL", destination: "test@email.com" };
    const check = guardrails.checkPay(req);
    assert(check.allowed === true, "guardrails allow it");

    const provider = pickProvider(providers, req.currency);
    let caught = false;
    try {
      await provider.pay(req);
    } catch (err) {
      caught = true;
      assert(err instanceof JuntoError, "should be JuntoError");
      assert((err as JuntoError).code === "MOCK_ERROR", "should have MOCK_ERROR code");
    }
    assert(caught, "should have caught the error");
    mock.reset();
  });

  // ==========================================
  // 2. CHARGE FLOW
  // ==========================================

  await test("charge flow: creates charge successfully", async () => {
    mock.reset();
    const provider = pickProvider(providers, "BRL");
    const result = await provider.charge({ amount: 5000, currency: "BRL", description: "Test charge" });
    assert(result.status === "ACTIVE", `expected ACTIVE, got ${result.status}`);
    assert(result.amount === 5000, `expected 5000, got ${result.amount}`);
    assert(mock.calls[0].method === "charge", "should call charge");
  });

  // ==========================================
  // 3. STATUS FLOW
  // ==========================================

  await test("status flow: checks status successfully", async () => {
    mock.reset();
    const provider = pickProvider(providers, "BRL");
    const result = await provider.status("test-correlation-id");
    assert(result.id === "test-correlation-id", "id should match");
    assert(result.status === "COMPLETED", `expected COMPLETED, got ${result.status}`);
    assert(mock.calls[0].method === "status", "should call status");
  });

  // ==========================================
  // 4. REFUND FLOW
  // ==========================================

  await test("refund flow: refunds successfully", async () => {
    mock.reset();
    const provider = pickProvider(providers, "BRL");
    const result = await provider.refund("test-correlation-id");
    assert(result.id === "test-correlation-id", "id should match");
    assert(result.status === "CREATED", `expected CREATED, got ${result.status}`);
    assert(mock.calls[0].method === "refund", "should call refund");
  });

  // ==========================================
  // 5. BALANCE FLOW
  // ==========================================

  await test("balance flow: returns balance", async () => {
    mock.reset();
    const provider = pickProvider(providers, "BRL");
    const result = await provider.balance();
    assert(result.available === 100_000, `expected 100000, got ${result.available}`);
    assert(mock.calls[0].method === "balance", "should call balance");
  });

  // ==========================================
  // 6. PROVIDER ROUTING
  // ==========================================

  await test("router: picks provider by currency", () => {
    const p = pickProvider(providers, "BRL");
    assert(p.name === "mock", "should pick mock for BRL");
  });

  await test("router: forced provider found", () => {
    const p = pickProvider(providers, undefined, undefined, "mock");
    assert(p.name === "mock", "should return forced mock");
  });

  await test("router: forced provider not found throws", () => {
    let caught = false;
    try {
      pickProvider(providers, undefined, undefined, "nonexistent");
    } catch (err) {
      caught = true;
      assert(err instanceof JuntoError, "should be JuntoError");
      assert((err as JuntoError).code === "PROVIDER_NOT_FOUND", "code should be PROVIDER_NOT_FOUND");
    }
    assert(caught, "should throw for unknown provider");
  });

  await test("router: no match throws", () => {
    let caught = false;
    try {
      pickProvider(providers, "USD");
    } catch (err) {
      caught = true;
      assert(err instanceof JuntoError, "should be JuntoError");
      assert((err as JuntoError).code === "NO_PROVIDER_MATCH", "code should be NO_PROVIDER_MATCH");
    }
    assert(caught, "should throw when no provider matches currency");
  });

  // ==========================================
  // 7. PROVIDER INFO
  // ==========================================

  await test("provider info: returns correct metadata", () => {
    const info = mock.info();
    assert(info.name === "mock", "name should be mock");
    assert(info.currencies.includes("BRL"), "should support BRL");
    assert(info.rails.includes("pix"), "should support pix");
    assert(info.status === "active", "should be active");
  });

  // ==========================================
  // 8. GUARDRAILS STATUS
  // ==========================================

  await test("limits: tracks spending across multiple payments", () => {
    const guardrails = new Guardrails({ daily_max: 50000 });
    guardrails.recordSpend(5000);
    guardrails.recordSpend(3000);
    guardrails.recordSpend(2000);
    const status = guardrails.getStatus();
    assert(status.daily_spend === 10000, `spend should be 10000, got ${status.daily_spend}`);
    assert(status.daily_remaining === 40000, `remaining should be 40000, got ${status.daily_remaining}`);
  });

  // --- Summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
