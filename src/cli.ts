// src/cli.ts
// Human-friendly CLI for Junto.
// Supports English and Brazilian Portuguese (auto-detected or JUNTO_LANG=pt-BR).
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
import { t } from "./i18n.js";

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
  lang?: string;
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
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes" || answer.toLowerCase() === "s" || answer.toLowerCase() === "sim";
}

// --- Amount parsing ---

function parseAmount(input: string): number {
  const cleaned = input.replace(/[R$\s,BRL]/gi, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) {
    console.error(red(`  ${t.invalidAmount}: "${input}"`));
    console.error(dim(`  ${t.amountExamples}`));
    process.exit(1);
  }
  return Math.round(num * 100);
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

function noProviders(): never {
  console.log();
  console.log(red(`  ${t.noProviders}`));
  console.log(`  ${t.runSetup.replace("{cmd}", cyan("junto setup"))}`);
  console.log();
  process.exit(1);
}

// --- Commands ---

async function cmdSetup() {
  console.log();
  console.log(bold(`  ${t.setupTitle}`));
  console.log();

  const config = loadConfig();

  const existing = config.WOOVI_APP_ID ? dim(` ${t.alreadyConfigured}`) : "";
  console.log(`  ${t.setupPrompt}${existing}`);
  console.log(dim(`  ${t.setupHint}`));
  console.log();

  const key = await askSecret("  WOOVI_APP_ID: ");

  if (key) {
    config.WOOVI_APP_ID = key;
    saveConfig(config);
    console.log();
    console.log(green(`  ${t.saved}`));
    console.log();
    console.log(dim(`  ${t.tryIt}`));
    console.log(`  ${cyan("junto charge 1.00 \"Test charge\"")}`);
    console.log(`  ${cyan("junto providers")}`);
    console.log(`  ${cyan("junto limits")}`);
  } else {
    console.log(dim(`  ${t.skipped}`));
  }

  console.log();
}

async function cmdPay(args: string[]) {
  if (args.length < 2) {
    console.log();
    console.log(bold(`  ${t.commands}`));
    console.log(`  ${cyan("junto pay")} ${dim(t.payUsage)}`);
    console.log();
    console.log(dim("  " + (t.payExamples[0].startsWith("junto") ? "" : "  ")));
    for (const ex of t.payExamples) {
      console.log(`    ${ex}`);
    }
    console.log();
    process.exit(1);
  }

  const config = loadConfig();
  const { providers, guardrails, pickProvider } = bootstrap(config);
  if (providers.size === 0) noProviders();

  const amount = parseAmount(args[0]);
  const destination = args[1];
  const destType = args.includes("--type")
    ? args[args.indexOf("--type") + 1]
    : detectDestinationType(destination);
  const noteIdx = args.indexOf("--note");
  const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined;

  const check = guardrails.checkPay({
    amount,
    currency: "BRL",
    destination,
    destination_type: destType,
  });

  if (!check.allowed) {
    console.log();
    console.log(`  ${red(t.blocked)}  ${check.reason}`);
    console.log();
    process.exit(1);
  }

  console.log();
  console.log(bold(`  ${t.paymentSummary}`));
  console.log();
  console.log(`  ${t.amount}:       ${bold(formatBRL(amount))}`);
  console.log(`  ${t.to}:           ${destination} ${dim(`(${destType})`)}`);
  if (note) console.log(`  ${t.note}:         ${note}`);
  console.log(`  ${t.provider}:     ${pickProvider("BRL").name}`);
  console.log();

  if (check.needs_confirmation || amount > 100) {
    if (check.needs_confirmation) {
      console.log(yellow(`  ${check.reason}`));
      console.log();
    }
    const ok = await confirm(`  ${t.sendConfirm}`);
    if (!ok) {
      console.log(dim(`  ${t.cancelled}`));
      console.log();
      return;
    }
  }

  console.log();
  process.stdout.write(dim(`  ${t.sending}`));

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
    console.log(green(`  ${t.sent}`));
    console.log();
    console.log(`  ${t.amount}:       ${bold(formatBRL(amount))}`);
    console.log(`  ${t.to}:           ${destination}`);
    console.log(`  ${t.provider}:     ${result.provider}`);
    console.log(`  ${t.status}:       ${green(result.status)}`);
    console.log(`  ${t.id}:           ${dim(result.id)}`);
    console.log(`  ${t.time}:         ${dim(result.timestamp)}`);
    console.log();
    console.log(dim(`  ${t.checkStatus}: junto status ${result.id}`));
  } catch (err) {
    process.stdout.write("\r");
    console.log(red(`  ${t.failed}: ${err instanceof Error ? err.message : String(err)}`));
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
    console.log(bold(`  ${t.commands}`));
    console.log(`  ${cyan("junto charge")} ${dim(t.chargeUsage)}`);
    console.log();
    for (const ex of t.chargeExamples) {
      console.log(`    ${ex}`);
    }
    console.log();
    process.exit(1);
  }

  const config = loadConfig();
  const { providers, guardrails, pickProvider } = bootstrap(config);
  if (providers.size === 0) noProviders();

  const amount = parseAmount(args[0]);
  const description = args.slice(1).join(" ") || undefined;

  console.log();
  process.stdout.write(dim(`  ${t.creatingCharge}`));

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
    console.log(green(`  ${t.chargeCreated}`));
    console.log();
    console.log(`  ${t.amount}:       ${bold(formatBRL(amount))}`);
    if (description) console.log(`  ${t.description}:  ${description}`);
    console.log(`  ${t.status}:       ${green(result.status)}`);
    console.log(`  ${t.id}:           ${dim(result.id)}`);

    if (result.payment_link) {
      console.log();
      console.log(`  ${bold(t.paymentLink)}`);
      console.log(`  ${cyan(result.payment_link)}`);
    }

    if (result.br_code) {
      console.log();
      console.log(`  ${bold(t.pixCopyPaste)}`);
      console.log(dim(`  ${result.br_code}`));
    }

    console.log();
    console.log(dim(`  ${t.checkStatus}: junto status ${result.id}`));
  } catch (err) {
    process.stdout.write("\r");
    console.log(red(`  ${t.failed}: ${err instanceof Error ? err.message : String(err)}`));
  }
  console.log();
}

