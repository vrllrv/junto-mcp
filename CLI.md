# Junto CLI

> Send and receive money from your terminal.

Junto runs in two modes:
- **CLI mode** — human-friendly commands with colored output and confirmation prompts
- **MCP mode** — stdio server for AI clients (Claude, Cursor, etc.)

Mode is auto-detected. If you type a command like `junto pay`, it runs in CLI mode. If stdin is piped (by an AI client), it runs in MCP mode.

---

## Install

```bash
npm install -g junto-mcp
```

This gives you the `junto` command globally.

---

## Setup

```bash
junto setup
```

Prompts for your API key (input is masked with `****`). The key is saved to `~/.junto/config.json` so you don't need environment variables for every command.

```
  Junto Setup

  Configure your Woovi/OpenPix API key
  Get yours at https://app.woovi.com → API/Plugins → New API

  WOOVI_APP_ID: **********************
  > Saved to ~/.junto/config.json
```

Alternatively, set the environment variable directly:

```bash
# PowerShell
$env:WOOVI_APP_ID="your-key"

# Bash
export WOOVI_APP_ID="your-key"
```

---

## Commands

### `junto pay` — Send money

```bash
junto pay <amount> <destination> [options]
```

Amounts are in reais (not cents). Destination type is auto-detected.

```bash
junto pay 25.00 maria@email.com
junto pay 10 12345678900 --type CPF
junto pay 150.00 +5511999887766 --note "Rent"
```

Options:
- `--type EMAIL|CPF|PHONE|CNPJ|RANDOM` — override destination type detection
- `--note "memo"` — attach a payment memo

The CLI will show a summary and ask for confirmation before sending:

```
  Payment Summary

  Amount:       R$ 25.00
  To:           maria@email.com (EMAIL)
  Provider:     woovi

  Send this payment? [y/N] y

  Sent!

  Amount:       R$ 25.00
  To:           maria@email.com
  Provider:     woovi
  Status:       COMPLETED
  ID:           junto-1773573908677-4klmf7
  Time:         2026-03-15T11:25:09.568Z

  Check status: junto status junto-1773573908677-4klmf7
```

### `junto charge` — Create a payment request / QR code

```bash
junto charge <amount> [description]
```

```bash
junto charge 10.00 "Coffee"
junto charge 250
```

Returns a Pix QR code, payment link, and copy-paste code:

```
  Charge created!

  Amount:       R$ 10.00
  Description:  Coffee
  Status:       ACTIVE
  ID:           junto-1773573908677-x9y2z3

  Payment link:
  https://woovi.com/pay/f3c2b8c9-8122-43db-bbb2-9b4c01c00bf2

  Pix copy-paste:
  00020101021226810014br.gov.bcb.pix2559qr.woovi.com/...

  Check status: junto status junto-1773573908677-x9y2z3
```

### `junto status` — Check payment status

```bash
junto status <id>
```

```bash
junto status junto-1773573908677-4klmf7
```

```
  Status

  ID:           junto-1773573908677-4klmf7
  Status:       COMPLETED
  Amount:       R$ 25.00
  Provider:     woovi
  Updated:      2026-03-15T11:25:09.054Z
```

Status is color-coded: green for completed, yellow for active/pending, red for failed.

### `junto refund` — Refund a payment

```bash
junto refund <id>
```

```bash
junto refund junto-1773573908677-4klmf7
```

Asks for confirmation before processing.

### `junto balance` — Check available funds

```bash
junto balance
```

```
  Balance

  woovi:  R$ 150.00
```

Requires the `ACCOUNT_GET_LIST` scope on your Woovi API key.

### `junto providers` — List configured providers

```bash
junto providers
```

```
  Providers

  ● woovi
    Currencies:  BRL
    Rails:       pix
    Settlement:  instant
```

### `junto limits` — Show spending limits

```bash
junto limits
```

```
  Spending Limits

  Daily limit:      R$ 500.00
  Spent today:      R$ 25.00
  Remaining:        R$ 475.00
  Per-tx max:       R$ 200.00
  Confirm above:    R$ 50.00
```

---

## Guardrails

All guardrails apply in CLI mode, same as MCP mode:

| Setting | Default | Configure via |
|---|---|---|
| Daily limit | R$ 500.00 | `JUNTO_DAILY_LIMIT` (in cents) |
| Per-tx max | R$ 200.00 | `JUNTO_PER_TX_MAX` (in cents) |
| Confirm above | R$ 50.00 | `JUNTO_CONFIRM_ABOVE` (in cents) |

- Payments above the per-tx max are **blocked**
- Payments above the confirm threshold show a **confirmation prompt**
- Daily limit tracks total spend for the day

---

## MCP Server Mode

For AI clients (Claude Desktop, Cursor, etc.):

```bash
junto --mcp
```

Or configure in your MCP client:

```json
{
  "mcpServers": {
    "junto": {
      "command": "junto",
      "args": ["--mcp"],
      "env": {
        "WOOVI_APP_ID": "your-key"
      }
    }
  }
}
```

---

## Files

| Path | Description |
|---|---|
| `~/.junto/config.json` | Saved API keys and settings |
| `~/.junto/audit-YYYY-MM-DD.jsonl` | Transaction audit log |

---

## Quick Reference

```
junto setup                            Configure API keys
junto pay <amount> <destination>       Send money via Pix
junto charge <amount> [description]    Create a payment request / QR code
junto status <id>                      Check payment status
junto refund <id>                      Refund a payment
junto balance                          Check available funds
junto providers                        List configured providers
junto limits                           Show spending limits
junto --mcp                            Run as MCP server
junto --version                        Show version
junto --help                           Show help
```
