# Junto

> The payment protocol for people and agents.

Send and receive money through any AI assistant. Any payment rail. Built-in guardrails.

Named after [Benjamin Franklin's Junto](https://en.wikipedia.org/wiki/Junto_(club)) — a society of tradesmen who built civic infrastructure together. Different providers, same table, mutual benefit.

---

## Why

AI assistants are starting to move real money — paying invoices, splitting bills, sending transfers. But every payment provider has a different API, different auth, different settlement times. Nobody should have to teach their assistant how Pix works vs Stripe vs Wise.

Junto fixes that with one MCP server that:

- Exposes a **universal payment toolkit** to any MCP-compatible client (Claude, Cursor, custom agents)
- Routes to the **right provider** based on currency, country, and rail
- Enforces **spending limits** so agents can't go rogue
- Supports **human-in-the-loop** confirmation for high-value transactions
- Logs **every action** for audit and accountability

## Tools

| Tool | Description |
|---|---|
| `pay` | Send money to a destination (Pix key, email, IBAN, etc.) |
| `charge` | Create a payment request / invoice / QR code |
| `status` | Check payment status by correlation ID |
| `refund` | Reverse a completed transaction |
| `balance` | Check available funds on a provider |
| `providers` | List configured providers and their capabilities |
| `limits` | Show spending limits and today's usage |

## Quick Start

```bash
npm install -g junto-mcp
```

Set your provider API key:

```bash
export WOOVI_APP_ID="your-woovi-app-id"
```

Run:

```bash
junto-mcp
```

### Add to Claude Desktop or Cursor

```json
{
  "mcpServers": {
    "junto": {
      "command": "npx",
      "args": ["-y", "junto-mcp"],
      "env": {
        "WOOVI_APP_ID": "your-woovi-app-id"
      }
    }
  }
}
```

That's it. Your AI assistant now has payment tools.

## Guardrails

All amounts are in **cents** (smallest currency unit).

| Setting | Env Var | Default | Meaning |
|---|---|---|---|
| Daily limit | `JUNTO_DAILY_LIMIT` | 50000 (R$500) | Max total spend per day |
| Per-tx max | `JUNTO_PER_TX_MAX` | 20000 (R$200) | Max single transaction |
| Confirm above | `JUNTO_CONFIRM_ABOVE` | 5000 (R$50) | Ask human before sending |
| Allowed providers | `JUNTO_ALLOWED_PROVIDERS` | _(all)_ | Comma-separated allowlist |
| Allowed destinations | `JUNTO_ALLOWED_DESTINATIONS` | _(all)_ | Comma-separated type allowlist |

When an agent tries to send above the `JUNTO_CONFIRM_ABOVE` threshold, the server pauses and returns a confirmation prompt. The agent must relay this to the user and get approval before proceeding.

```
⚠️ Confirmation required

  Amount:      BRL 150.00
  To:          maria@email.com
  Reason:      Amount (15000 cents) exceeds confirmation threshold (5000 cents)

Please confirm with the user before proceeding.
```

## Architecture

```
┌─────────────────────────────────────┐
│  MCP Client (Claude, Cursor, etc.)  │
└──────────────┬──────────────────────┘
               │ MCP Protocol (stdio)
┌──────────────▼──────────────────────┐
│           junto-mcp                 │
│                                     │
│  ┌───────────┐  ┌────────────────┐  │
│  │  Router    │  │  Guardrails    │  │
│  │  (picks    │  │  (spend caps,  │  │
│  │  provider) │  │  HITL confirm, │  │
│  │           │  │  audit log)    │  │
│  └─────┬─────┘  └────────────────┘  │
│        │                            │
│  ┌─────▼─────────────────────────┐  │
│  │  Provider Adapters            │  │
│  │  ┌────────┐ ┌──────┐ ┌────┐  │  │
│  │  │ Woovi  │ │Stripe│ │Wise│  │  │
│  │  └────────┘ └──────┘ └────┘  │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  Audit Ledger (JSONL)         │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Providers

| Provider | Region | Rails | Status |
|---|---|---|---|
| **Woovi/OpenPix** | Brazil | Pix | 🟢 Live (tested with real Pix transactions) |
| **Ebanx** | Brazil + LATAM | Pix payouts, Boleto, Cards | 🟡 Next |
| **Belvo** | Brazil | Open Finance (all banks) | 🟡 Next |
| **Stripe** | Global | Cards, ACH, SEPA | 🟡 Next |
| **Wise** | Global | Bank transfers | 🔴 Planned |
| **Mercado Pago** | LATAM | Pix, Cards | 🔴 Planned |
| **PayPal** | Global | Email-based | 🔴 Planned |

### Why Woovi/Pix first?

- Pix settles **instantly** (perfect for demos and real use)
- Brazil's Central Bank mandates open APIs for payments
- 180M+ Pix users, 80B+ transactions in 2025
- Pix Automático (launched June 2025) enables recurring payments
- Low fees, no intermediaries
- **Verified:** charge, status, and payment flows tested with real Pix transactions (March 2026)

## Demo

```
You:   "Pay R$25 to maria@email.com via Pix"

Agent:  I'll send the following payment:
          Amount: R$ 25,00
          To: maria@email.com (Pix)
          Via: Woovi
        Shall I go ahead?

You:   "Yes"

Agent:  Done! Payment sent.
          Amount: R$ 25,00
          To: maria@email.com
          Via: Pix (Woovi)
          Status: Completed
          ID: junto-1739612345-a1b2c3
```

## Adding a Provider

Each provider is a single file implementing the `PaymentProvider` interface:

```typescript
// src/providers/your-provider.ts
import { PaymentProvider } from "../types.js";

export class YourProvider implements PaymentProvider {
  name = "your-provider";
  supportedCurrencies = ["USD"];
  supportedRails = ["card"];
  settlementTime = "1-3 days";

  async pay(req) { /* send money */ }
  async charge(req) { /* create invoice */ }
  async status(id) { /* check status */ }
  async refund(id) { /* reverse payment */ }
  async balance() { /* check funds */ }
  info() { /* return capabilities */ }
}
```

Copy `src/providers/_template.ts` to get started, then register your provider in `src/index.ts`.

## Testing

```bash
npm test              # Guardrail unit tests
npm run test:smoke    # Full flow smoke tests (mock provider)
```

### Live testing with real Pix

```bash
# Create a Pix charge (R$1.00)
WOOVI_APP_ID=your-key npx tsx test/live-pix.ts charge 100 "Test charge"

# Check status
WOOVI_APP_ID=your-key npx tsx test/live-pix.ts status <correlation-id>

# Send a Pix payment
WOOVI_APP_ID=your-key npx tsx test/live-pix.ts pay 100 user@email.com EMAIL

# Refund
WOOVI_APP_ID=your-key npx tsx test/live-pix.ts refund <correlation-id>
```

### Interactive demo

```bash
npx tsx demo/demo.ts          # Full demo with typewriter narration + real API calls
npx tsx demo/demo.ts --fast   # Fast mode for rehearsals
```

## Audit Log

Every transaction is logged to `~/.junto/audit-YYYY-MM-DD.jsonl`:

```json
{
  "timestamp": "2026-02-15T14:32:07Z",
  "type": "payment",
  "action": "pay",
  "tool": "pay",
  "amount": 2500,
  "currency": "BRL",
  "provider": "woovi",
  "destination": "maria@email.com",
  "status": "executed"
}
```

## Roadmap

- [x] Core MCP server with universal tool interface
- [x] Woovi/OpenPix provider (Pix) — **live-tested with real transactions**
- [x] Guardrails (daily limits, per-tx max, HITL confirmation)
- [x] Audit ledger
- [x] junto-skill (Claude behavioral layer)
- [x] Interactive demo (`npx tsx demo/demo.ts`)
- [ ] Ebanx provider (Pix payouts, Boleto, Cards — Brazil + LATAM)
- [ ] Belvo provider (Open Finance — all Brazilian banks)
- [ ] Stripe provider (Cards, ACH, SEPA)
- [ ] junto-approve (Telegram/WhatsApp confirmation for HITL)
- [ ] junto-dashboard (web UI for tx history and limits)
- [ ] junto-compute (agent-to-agent budget delegation)
- [ ] AP2 compatibility layer (Google Agent Payments Protocol)
- [ ] Wise provider (international bank transfers)

## Contributing

We need help with:

- **Provider adapters** — Ebanx, Stripe, Wise, Belvo, Mercado Pago, PayPal, UPI
- **Routing logic** — Cheapest vs fastest vs most reliable provider selection
- **HITL patterns** — Approval flows across different MCP clients
- **Security audit** — Review of the guardrails and auth system
- **Multi-currency** — FX handling, cross-border routing
- **Docs** — Compliance and regulatory guides per region

## License

MIT
