#!/usr/bin/env npx tsx
// demo/demo.ts
// Interactive demo for screen recordings and peer presentations.
// Runs real Woovi/Pix API calls with typewriter-style narration.
//
// Usage:
//   $env:WOOVI_APP_ID="your-key"; npx tsx demo/demo.ts
//
// The demo will:
//   1. Show what Junto is
//   2. List configured providers
//   3. Show guardrail limits
//   4. Create a real Pix charge (R$1.00)
//   5. Check its status
//   6. Try a payment that triggers HITL confirmation
//   7. Try a payment that gets blocked by guardrails

import { WooviProvider } from "../src/providers/woovi.js";
import { Guardrails } from "../src/guardrails.js";
import { createInterface } from "readline";

// --- Config ---

async function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    // Hide input by intercepting keystrokes
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);

    let input = "";
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        // Enter pressed
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      } else if (c === "\u0003") {
        // Ctrl+C
        process.stdout.write("\n");
        process.exit(0);
      } else if (c === "\u007f" || c === "\b") {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        input += c;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

let appId = process.env.WOOVI_APP_ID;
if (!appId) {
  console.log();
  console.log("  \x1b[1mJunto Demo Setup\x1b[0m");
  console.log();
  appId = await readSecret("  Enter your WOOVI_APP_ID: ");
  if (!appId.trim()) {
    console.error("\n  No API key provided. Exiting.\n");
    process.exit(1);
  }
  appId = appId.trim();
  console.log("  \x1b[32m>\x1b[0m API key configured.");
  console.log();
}

const FAST = process.argv.includes("--fast");
const CHAR_DELAY = FAST ? 5 : 18;
const LINE_PAUSE = FAST ? 100 : 400;
const STEP_PAUSE = FAST ? 500 : 2000;
const RESULT_PAUSE = FAST ? 300 : 1200;

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function type(text: string, delay = CHAR_DELAY): Promise<void> {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(delay);
  }
  process.stdout.write("\n");
}

async function typeLines(lines: string[], delay = CHAR_DELAY): Promise<void> {
  for (const line of lines) {
    await type(line, delay);
    await sleep(LINE_PAUSE);
  }
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}

function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}

function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}

function red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}

function cyan(s: string): string {
  return `\x1b[36m${s}\x1b[0m`;
}

async function header(step: number, title: string): Promise<void> {
  console.log();
  await type(`${dim(`[${step}/7]`)} ${bold(title)}`);
  console.log();
  await sleep(LINE_PAUSE);
}

async function showCommand(cmd: string): Promise<void> {
  await type(`  ${dim("$")} ${cyan(cmd)}`, CHAR_DELAY);
  await sleep(RESULT_PAUSE);
}

