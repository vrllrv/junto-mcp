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
import QRCode from "qrcode";

import { PaymentProvider, JuntoError } from "./types.js";
import { WooviProvider } from "./providers/woovi.js";
import { Guardrails, DEFAULT_CONFIG } from "./guardrails.js";
import { t } from "./i18n.js";

// --- Theme ---
// Hex colors via ANSI 24-bit escape: \x1b[38;2;R;G;Bm
// Fallback-safe: modern terminals (Windows Terminal, iTerm2, etc.) all support this.

function hex(color: string): (s: string) => string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
}

function hexBg(color: string): (s: string) => string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return (s: string) => `\x1b[48;2;${r};${g};${b}m${s}\x1b[0m`;
}

// Brand palette
const primary = hex("#7C3AED");   // violet — brand identity
const success = hex("#10B981");   // emerald — completed, sent
const warning = hex("#F59E0B");   // amber — pending, confirm
const error = hex("#EF4444");     // red — failed, blocked
const accent = hex("#06B6D4");    // cyan — links, IDs, commands
const muted = hex("#6B7280");     // gray — secondary info
const money = hex("#10B981");     // emerald — amounts
const label = hex("#9CA3AF");     // light gray — field labels

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const boldPrimary = (s: string) => `\x1b[1m${primary(s)}`;
const boldMoney = (s: string) => `\x1b[1m${money(s)}`;

// Box drawing
const BOX = {
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  h: "─", v: "│",
  dot: "●", arrow: "→", check: "✓", cross: "✗", warn: "!",
};

// Status badge
function badge(text: string, color: (s: string) => string): string {
  return color(`${text}`);
}

// Shortcuts (keep old names working internally)
const green = success;
const yellow = warning;
const red = error;
const cyan = accent;

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
    console.error(`  ${error(BOX.cross)} ${t.invalidAmount}: "${input}"`);
    console.error(muted(`  ${t.amountExamples}`));
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
  console.log(`  ${error(BOX.cross)} ${t.noProviders}`);
  console.log(`    ${t.runSetup.replace("{cmd}", accent("junto setup"))}`);
  console.log();
  process.exit(1);
}

function divider(width = 48): string {
  return muted(BOX.h.repeat(width));
}

// --- Commands ---

