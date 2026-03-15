// src/cli.ts
// Human-friendly CLI for Junto.
//
// Usage:
//   junto pay 25.00 maria@email.com
//   junto charge 10.00 "Coffee"
//   junto status <id>
//   junto refund <id>
//   junto balance
//   junto providers
//   junto limits
//   junto setup

import { createInterface } from "readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import { PaymentProvider, JuntoError } from "./types.js";
import { WooviProvider } from "./providers/woovi.js";
import { Guardrails, DEFAULT_CONFIG } from "./guardrails.js";

// --- Colors ---

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

// --- Config file ---

const CONFIG_DIR = join(homedir(), ".junto");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface JuntoConfig {
  WOOVI_APP_ID?: string;
  JUNTO_DAILY_LIMIT?: number;
  JUNTO_PER_TX_MAX?: number;
  JUNTO_CONFIRM_ABOVE?: number;
}

function loadConfig(): JuntoConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {
    // ignore
  }
  return {};
}

function saveConfig(config: JuntoConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

// --- Input helpers ---

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function askSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // Non-interactive — read line normally
      const rl = createInterface({ input: stdin });
      rl.once("line", (line) => { rl.close(); resolve(line.trim()); });
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let input = "";
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener("data", onData);
        stdin.pause();
        process.stdout.write("\n");
        resolve(input.trim());
      } else if (c === "\u0003") {
        process.stdout.write("\n");
        process.exit(0);
      } else if (c === "\u007f" || c === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (c.charCodeAt(0) >= 32) {
        input += c;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

async function confirm(prompt: string): Promise<boolean> {
  const answer = await ask(`${prompt} ${dim("[y/N]")} `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

// --- Amount parsing ---

function parseAmount(input: string): number {
  // Accept: 25, 25.00, 25.5, R$25.00, BRL 25
  const cleaned = input.replace(/[R$\s,BRL]/gi, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) {
    console.error(red(`  Invalid amount: "${input}"`));
    console.error(dim("  Examples: 25.00, 10, R$50.00"));
    process.exit(1);
  }
  return Math.round(num * 100); // convert to cents
}

function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2)}`;
}

// --- Destination type detection ---

function detectDestinationType(dest: string): string {
  if (/^[^@]+@[^@]+\.[^@]+$/.test(dest)) return "EMAIL";
  if (/^\+?\d{10,13}$/.test(dest.replace(/[\s()-]/g, ""))) return "PHONE";
  if (/^\d{11}$/.test(dest)) return "CPF";
  if (/^\d{14}$/.test(dest)) return "CNPJ";
  return "RANDOM";
}

// --- Bootstrap ---

function bootstrap(config: JuntoConfig) {
  const providers: Map<string, PaymentProvider> = new Map();

  const wooviKey = process.env.WOOVI_APP_ID ?? config.WOOVI_APP_ID;
  if (wooviKey) {
    providers.set("woovi", new WooviProvider(
      wooviKey,
      parseInt(process.env.WOOVI_TIMEOUT_MS ?? "15000", 10)
    ));
  }

  const guardrails = new Guardrails({
    daily_max: parseInt(
      process.env.JUNTO_DAILY_LIMIT ?? String(config.JUNTO_DAILY_LIMIT ?? DEFAULT_CONFIG.daily_max),
      10
    ),
    per_tx_max: parseInt(
      process.env.JUNTO_PER_TX_MAX ?? String(config.JUNTO_PER_TX_MAX ?? DEFAULT_CONFIG.per_tx_max),
      10
    ),
    confirm_above: parseInt(
      process.env.JUNTO_CONFIRM_ABOVE ?? String(config.JUNTO_CONFIRM_ABOVE ?? DEFAULT_CONFIG.confirm_above),
      10
    ),
    allowed_providers:
      process.env.JUNTO_ALLOWED_PROVIDERS?.split(",").filter(Boolean) ?? [],
    allowed_destination_types:
      process.env.JUNTO_ALLOWED_DESTINATIONS?.split(",").filter(Boolean) ?? [],
  });

  function pickProvider(currency?: string, rail?: string, forced?: string): PaymentProvider {
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

  return { providers, guardrails, pickProvider };
}

// --- Commands ---

async function cmdSetup() {
  console.log();
  console.log(bold("  Junto Setup"));
  console.log();

  const config = loadConfig();

  const existing = config.WOOVI_APP_ID ? dim(" (already configured)") : "";
  console.log(`  Configure your Woovi/OpenPix API key${existing}`);
  console.log(dim("  Get yours at https://app.woovi.com → API/Plugins → New API"));
  console.log();

  const key = await askSecret("  WOOVI_APP_ID: ");

  if (key) {
    config.WOOVI_APP_ID = key;
    saveConfig(config);
    console.log();
    console.log(green("  Saved to ~/.junto/config.json"));
    console.log();
    console.log(dim("  Try it:"));
    console.log(`  ${cyan("junto charge 1.00 \"Test charge\"")}`);
    console.log(`  ${cyan("junto providers")}`);
    console.log(`  ${cyan("junto limits")}`);
  } else {
    console.log(dim("  Skipped."));
  }

  console.log();
}

async function cmdPay(args: string[]) {
  // Parse: junto pay 25.00 maria@email.com [--note "Coffee"]
  if (args.length < 2) {
    console.log();
    console.log(bold("  Usage:"));
    console.log(`  ${cyan("junto pay")} ${dim("<amount> <destination> [--note \"memo\"] [--type EMAIL|CPF|PHONE|CNPJ]")}`);
    console.log();
    console.log(dim("  Examples:"));
    console.log(`    junto pay 25.00 maria@email.com`);
    console.log(`    junto pay 10 12345678900 --type CPF`);
    console.log(`    junto pay 150.00 +5511999887766 --note "Rent"`);
    console.log();
    process.exit(1);
  }

  const config = loadConfig();
  const { providers, guardrails, pickProvider } = bootstrap(config);

  if (providers.size === 0) {
    console.log();
    console.log(red("  No providers configured."));
    console.log(`  Run ${cyan("junto setup")} to add your API key.`);
    console.log();
    process.exit(1);
  }

  const amount = parseAmount(args[0]);
  const destination = args[1];
  const destType = args.includes("--type")
    ? args[args.indexOf("--type") + 1]
    : detectDestinationType(destination);
  const noteIdx = args.indexOf("--note");
  const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined;

  // Guardrails check
  const check = guardrails.checkPay({
    amount,
    currency: "BRL",
    destination,
    destination_type: destType,
  });

  if (!check.allowed) {
    console.log();
    console.log(`  ${red("Blocked")}  ${check.reason}`);
    console.log();
    process.exit(1);
  }

  // Show summary and confirm
  console.log();
  console.log(bold("  Payment Summary"));
  console.log();
  console.log(`  Amount:       ${bold(formatBRL(amount))}`);
  console.log(`  To:           ${destination} ${dim(`(${destType})`)}`);
  if (note) console.log(`  Note:         ${note}`);
  console.log(`  Provider:     ${pickProvider("BRL").name}`);
  console.log();

  if (check.needs_confirmation || amount > 100) {
    if (check.needs_confirmation) {
      console.log(yellow(`  ${check.reason}`));
      console.log();
    }
    const ok = await confirm("  Send this payment?");
    if (!ok) {
      console.log(dim("  Cancelled."));
      console.log();
      return;
    }
  }

  console.log();
  process.stdout.write(dim("  Sending..."));

  try {
    const provider = pickProvider("BRL");
    const result = await provider.pay({
      amount,
      currency: "BRL",
      destination,
      destination_type: destType,
      note,
    });

    guardrails.recordSpend(amount);
    guardrails.audit({
      timestamp: new Date().toISOString(),
      type: "payment",
      action: "pay",
      tool: "cli",
      amount,
      currency: "BRL",
      provider: provider.name,
      destination,
      status: "executed",
    });

    process.stdout.write("\r");
    console.log(green("  Sent!"));
    console.log();
    console.log(`  Amount:       ${bold(formatBRL(amount))}`);
    console.log(`  To:           ${destination}`);
    console.log(`  Provider:     ${result.provider}`);
    console.log(`  Status:       ${green(result.status)}`);
    console.log(`  ID:           ${dim(result.id)}`);
    console.log(`  Time:         ${dim(result.timestamp)}`);
    console.log();
    console.log(dim(`  Check status: junto status ${result.id}`));
  } catch (err) {
    process.stdout.write("\r");
    console.log(red(`  Failed: ${err instanceof Error ? err.message : String(err)}`));
    guardrails.audit({
      timestamp: new Date().toISOString(),
      type: "payment",
      action: "pay",
      tool: "cli",
      amount,
      currency: "BRL",
      destination,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    });
  }
  console.log();
}

async function cmdCharge(args: string[]) {
  if (args.length < 1) {
    console.log();
    console.log(bold("  Usage:"));
    console.log(`  ${cyan("junto charge")} ${dim("<amount> [description]")}`);
    console.log();
    console.log(dim("  Examples:"));
    console.log(`    junto charge 10.00 "Coffee"`);
    console.log(`    junto charge 250`);
    console.log();
    process.exit(1);
  }

  const config = loadConfig();
  const { providers, guardrails, pickProvider } = bootstrap(config);

  if (providers.size === 0) {
    console.log();
    console.log(red("  No providers configured."));
    console.log(`  Run ${cyan("junto setup")} to add your API key.`);
    console.log();
    process.exit(1);
  }

  const amount = parseAmount(args[0]);
  const description = args.slice(1).join(" ") || undefined;

  console.log();
  process.stdout.write(dim("  Creating charge..."));

  try {
    const provider = pickProvider("BRL");
    const result = await provider.charge({
      amount,
      currency: "BRL",
      description,
    });

    guardrails.audit({
      timestamp: new Date().toISOString(),
      type: "payment",
      action: "charge",
      tool: "cli",
      amount,
      currency: "BRL",
      provider: provider.name,
      status: "executed",
    });

    process.stdout.write("\r");
    console.log(green("  Charge created!"));
    console.log();
    console.log(`  Amount:       ${bold(formatBRL(amount))}`);
    if (description) console.log(`  Description:  ${description}`);
    console.log(`  Status:       ${green(result.status)}`);
    console.log(`  ID:           ${dim(result.id)}`);

    if (result.payment_link) {
      console.log();
      console.log(`  ${bold("Payment link:")}`);
      console.log(`  ${cyan(result.payment_link)}`);
    }

    if (result.br_code) {
      console.log();
      console.log(`  ${bold("Pix copy-paste:")}`);
      console.log(dim(`  ${result.br_code}`));
    }

    console.log();
    console.log(dim(`  Check status: junto status ${result.id}`));
  } catch (err) {
    process.stdout.write("\r");
    console.log(red(`  Failed: ${err instanceof Error ? err.message : String(err)}`));
  }
  console.log();
}

async function cmdStatus(args: string[]) {
  const config = loadConfig();
  const { providers, pickProvider } = bootstrap(config);

  if (providers.size === 0) {
    console.log();
    console.log(red("  No providers configured."));
    console.log(`  Run ${cyan("junto setup")} to add your API key.`);
    console.log();
    process.exit(1);
  }

  if (args.length < 1) {
    console.log();
    console.log(bold("  Usage:"));
    console.log(`  ${cyan("junto status")} ${dim("<id>")}`);
    console.log();
    process.exit(1);
  }

  const id = args[0];

  console.log();
  process.stdout.write(dim("  Checking..."));

  try {
    const provider = pickProvider();
    const result = await provider.status(id);

    process.stdout.write("\r");
    const statusColor = result.status === "COMPLETED" ? green
      : result.status === "ACTIVE" ? yellow
      : result.status === "FAILED" ? red
      : dim;

    console.log(`  ${bold("Status")}`);
    console.log();
    console.log(`  ID:           ${dim(result.id)}`);
    console.log(`  Status:       ${statusColor(result.status)}`);
    console.log(`  Amount:       ${formatBRL(result.amount)}`);
    console.log(`  Provider:     ${result.provider}`);
    console.log(`  Updated:      ${dim(result.timestamp)}`);
  } catch (err) {
    process.stdout.write("\r");
    console.log(red(`  Failed: ${err instanceof Error ? err.message : String(err)}`));
  }
  console.log();
}

async function cmdRefund(args: string[]) {
  const config = loadConfig();
  const { providers, pickProvider } = bootstrap(config);

  if (providers.size === 0) {
    console.log();
    console.log(red("  No providers configured."));
    console.log(`  Run ${cyan("junto setup")} to add your API key.`);
    console.log();
    process.exit(1);
  }

  if (args.length < 1) {
    console.log();
    console.log(bold("  Usage:"));
    console.log(`  ${cyan("junto refund")} ${dim("<id>")}`);
    console.log();
    process.exit(1);
  }

  const id = args[0];

  console.log();
  const ok = await confirm(`  Refund ${dim(id)}?`);
  if (!ok) {
    console.log(dim("  Cancelled."));
    console.log();
    return;
  }

  process.stdout.write(dim("  Processing refund..."));

  try {
    const provider = pickProvider();
    const result = await provider.refund(id);

    process.stdout.write("\r");
    console.log(green("  Refund submitted!"));
    console.log();
    console.log(`  ID:           ${dim(result.id)}`);
    console.log(`  Status:       ${result.status}`);
    console.log(`  Refunded:     ${formatBRL(result.refunded_amount)}`);
  } catch (err) {
    process.stdout.write("\r");
    console.log(red(`  Failed: ${err instanceof Error ? err.message : String(err)}`));
  }
  console.log();
}

async function cmdBalance() {
  const config = loadConfig();
  const { providers } = bootstrap(config);

  if (providers.size === 0) {
    console.log();
    console.log(red("  No providers configured."));
    console.log(`  Run ${cyan("junto setup")} to add your API key.`);
    console.log();
    process.exit(1);
  }

  console.log();
  console.log(bold("  Balance"));
  console.log();

  for (const [, p] of providers) {
    try {
      const result = await p.balance();
      console.log(`  ${p.name}:  ${bold(formatBRL(result.available))}`);
    } catch (err) {
      console.log(`  ${p.name}:  ${dim(err instanceof Error ? err.message : "unavailable")}`);
    }
  }
  console.log();
}

async function cmdProviders() {
  const config = loadConfig();
  const { providers } = bootstrap(config);

  console.log();
  console.log(bold("  Providers"));
  console.log();

  if (providers.size === 0) {
    console.log(dim("  None configured."));
    console.log(`  Run ${cyan("junto setup")} to add your first provider.`);
    console.log();
    return;
  }

  for (const [, p] of providers) {
    const info = p.info();
    console.log(`  ${green("●")} ${bold(info.name)}`);
    console.log(`    Currencies:  ${info.currencies.join(", ")}`);
    console.log(`    Rails:       ${info.rails.join(", ")}`);
    console.log(`    Settlement:  ${info.settlement}`);
    console.log();
  }
}

async function cmdLimits() {
  const config = loadConfig();
  const { guardrails } = bootstrap(config);

  const status = guardrails.getStatus();

  console.log();
  console.log(bold("  Spending Limits"));
  console.log();
  console.log(`  Daily limit:      ${bold(formatBRL(status.daily_limit))}`);
  console.log(`  Spent today:      ${formatBRL(status.daily_spend)}`);
  console.log(`  Remaining:        ${green(formatBRL(status.daily_remaining))}`);
  console.log(`  Per-tx max:       ${formatBRL(status.per_tx_max)}`);
  console.log(`  Confirm above:    ${formatBRL(status.confirm_above)}`);
  console.log();
}

function showHelp() {
  console.log();
  console.log(bold("  Junto") + dim(" — The payment protocol for people and agents."));
  console.log();
  console.log(bold("  Commands:"));
  console.log();
  console.log(`  ${cyan("junto setup")}                            Configure API keys`);
  console.log(`  ${cyan("junto pay")} ${dim("<amount> <destination>")}       Send money via Pix`);
  console.log(`  ${cyan("junto charge")} ${dim("<amount> [description]")}    Create a payment request / QR code`);
  console.log(`  ${cyan("junto status")} ${dim("<id>")}                      Check payment status`);
  console.log(`  ${cyan("junto refund")} ${dim("<id>")}                      Refund a payment`);
  console.log(`  ${cyan("junto balance")}                           Check available funds`);
  console.log(`  ${cyan("junto providers")}                         List configured providers`);
  console.log(`  ${cyan("junto limits")}                            Show spending limits`);
  console.log();
  console.log(bold("  Options:"));
  console.log();
  console.log(`  ${dim("--mcp")}     Run as MCP server (for AI clients)`);
  console.log(`  ${dim("--help")}    Show this help`);
  console.log(`  ${dim("--version")} Show version`);
  console.log();
  console.log(dim("  Config stored in ~/.junto/config.json"));
  console.log(dim("  Audit log in ~/.junto/audit-YYYY-MM-DD.jsonl"));
  console.log();
}

// --- Main ---

export async function runCLI(args: string[]): Promise<void> {
  const command = args[0]?.toLowerCase();
  const rest = args.slice(1);

  switch (command) {
    case "setup":
      return cmdSetup();
    case "pay":
      return cmdPay(rest);
    case "charge":
      return cmdCharge(rest);
    case "status":
      return cmdStatus(rest);
    case "refund":
      return cmdRefund(rest);
    case "balance":
      return cmdBalance();
    case "providers":
      return cmdProviders();
    case "limits":
      return cmdLimits();
    case "--version":
    case "-v":
      console.log("junto-mcp v0.1.1");
      return;
    case "--help":
    case "-h":
    case "help":
    default:
      showHelp();
      return;
  }
}