async function cmdStatus(args: string[]) {
  const config = loadConfig();
  const { providers, pickProvider } = bootstrap(config);
  if (providers.size === 0) noProviders();

  if (args.length < 1) {
    console.log();
    console.log(bold(`  ${t.commands}`));
    console.log(`  ${cyan("junto status")} ${dim(t.statusUsage)}`);
    console.log();
    process.exit(1);
  }

  const id = args[0];

  console.log();
  process.stdout.write(dim(`  ${t.checking}`));

  try {
    const provider = pickProvider();
    const result = await provider.status(id);

    process.stdout.write("\r");
    const statusColor = result.status === "COMPLETED" ? green
      : result.status === "ACTIVE" ? yellow
      : result.status === "FAILED" ? red
      : dim;

    console.log(`  ${bold(t.status)}`);
    console.log();
    console.log(`  ${t.id}:           ${dim(result.id)}`);
    console.log(`  ${t.status}:       ${statusColor(result.status)}`);
    console.log(`  ${t.amount}:       ${formatBRL(result.amount)}`);
    console.log(`  ${t.provider}:     ${result.provider}`);
    console.log(`  ${t.updated}:      ${dim(result.timestamp)}`);
  } catch (err) {
    process.stdout.write("\r");
    console.log(red(`  ${t.failed}: ${err instanceof Error ? err.message : String(err)}`));
  }
  console.log();
}

async function cmdRefund(args: string[]) {
  const config = loadConfig();
  const { providers, pickProvider } = bootstrap(config);
  if (providers.size === 0) noProviders();

  if (args.length < 1) {
    console.log();
    console.log(bold(`  ${t.commands}`));
    console.log(`  ${cyan("junto refund")} ${dim(t.refundUsage)}`);
    console.log();
    process.exit(1);
  }

  const id = args[0];

  console.log();
  const ok = await confirm(`  ${t.refundConfirm} ${dim(id)}?`);
  if (!ok) {
    console.log(dim(`  ${t.cancelled}`));
    console.log();
    return;
  }

  process.stdout.write(dim(`  ${t.processingRefund}`));

  try {
    const provider = pickProvider();
    const result = await provider.refund(id);

    process.stdout.write("\r");
    console.log(green(`  ${t.refundSubmitted}`));
    console.log();
    console.log(`  ${t.id}:           ${dim(result.id)}`);
    console.log(`  ${t.status}:       ${result.status}`);
    console.log(`  ${t.refunded}:     ${formatBRL(result.refunded_amount)}`);
  } catch (err) {
    process.stdout.write("\r");
    console.log(red(`  ${t.failed}: ${err instanceof Error ? err.message : String(err)}`));
  }
  console.log();
}

