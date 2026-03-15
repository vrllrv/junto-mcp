#!/usr/bin/env node
// src/index.ts
// junto-mcp — The payment protocol for people and agents.
//
// Modes:
//   junto pay 25.00 maria@email.com   ← Human CLI
//   junto charge 10.00 "Coffee"       ← Human CLI
//   junto --mcp                       ← MCP server (for AI clients)
//   junto                             ← Shows help
//
// Auto-detect: if a known CLI command is passed, run CLI mode.
// If --mcp is passed or stdin is piped, run MCP server mode.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { PaymentProvider, JuntoError } from "./types.js";
import { WooviProvider } from "./providers/woovi.js";
import { Guardrails, DEFAULT_CONFIG } from "./guardrails.js";
import { runCLI } from "./cli.js";

// --- Mode detection ---
// CLI commands that trigger human mode
const CLI_COMMANDS = new Set([
  "pay", "charge", "status", "refund", "balance",
  "providers", "limits", "setup", "help",
  "--help", "-h", "--version", "-v",
  // pt-BR aliases
  "pagar", "enviar", "cobrar", "cobranca", "reembolso", "estorno",
  "saldo", "provedores", "limites", "ajuda",
]);

const userArgs = process.argv.slice(2);
const firstArg = userArgs[0]?.toLowerCase();
const isMCP = firstArg === "--mcp" || (!process.stdin.isTTY && !firstArg);
const isCLI = CLI_COMMANDS.has(firstArg ?? "") || (process.stdin.isTTY && !firstArg);

