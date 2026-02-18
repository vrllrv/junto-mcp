// test/guardrails.test.ts
// Run: npx tsx test/guardrails.test.ts
//
// Minimal test runner — no dependencies required.

import { Guardrails, DEFAULT_CONFIG } from "../src/guardrails.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// --- Tests ---

console.log("\n🛡️  Guardrails Tests\n");

// Override log dir so tests don't pollute home directory
process.env.JUNTO_LOG_DIR = "/tmp/junto-test-logs";

test("allows payment within all limits", () => {
  const g = new Guardrails();
  const result = g.checkPay({ amount: 1000, currency: "BRL", destination: "test@email.com" });
  assert(result.allowed === true, "should be allowed");
  assert(result.needs_confirmation === false, "should not need confirmation");
});

test("blocks payment exceeding per-transaction max", () => {
  const g = new Guardrails({ per_tx_max: 5000 });
  const result = g.checkPay({ amount: 6000, currency: "BRL", destination: "test@email.com" });
  assert(result.allowed === false, "should be blocked");
  assert(result.reason!.includes("per-transaction limit"), "reason should mention limit");
});

test("requires confirmation above threshold", () => {
  const g = new Guardrails({ confirm_above: 2000, per_tx_max: 100000 });
  const result = g.checkPay({ amount: 3000, currency: "BRL", destination: "test@email.com" });
  assert(result.allowed === true, "should be allowed");
  assert(result.needs_confirmation === true, "should need confirmation");
});

test("does not require confirmation at exactly the threshold", () => {
  const g = new Guardrails({ confirm_above: 5000, per_tx_max: 100000 });
  const result = g.checkPay({ amount: 5000, currency: "BRL", destination: "test@email.com" });
  assert(result.allowed === true, "should be allowed");
  assert(result.needs_confirmation === false, "should not need confirmation at exact threshold");
});

test("blocks payment exceeding daily limit", () => {
  const g = new Guardrails({ daily_max: 10000, per_tx_max: 100000, confirm_above: 100000 });
  g.recordSpend(8000);
  const result = g.checkPay({ amount: 3000, currency: "BRL", destination: "test@email.com" });
  assert(result.allowed === false, "should be blocked");
  assert(result.reason!.includes("daily limit"), "reason should mention daily limit");
});

test("allows payment that fits within remaining daily budget", () => {
  const g = new Guardrails({ daily_max: 10000, per_tx_max: 100000, confirm_above: 100000 });
  g.recordSpend(7000);
  const result = g.checkPay({ amount: 3000, currency: "BRL", destination: "test@email.com" });
  assert(result.allowed === true, "should be allowed (7000 + 3000 = 10000)");
});

test("blocks provider not in allowlist", () => {
  const g = new Guardrails({ allowed_providers: ["woovi"] });
  const result = g.checkPay({
    amount: 1000,
    currency: "BRL",
    destination: "test@email.com",
    provider: "stripe",
  });
  assert(result.allowed === false, "should be blocked");
  assert(result.reason!.includes("not in allowed list"), "reason should mention allowlist");
});

test("allows provider in allowlist", () => {
  const g = new Guardrails({ allowed_providers: ["woovi", "stripe"] });
  const result = g.checkPay({
    amount: 1000,
    currency: "BRL",
    destination: "test@email.com",
    provider: "woovi",
  });
  assert(result.allowed === true, "should be allowed");
});

test("empty allowlist means all providers allowed", () => {
  const g = new Guardrails({ allowed_providers: [] });
  const result = g.checkPay({
    amount: 1000,
    currency: "BRL",
    destination: "test@email.com",
    provider: "anything",
  });
  assert(result.allowed === true, "should be allowed when allowlist is empty");
});

test("getStatus returns correct remaining budget", () => {
  const g = new Guardrails({ daily_max: 50000 });
  g.recordSpend(12000);
  const status = g.getStatus();
  assert(status.daily_spend === 12000, `spend should be 12000, got ${status.daily_spend}`);
  assert(status.daily_remaining === 38000, `remaining should be 38000, got ${status.daily_remaining}`);
  assert(status.daily_limit === 50000, `limit should be 50000, got ${status.daily_limit}`);
});

test("default config values are correct", () => {
  assert(DEFAULT_CONFIG.daily_max === 50_000, "daily_max should be 50000 (R$500)");
  assert(DEFAULT_CONFIG.per_tx_max === 20_000, "per_tx_max should be 20000 (R$200)");
  assert(DEFAULT_CONFIG.confirm_above === 5_000, "confirm_above should be 5000 (R$50)");
});

test("blocks destination type not in allowlist", () => {
  const g = new Guardrails({ allowed_destination_types: ["EMAIL", "CPF"] });
  const result = g.checkPay({
    amount: 1000,
    currency: "BRL",
    destination: "+5511999887766",
    destination_type: "PHONE",
  });
  assert(result.allowed === false, "should be blocked");
  assert(result.reason!.includes("Destination type"), "reason should mention destination type");
});

// --- Summary ---

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