function printJson(data: unknown): void {
  const lines = JSON.stringify(data, null, 2).split("\n");
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

async function pressEnter(): Promise<void> {
  await sleep(STEP_PAUSE);
}

// --- Demo ---

const provider = new WooviProvider(appId);
const guardrails = new Guardrails({
  daily_max: 50_000,
  per_tx_max: 20_000,
  confirm_above: 5_000,
  allowed_providers: [],
  allowed_destination_types: [],
});

async function demo() {
  console.clear();
  console.log();

  // ============================================
  // INTRO
  // ============================================

  await typeLines([
    bold("  Junto"),
    dim("  The payment protocol for people and agents."),
    "",
    dim("  One MCP server. Any payment rail. Built-in guardrails."),
    dim("  This demo uses the real Woovi/Pix API. Every call is live."),
  ]);

  await pressEnter();

  // ============================================
  // STEP 1: Providers
  // ============================================

  await header(1, "Check configured providers");
  await showCommand("junto providers");

  const providerInfo = provider.info();
  printJson([providerInfo]);

  console.log();
  await type(`  ${green(">")} Woovi/Pix is live. Instant settlement. 180M+ users in Brazil.`);

  await pressEnter();

  // ============================================
  // STEP 2: Guardrail limits
  // ============================================

  await header(2, "Check spending limits");
  await showCommand("junto limits");

  const limits = guardrails.getStatus();
  printJson(limits);

  console.log();
  await type(`  ${green(">")} Agents can't go rogue. Daily cap: R$500. Per-tx max: R$200.`);
  await type(`  ${green(">")} Anything above R$50 asks the human first.`);

  await pressEnter();

  // ============================================
  // STEP 3: Create a charge
  // ============================================

  await header(3, "Create a Pix charge (R$1.00)");
  await showCommand('junto charge --amount 100 --description "Demo coffee payment"');

  console.log();
  await type(dim("  Calling Woovi API..."));
  console.log();

  const charge = await provider.charge({
    amount: 100,
    currency: "BRL",
    description: "Demo coffee payment",
  });

  printJson({
    id: charge.id,
    status: charge.status,
    amount: "R$ 1.00",
    provider: charge.provider,
    payment_link: charge.payment_link,
    qr_code: charge.qr_code,
    br_code: charge.br_code?.substring(0, 60) + "...",
  });

  console.log();
  await type(`  ${green(">")} Real Pix QR code generated. Anyone can scan and pay.`);
  if (charge.payment_link) {
    await type(`  ${green(">")} Payment link: ${charge.payment_link}`);
  }

  await pressEnter();

  // ============================================
  // STEP 4: Check status
  // ============================================

  await header(4, "Check charge status");
  await showCommand(`junto status --id ${charge.id}`);

  console.log();
  await type(dim("  Querying Woovi..."));
  console.log();

  const status = await provider.status(charge.id);
  printJson(status);

  console.log();
  await type(`  ${green(">")} Status: ${yellow(status.status)} — waiting for payment.`);

  await pressEnter();

  // ============================================
  // STEP 5: HITL confirmation
  // ============================================

  await header(5, "Guardrail: human-in-the-loop confirmation");
  await showCommand('junto pay --amount 15000 --destination maria@email.com --type EMAIL');

  const hitlCheck = guardrails.checkPay({
    amount: 15_000,
    currency: "BRL",
    destination: "maria@email.com",
    destination_type: "EMAIL",
  });

  console.log();
  console.log(`  ${yellow("!")} Confirmation required`);
  console.log();
  console.log(`    Amount:      ${bold("BRL 150.00")}`);
  console.log(`    To:          maria@email.com`);
  console.log(`    Reason:      ${hitlCheck.reason}`);
  console.log();
  console.log(`    ${dim("Please confirm with the user before proceeding.")}`);

  console.log();
  await type(`  ${green(">")} Agent pauses. Human stays in control. Always.`);

  await pressEnter();

  // ============================================
  // STEP 6: Blocked by limit
  // ============================================

  await header(6, "Guardrail: per-transaction limit");
  await showCommand('junto pay --amount 50000 --destination rogue@hacker.com --type EMAIL');

  const blockedCheck = guardrails.checkPay({
    amount: 50_000,
    currency: "BRL",
    destination: "rogue@hacker.com",
    destination_type: "EMAIL",
  });

  console.log();
  console.log(`  ${red("X")} Payment blocked`);
  console.log();
  console.log(`    Amount:      ${bold("BRL 500.00")}`);
  console.log(`    To:          rogue@hacker.com`);
  console.log(`    Reason:      ${blockedCheck.reason}`);

  console.log();
  await type(`  ${green(">")} Hard limit. No override. The agent cannot send this.`);

  await pressEnter();

  // ============================================
  // STEP 7: Architecture
  // ============================================

  await header(7, "How it works");

  await typeLines([
    dim("  ┌─────────────────────────────────────┐"),
    dim("  │  AI Agent (Claude, Cursor, etc.)     │"),
    dim("  └──────────────┬──────────────────────┘"),
    dim("                 │ MCP Protocol (stdio)"),
    dim("  ┌──────────────▼──────────────────────┐"),
    dim("  │           junto-mcp                 │"),
    dim("  │                                     │"),
    dim("  │  Router ──> Guardrails ──> Provider  │"),
    dim("  │                                     │"),
    dim("  │  ┌────────┐ ┌──────┐ ┌────┐        │"),
    dim("  │  │ Woovi  │ │Stripe│ │Wise│  ...    │"),
    dim("  │  └────────┘ └──────┘ └────┘        │"),
    dim("  └─────────────────────────────────────┘"),
  ], 8);

  console.log();
  await typeLines([
    `  ${green(">")} One server. Any AI client. Any payment rail.`,
    `  ${green(">")} Add a provider = add a file. That's it.`,
    "",
    bold("  npm install -g junto-mcp"),
    dim("  github.com/vrllrv/junto-mcp"),
    "",
  ]);

  console.log();
}

demo().catch((err) => {
  console.error("\nDemo error:", err.message ?? err);
  process.exit(1);
});