if (isCLI) {
  runCLI(userArgs).catch((err) => {
    console.error("\nError:", err.message ?? err);
    process.exit(1);
  });
} else if (!isMCP) {
  // Unknown arg — show help
  runCLI(["help"]).catch(() => process.exit(1));
} else {
// --- MCP Server Mode ---

// --- Bootstrap providers from env ---

const providers: Map<string, PaymentProvider> = new Map();

if (process.env.WOOVI_APP_ID) {
  providers.set("woovi", new WooviProvider(
    process.env.WOOVI_APP_ID,
    parseInt(process.env.WOOVI_TIMEOUT_MS ?? "15000", 10)
  ));
}

// Future providers:
// if (process.env.STRIPE_SECRET_KEY) { providers.set("stripe", new StripeProvider(...)); }
// if (process.env.WISE_API_TOKEN) { providers.set("wise", new WiseProvider(...)); }
// if (process.env.BELVO_SECRET) { providers.set("belvo", new BelvoProvider(...)); }

if (providers.size === 0) {
  console.error(
    "[junto] No providers configured. Set at least one API key:\n" +
      "  WOOVI_APP_ID      — Pix payments (Brazil)\n" +
      "  STRIPE_SECRET_KEY  — Cards, ACH, SEPA (Global)  [coming soon]\n" +
      "  WISE_API_TOKEN     — Bank transfers (Global)     [coming soon]"
  );
  process.exit(1);
}

// --- Guardrails ---

const guardrails = new Guardrails({
  daily_max: parseInt(
    process.env.JUNTO_DAILY_LIMIT ?? String(DEFAULT_CONFIG.daily_max),
    10
  ),
  per_tx_max: parseInt(
    process.env.JUNTO_PER_TX_MAX ?? String(DEFAULT_CONFIG.per_tx_max),
    10
  ),
  confirm_above: parseInt(
    process.env.JUNTO_CONFIRM_ABOVE ?? String(DEFAULT_CONFIG.confirm_above),
    10
  ),
  allowed_providers:
    process.env.JUNTO_ALLOWED_PROVIDERS?.split(",").filter(Boolean) ?? [],
  allowed_destination_types:
    process.env.JUNTO_ALLOWED_DESTINATIONS?.split(",").filter(Boolean) ?? [],
});

// --- Router: pick best provider for a request ---

function pickProvider(
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

  // Auto-route: first provider matching currency/rail
  // v0.1.0: first-match routing. Future: cost, speed, reliability scoring.
  for (const [, p] of providers) {
    if (currency && !p.supportedCurrencies.includes(currency)) continue;
    if (rail && !p.supportedRails.includes(rail)) continue;
    return p;
  }

  throw new JuntoError(
    `No provider for currency=${currency ?? "any"}, rail=${rail ?? "any"}. Configured: ${Array.from(providers.keys()).join(", ")}`,
    "NO_PROVIDER_MATCH"
  );
}

// --- Helpers ---

function formatError(err: unknown): string {
  if (err instanceof JuntoError) return `[${err.code}] ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}

// --- Schemas (extracted to avoid TS2589 deep type instantiation) ---

const PaySchema = z.object({
  amount: z.number().positive().describe("Amount in cents. Example: 5000 = R$50.00"),
  currency: z.string().default("BRL").describe("ISO 4217 currency code"),
  destination: z.string().describe("Recipient: Pix key, email, phone, CPF, CNPJ, IBAN"),
  destination_type: z.string().optional().describe("Type hint: EMAIL, PHONE, CPF, CNPJ, RANDOM, IBAN"),
  note: z.string().optional().describe("Payment memo"),
  provider: z.string().optional().describe("Force a specific provider"),
});

const ChargeSchema = z.object({
  amount: z.number().positive().describe("Amount in cents"),
  currency: z.string().default("BRL").describe("ISO 4217 currency code"),
  description: z.string().optional().describe("What the charge is for"),
  customer_email: z.string().optional().describe("Customer email"),
  customer_name: z.string().optional().describe("Customer name"),
  expires_in: z.number().optional().describe("Seconds until expiry"),
  provider: z.string().optional().describe("Force a specific provider"),
});

const StatusSchema = z.object({
  id: z.string().describe("Payment or charge correlation ID"),
  provider: z.string().optional().describe("Provider that handled the transaction"),
});

const RefundSchema = z.object({
  id: z.string().describe("Correlation ID of the payment to refund"),
  provider: z.string().optional().describe("Provider that handled the transaction"),
});

const BalanceSchema = z.object({
  provider: z.string().optional().describe("Which provider to check. Checks all if omitted."),
});

// --- MCP Server ---

const server = new McpServer({
  name: "junto-mcp",
  version: "0.1.0",
});

// Tool: pay
server.tool(
  "pay",
  "Send money to a destination via the best available provider. Amount in cents.",
  PaySchema.shape,
  async (params) => {
    const check = guardrails.checkPay(params);

    if (!check.allowed) {
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "pay",
        tool: "pay",
        amount: params.amount,
        currency: params.currency,
        destination: params.destination,
        status: "blocked",
        reason: check.reason,
      });
      return textResult(`Payment blocked: ${check.reason}`);
    }

    // Note: recordSpend is NOT called here because no money moves yet.
    // Spend is recorded when the user confirms and pay is called again,
    // reaching the try block below which calls recordSpend().
    if (check.needs_confirmation) {
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "pay",
        tool: "pay",
        amount: params.amount,
        currency: params.currency,
        destination: params.destination,
        status: "pending_confirmation",
        reason: check.reason,
      });

      const formatted = (params.amount / 100).toFixed(2);
      return textResult(
        `Confirmation required\n\n` +
          `  Amount:  ${params.currency} ${formatted}\n` +
          `  To:      ${params.destination}\n` +
          `  Reason:  ${check.reason}\n\n` +
          `Please confirm with the user before proceeding. ` +
          `Call pay again with the same parameters after approval.`
      );
    }

    try {
      const provider = pickProvider(params.currency, undefined, params.provider);
      const result = await provider.pay(params);

      guardrails.recordSpend(params.amount);
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "pay",
        tool: "pay",
        amount: params.amount,
        currency: params.currency,
        provider: provider.name,
        destination: params.destination,
        status: "executed",
      });

      return jsonResult({
        success: true,
        message: `Sent ${params.currency} ${(params.amount / 100).toFixed(2)} to ${params.destination} via ${provider.name}`,
        ...result,
      });
    } catch (err) {
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "pay",
        tool: "pay",
        amount: params.amount,
        currency: params.currency,
        destination: params.destination,
        status: "failed",
        reason: formatError(err),
      });

      return textResult(`Payment failed: ${formatError(err)}`);
    }
  }
);

// Tool: charge
server.tool(
  "charge",
  "Create a payment request, invoice, or QR code.",
  ChargeSchema.shape,
  async (params) => {
    try {
      const provider = pickProvider(params.currency, undefined, params.provider);
      const result = await provider.charge(params);

      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "charge",
        tool: "charge",
        amount: params.amount,
        currency: params.currency,
        provider: provider.name,
        status: "executed",
      });

      return jsonResult(result);
    } catch (err) {
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "charge",
        tool: "charge",
        amount: params.amount,
        currency: params.currency,
        status: "failed",
        reason: formatError(err),
      });
      return textResult(`Charge failed: ${formatError(err)}`);
    }
  }
);

// Tool: status
server.tool(
  "status",
  "Check payment or charge status by correlation ID.",
  StatusSchema.shape,
  async (params) => {
    try {
      const provider = pickProvider(undefined, undefined, params.provider);
      const result = await provider.status(params.id);
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "status",
        tool: "status",
        provider: provider.name,
        status: "executed",
      });
      return jsonResult(result);
    } catch (err) {
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "status",
        tool: "status",
        status: "failed",
        reason: formatError(err),
      });
      return textResult(`Status check failed: ${formatError(err)}`);
    }
  }
);

// Tool: refund
server.tool(
  "refund",
  "Refund a completed payment by correlation ID.",
  RefundSchema.shape,
  async (params) => {
    try {
      const provider = pickProvider(undefined, undefined, params.provider);
      const result = await provider.refund(params.id);

      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "refund",
        tool: "refund",
        provider: provider.name,
        status: "executed",
      });

      return jsonResult(result);
    } catch (err) {
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "refund",
        tool: "refund",
        status: "failed",
        reason: formatError(err),
      });
      return textResult(`Refund failed: ${formatError(err)}`);
    }
  }
);

// Tool: balance
server.tool(
  "balance",
  "Check available funds on a payment provider.",
  BalanceSchema.shape,
  async (params) => {
    try {
      if (params.provider) {
        const provider = pickProvider(undefined, undefined, params.provider);
        const result = await provider.balance();
        return jsonResult(result);
      }

      const results = [];
      for (const [, p] of providers) {
        try {
          results.push(await p.balance());
        } catch (err) {
          results.push({
            provider: p.name,
            currency: p.supportedCurrencies[0] ?? "?",
            available: -1,
            error: formatError(err),
          });
        }
      }
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "balance",
        tool: "balance",
        status: "executed",
      });
      return jsonResult(results);
    } catch (err) {
      guardrails.audit({
        timestamp: new Date().toISOString(),
        type: "payment",
        action: "balance",
        tool: "balance",
        status: "failed",
        reason: formatError(err),
      });
      return textResult(`Balance check failed: ${formatError(err)}`);
    }
  }
);

// Tool: providers
server.tool(
  "providers",
  "List configured payment providers and their capabilities.",
  {},
  async () => {
    const list = Array.from(providers.values()).map((p) => p.info());
    return jsonResult(list);
  }
);

// Tool: limits
server.tool(
  "limits",
  "Check current spending limits and today's usage (all values in cents).",
  {},
  async () => {
    return jsonResult(guardrails.getStatus());
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[junto] Running | providers: ${Array.from(providers.keys()).join(", ")} | daily limit: ${guardrails.getStatus().daily_limit} cents`
  );
}

main().catch((err) => {
  console.error("[junto] Fatal:", err);
  process.exit(1);
});
} // end MCP server mode