async function cmdSetup() {
  console.log();
  console.log(`  ${primary(BOX.dot)} ${boldPrimary(t.setupTitle)}`);
  console.log(`  ${divider()}`);
  console.log();

  const config = loadConfig();

  const existing = config.WOOVI_APP_ID ? muted(` ${t.alreadyConfigured}`) : "";
  console.log(`  ${t.setupPrompt}${existing}`);
  console.log(muted(`  ${t.setupHint}`));
  console.log();

  const key = await askSecret(`  ${label("WOOVI_APP_ID:")} `);

  if (key) {
    config.WOOVI_APP_ID = key;
    saveConfig(config);
    console.log();
    console.log(`  ${success(BOX.check)} ${t.saved}`);
    console.log();
    console.log(muted(`  ${t.tryIt}`));
    console.log(`    ${accent("junto charge 1.00 \"Test charge\"")}`);
    console.log(`    ${accent("junto providers")}`);
    console.log(`    ${accent("junto limits")}`);
  } else {
    console.log(muted(`  ${t.skipped}`));
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
    console.log(`  ${error(BOX.cross)} ${bold(t.blocked)}`);
    console.log(`    ${muted(check.reason ?? "")}`);
    console.log();
    process.exit(1);
  }

  console.log();
  console.log(`  ${primary(BOX.dot)} ${boldPrimary(t.paymentSummary)}`);
  console.log(`  ${divider()}`);
  console.log();
  console.log(`  ${label(t.amount + ":")}       ${boldMoney(formatBRL(amount))}`);
  console.log(`  ${label(t.to + ":")}           ${bold(destination)} ${muted(`(${destType})`)}`);
  if (note) console.log(`  ${label(t.note + ":")}         ${note}`);
  console.log(`  ${label(t.provider + ":")}     ${pickProvider("BRL").name}`);
  console.log();

  if (check.needs_confirmation || amount > 100) {
    if (check.needs_confirmation) {
      console.log(`  ${warning(BOX.warn)} ${warning(check.reason ?? "")}`);
      console.log();
    }
    const ok = await confirm(`  ${t.sendConfirm}`);
    if (!ok) {
      console.log(muted(`  ${t.cancelled}`));
      console.log();
      return;
    }
  }

  console.log();
  process.stdout.write(muted(`  ${t.sending}`));

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
    console.log(`  ${success(BOX.check)} ${bold(t.sent)}`);
    console.log(`  ${divider()}`);
    console.log();
    console.log(`  ${label(t.amount + ":")}       ${boldMoney(formatBRL(amount))}`);
    console.log(`  ${label(t.to + ":")}           ${destination}`);
    console.log(`  ${label(t.provider + ":")}     ${result.provider}`);
    console.log(`  ${label(t.status + ":")}       ${success(result.status)}`);
    console.log(`  ${label(t.id + ":")}           ${accent(result.id)}`);
    console.log(`  ${label(t.time + ":")}         ${muted(result.timestamp)}`);
    console.log();
    console.log(muted(`  ${t.checkStatus}: ${accent(`junto status ${result.id}`)}`));
  } catch (err) {
    process.stdout.write("\r");
    console.log(`  ${error(BOX.cross)} ${t.failed}: ${err instanceof Error ? err.message : String(err)}`);
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
  process.stdout.write(muted(`  ${t.creatingCharge}`));

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
    console.log(`  ${success(BOX.check)} ${bold(t.chargeCreated)}`);
    console.log(`  ${divider()}`);
    console.log();
    console.log(`  ${label(t.amount + ":")}       ${boldMoney(formatBRL(amount))}`);
    if (description) console.log(`  ${label(t.description + ":")}  ${description}`);
    console.log(`  ${label(t.status + ":")}       ${success(result.status)}`);
    console.log(`  ${label(t.id + ":")}           ${accent(result.id)}`);

    if (result.br_code) {
      console.log();
      try {
        const qr = await QRCode.toString(result.br_code, {
          type: "utf8",
        } as QRCode.QRCodeToStringOptions);
        const lines = qr.split("\n").filter((l: string) => l.length > 0);
        for (const line of lines) {
          console.log(`    ${line}`);
        }
      } catch {
        // Fallback if QR generation fails
      }
    }

    if (result.payment_link) {
      console.log();
      console.log(`  ${primary(BOX.arrow)} ${bold(t.paymentLink)}`);
      console.log(`    ${accent(result.payment_link)}`);
    }

    if (result.br_code) {
      console.log();
      console.log(`  ${primary(BOX.arrow)} ${bold(t.pixCopyPaste)}`);
      console.log(muted(`    ${result.br_code}`));
    }

    console.log();
    console.log(muted(`  ${t.checkStatus}: ${accent(`junto status ${result.id}`)}`));
  } catch (err) {
    process.stdout.write("\r");
    console.log(`  ${error(BOX.cross)} ${t.failed}: ${err instanceof Error ? err.message : String(err)}`);
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
  process.stdout.write(muted(`  ${t.checking}`));

  try {
    const provider = pickProvider();
    const result = await provider.status(id);

    process.stdout.write("\r");
    const statusColor = result.status === "COMPLETED" ? success
      : result.status === "ACTIVE" ? warning
      : result.status === "FAILED" ? error
      : muted;
    const statusIcon = result.status === "COMPLETED" ? success(BOX.check)
      : result.status === "ACTIVE" ? warning(BOX.dot)
      : result.status === "FAILED" ? error(BOX.cross)
      : muted(BOX.dot);

    console.log(`  ${statusIcon} ${boldPrimary(t.status)}`);
    console.log(`  ${divider()}`);
    console.log();
    console.log(`  ${label(t.id + ":")}           ${accent(result.id)}`);
    console.log(`  ${label(t.status + ":")}       ${statusColor(result.status)}`);
    console.log(`  ${label(t.amount + ":")}       ${boldMoney(formatBRL(result.amount))}`);
    console.log(`  ${label(t.provider + ":")}     ${result.provider}`);
    console.log(`  ${label(t.updated + ":")}      ${muted(result.timestamp)}`);
  } catch (err) {
    process.stdout.write("\r");
    console.log(`  ${error(BOX.cross)} ${t.failed}: ${err instanceof Error ? err.message : String(err)}`);
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
  const ok = await confirm(`  ${t.refundConfirm} ${accent(id)}?`);
  if (!ok) {
    console.log(muted(`  ${t.cancelled}`));
    console.log();
    return;
  }

  process.stdout.write(muted(`  ${t.processingRefund}`));

  try {
    const provider = pickProvider();
    const result = await provider.refund(id);

    process.stdout.write("\r");
    console.log(`  ${success(BOX.check)} ${bold(t.refundSubmitted)}`);
    console.log(`  ${divider()}`);
    console.log();
    console.log(`  ${label(t.id + ":")}           ${accent(result.id)}`);
    console.log(`  ${label(t.status + ":")}       ${success(result.status)}`);
    console.log(`  ${label(t.refunded + ":")}     ${boldMoney(formatBRL(result.refunded_amount))}`);
  } catch (err) {
    process.stdout.write("\r");
    console.log(`  ${error(BOX.cross)} ${t.failed}: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();
}

async function cmdBalance() {
  const config = loadConfig();
  const { providers } = bootstrap(config);
  if (providers.size === 0) noProviders();

  console.log();
  console.log(`  ${primary(BOX.dot)} ${boldPrimary(t.balanceTitle)}`);
  console.log(`  ${divider()}`);
  console.log();

  for (const [, p] of providers) {
    try {
      const result = await p.balance();
      console.log(`  ${success(BOX.dot)} ${label(p.name + ":")}  ${boldMoney(formatBRL(result.available))}`);
    } catch (err) {
      console.log(`  ${muted(BOX.dot)} ${label(p.name + ":")}  ${muted(err instanceof Error ? err.message : "unavailable")}`);
    }
  }
  console.log();
}

async function cmdProviders() {
  const config = loadConfig();
  const { providers } = bootstrap(config);

  console.log();
  console.log(`  ${primary(BOX.dot)} ${boldPrimary(t.providersTitle)}`);
  console.log(`  ${divider()}`);
  console.log();

  if (providers.size === 0) {
    console.log(muted(`  ${t.noneConfigured}`));
    console.log(`  ${t.addFirstProvider.replace("{cmd}", accent("junto setup"))}`);
    console.log();
    return;
  }

  for (const [, p] of providers) {
    const info = p.info();
    console.log(`  ${success(BOX.dot)} ${bold(info.name)}`);
    console.log(`    ${label(t.currencies + ":")}  ${info.currencies.join(", ")}`);
    console.log(`    ${label(t.rails + ":")}       ${info.rails.join(", ")}`);
    console.log(`    ${label(t.settlement + ":")}  ${info.settlement}`);
    console.log();
  }
}

async function cmdLimits() {
  const config = loadConfig();
  const { guardrails } = bootstrap(config);

  const status = guardrails.getStatus();

  // Simple progress bar
  const pct = status.daily_limit > 0
    ? Math.min(1, status.daily_spend / status.daily_limit)
    : 0;
  const barWidth = 24;
  const filled = Math.round(pct * barWidth);
  const barColor = pct > 0.9 ? error : pct > 0.7 ? warning : success;
  const bar = barColor("█".repeat(filled)) + muted("░".repeat(barWidth - filled));

  console.log();
  console.log(`  ${primary(BOX.dot)} ${boldPrimary(t.limitsTitle)}`);
  console.log(`  ${divider()}`);
  console.log();
  console.log(`  ${label(t.dailyLimit + ":")}      ${bold(formatBRL(status.daily_limit))}`);
  console.log(`  ${label(t.spentToday + ":")}      ${formatBRL(status.daily_spend)}`);
  console.log(`  ${label(t.remaining + ":")}        ${boldMoney(formatBRL(status.daily_remaining))}`);
  console.log();
  console.log(`  ${bar} ${muted(`${Math.round(pct * 100)}%`)}`);
  console.log();
  console.log(`  ${label(t.perTxMax + ":")}       ${formatBRL(status.per_tx_max)}`);
  console.log(`  ${label(t.confirmAbove + ":")}    ${formatBRL(status.confirm_above)}`);
  console.log();
}

function pad(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}

function showHelp() {
  console.log();
  console.log(primary("       _             _        "));
  console.log(primary("      | |_   _ _ __ | |_ ___  "));
  console.log(primary("   _  | | | | | '_ \\| __/ _ \\ "));
  console.log(primary("  | |_| | |_| | | | | || (_) |"));
  console.log(primary("   \\___/ \\__,_|_| |_|\\__\\___/ "));
  console.log();
  console.log(muted(`  ${t.tagline}`));
  console.log();
  console.log(`  ${divider()}`);
  console.log();
  console.log(bold(`  ${t.commands}`));
  console.log();

  const cmds = [
    { cmd: t.cmdSetup, args: "", desc: t.helpSetup },
    { cmd: t.cmdPay, args: t.cmdPayUsageShort, desc: t.helpPay },
    { cmd: t.cmdCharge, args: t.cmdChargeUsageShort, desc: t.helpCharge },
    { cmd: t.cmdStatus, args: "<id>", desc: t.helpStatus },
    { cmd: t.cmdRefund, args: "<id>", desc: t.helpRefund },
    { cmd: t.cmdBalance, args: "", desc: t.helpBalance },
    { cmd: t.cmdProviders, args: "", desc: t.helpProviders },
    { cmd: t.cmdLimits, args: "", desc: t.helpLimits },
  ];

  for (const { cmd, args, desc } of cmds) {
    const left = args ? `${cmd} ${args}` : cmd;
    console.log(`  ${accent(cmd)}${args ? " " + muted(args) : ""}${" ".repeat(Math.max(1, 40 - left.length))}${desc}`);
  }

  console.log();
  console.log(bold(`  ${t.options}`));
  console.log();
  console.log(`  ${muted("--mcp")}     ${t.helpMcp}`);
  console.log(`  ${muted("--help")}    ${t.helpHelp}`);
  console.log(`  ${muted("--version")} ${t.helpVersion}`);
  console.log();
  console.log(muted(`  ${t.configStored}`));
  console.log(muted(`  ${t.auditLog}`));
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