async function cmdBalance() {
  const config = loadConfig();
  const { providers } = bootstrap(config);
  if (providers.size === 0) noProviders();

  console.log();
  console.log(bold(`  ${t.balanceTitle}`));
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
  console.log(bold(`  ${t.providersTitle}`));
  console.log();

  if (providers.size === 0) {
    console.log(dim(`  ${t.noneConfigured}`));
    console.log(`  ${t.addFirstProvider.replace("{cmd}", cyan("junto setup"))}`);
    console.log();
    return;
  }

  for (const [, p] of providers) {
    const info = p.info();
    console.log(`  ${green("●")} ${bold(info.name)}`);
    console.log(`    ${t.currencies}:  ${info.currencies.join(", ")}`);
    console.log(`    ${t.rails}:       ${info.rails.join(", ")}`);
    console.log(`    ${t.settlement}:  ${info.settlement}`);
    console.log();
  }
}

async function cmdLimits() {
  const config = loadConfig();
  const { guardrails } = bootstrap(config);

  const status = guardrails.getStatus();

  console.log();
  console.log(bold(`  ${t.limitsTitle}`));
  console.log();
  console.log(`  ${t.dailyLimit}:      ${bold(formatBRL(status.daily_limit))}`);
  console.log(`  ${t.spentToday}:      ${formatBRL(status.daily_spend)}`);
  console.log(`  ${t.remaining}:        ${green(formatBRL(status.daily_remaining))}`);
  console.log(`  ${t.perTxMax}:       ${formatBRL(status.per_tx_max)}`);
  console.log(`  ${t.confirmAbove}:    ${formatBRL(status.confirm_above)}`);
  console.log();
}

function showHelp() {
  console.log();
  console.log(bold("  Junto") + dim(` — ${t.tagline}`));
  console.log();
  console.log(bold(`  ${t.commands}`));
  console.log();
  console.log(`  ${cyan("junto setup")}                            ${t.helpSetup}`);
  console.log(`  ${cyan("junto pay")} ${dim("<amount> <destination>")}       ${t.helpPay}`);
  console.log(`  ${cyan("junto charge")} ${dim("<amount> [description]")}    ${t.helpCharge}`);
  console.log(`  ${cyan("junto status")} ${dim("<id>")}                      ${t.helpStatus}`);
  console.log(`  ${cyan("junto refund")} ${dim("<id>")}                      ${t.helpRefund}`);
  console.log(`  ${cyan("junto balance")}                           ${t.helpBalance}`);
  console.log(`  ${cyan("junto providers")}                         ${t.helpProviders}`);
  console.log(`  ${cyan("junto limits")}                            ${t.helpLimits}`);
  console.log();
  console.log(bold(`  ${t.options}`));
  console.log();
  console.log(`  ${dim("--mcp")}     ${t.helpMcp}`);
  console.log(`  ${dim("--help")}    ${t.helpHelp}`);
  console.log(`  ${dim("--version")} ${t.helpVersion}`);
  console.log();
  console.log(dim(`  ${t.configStored}`));
  console.log(dim(`  ${t.auditLog}`));
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
    case "pagar":
    case "enviar":
      return cmdPay(rest);
    case "charge":
    case "cobrar":
    case "cobranca":
      return cmdCharge(rest);
    case "status":
      return cmdStatus(rest);
    case "refund":
    case "reembolso":
    case "estorno":
      return cmdRefund(rest);
    case "balance":
    case "saldo":
      return cmdBalance();
    case "providers":
    case "provedores":
      return cmdProviders();
    case "limits":
    case "limites":
      return cmdLimits();
    case "--version":
    case "-v":
      console.log("junto-mcp v0.1.1");
      return;
    case "--help":
    case "-h":
    case "help":
    case "ajuda":
    default:
      showHelp();
      return;
  }
}
