# Ebanx Provider — Implementation Guide

> **Status:** Not yet implemented. Ebanx is next for outbound Pix payouts + LATAM coverage.
>
> Target file: `src/providers/ebanx.ts`
> Dependency: None — use native `fetch` (no SDK)
> Env vars: `EBANX_API_KEY`

---

## Overview

Ebanx is a Brazilian global payments processor. Adding it to junto-mcp solves the immediate gap: **outbound Pix payouts** (sending money to Pix keys), which Woovi doesn't currently support for our account. It also opens Boleto, cards, and cross-border LATAM payments.

### What it unlocks

| Capability | Woovi (current) | + Ebanx |
|---|---|---|
| Pix charges (inbound) | Supported | Supported |
| Pix payouts (outbound) | Blocked (account-level) | **Supported** |
| Boleto | Not supported | Supported |
| Credit/Debit cards | Not supported | Supported |
| Countries | Brazil only | Brazil + Mexico + Colombia + Argentina + Chile + Peru |
| Balance check | Supported | Supported |
| Refunds | Supported | Supported |
| Settlement | Instant (Pix) | Instant (Pix), T+1-2 (Boleto), T+2-7 (Cards) |

### Strategic fit

- **Woovi** = inbound Pix (charges, QR codes) — simple, instant, working
- **Ebanx** = outbound Pix (payouts) + cards + Boleto + LATAM — fills the gap
- Together they cover the full payment loop for Brazil

---

## 1. Authentication

Ebanx uses **Bearer token authentication**.

```
Authorization: Bearer {api_key}
```

Keys are issued in the Ebanx merchant dashboard. Separate sandbox and production keys.

**Environments:**

| Environment | Base URL |
|---|---|
| Sandbox | `https://sandbox-api.ebanx.com/v1` |
| Production | `https://api.ebanx.com/v1` |

---

## 2. Method Mapping

| junto method | Ebanx API call | Notes |
|---|---|---|
| `pay(req)` | `POST /payouts` | Pix payout to a key — **primary use case** |
| `charge(req)` | `POST /payments` | Create payment request |
| `status(id)` | `GET /payouts/{id}` or `GET /payments/{id}` | Check status |
| `refund(id)` | `POST /payments/{id}/refunds` | Refund a payment |
| `balance()` | `GET /balance` | Check account balance |
| `info()` | — | Static metadata |

---

## 3. Implementation Steps

### Step 1: Constructor and base request method

Same pattern as `woovi.ts` — native `fetch`, no SDK.

```typescript
import {
  PaymentProvider, PayRequest, PayResult,
  ChargeRequest, ChargeResult, StatusResult,
  RefundResult, BalanceResult, ProviderInfo,
  JuntoError, ProviderTimeout,
} from '../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class EbanxProvider implements PaymentProvider {
  name = 'ebanx';
  supportedCurrencies = ['BRL', 'MXN', 'COP', 'ARS', 'CLP', 'PEN'];
  supportedRails = ['pix', 'boleto', 'card'];
  settlementTime = 'instant (Pix), T+1-2 (Boleto), T+2-7 (Cards)';

  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config: {
    apiKey: string;
    environment?: 'sandbox' | 'production';
    timeoutMs?: number;
  }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.environment === 'production'
      ? 'https://api.ebanx.com/v1'
      : 'https://sandbox-api.ebanx.com/v1';
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new JuntoError(
          `Ebanx API error (${res.status}): ${errBody}`,
          `EBANX_HTTP_${res.status}`,
          'ebanx'
        );
      }

      return res.json();
    } catch (err) {
      if (err instanceof JuntoError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderTimeout('ebanx');
      }
      throw new JuntoError(
        `Ebanx request failed: ${err instanceof Error ? err.message : String(err)}`,
        'EBANX_REQUEST_FAILED',
        'ebanx'
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

### Step 2: `pay()` — Pix payout (outbound)

**This is the primary reason for adding Ebanx.**

Ebanx amounts are **decimal** (like Belvo), not cents (like Woovi/Stripe).

```typescript
private mapDestinationType(type?: string): string {
  const map: Record<string, string> = {
    EMAIL: 'email',
    PHONE: 'phone',
    CPF: 'cpf',
    CNPJ: 'cnpj',
    RANDOM: 'random_key',
    email: 'email',
    phone: 'phone',
    cpf: 'cpf',
    cnpj: 'cnpj',
  };
  return map[type ?? ''] ?? 'random_key';
}

async pay(req: PayRequest): Promise<PayResult> {
  const correlationID = req.correlation_id
    ?? `junto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const amountDecimal = (req.amount / 100).toFixed(2);

  const raw = await this.request('POST', '/payouts', {
    amount: parseFloat(amountDecimal),
    currency: req.currency ?? 'BRL',
    destination: {
      type: this.mapDestinationType(req.destination_type),
      value: req.destination,
    },
    description: req.note ?? 'Payment via Junto',
    reference_id: correlationID,
  }) as {
    id?: string;
    status?: string;
  };

  return {
    id: correlationID,
    status: this.mapPayoutStatus(raw.status),
    provider: this.name,
    amount: req.amount,
    currency: req.currency ?? 'BRL',
    destination: req.destination,
    timestamp: new Date().toISOString(),
    metadata: { ebanx_id: raw.id },
  };
}

private mapPayoutStatus(status?: string): PayResult['status'] {
  const map: Record<string, PayResult['status']> = {
    CREATED: 'CREATED',
    AUTHORIZED: 'APPROVED',
    PROCESSING: 'APPROVED',
    COMPLETED: 'COMPLETED',
    SUCCESS: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'FAILED',
  };
  return map[status ?? ''] ?? 'CREATED';
}
```

### Step 3: `charge()` — Create payment request

```typescript
async charge(req: ChargeRequest): Promise<ChargeResult> {
  const correlationID = req.correlation_id
    ?? `junto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const amountDecimal = (req.amount / 100).toFixed(2);

  const raw = await this.request('POST', '/payments', {
    amount: parseFloat(amountDecimal),
    currency: req.currency ?? 'BRL',
    description: req.description ?? 'Charge via Junto',
    reference_id: correlationID,
    ...(req.customer_email ? { customer: { email: req.customer_email, name: req.customer_name } } : {}),
    ...(req.expires_in ? { expires_in: req.expires_in } : {}),
  }) as {
    id?: string;
    status?: string;
    payment_url?: string;
  };

  return {
    id: correlationID,
    status: raw.status ?? 'ACTIVE',
    provider: this.name,
    amount: req.amount,
    currency: req.currency ?? 'BRL',
    payment_link: raw.payment_url,
    timestamp: new Date().toISOString(),
  };
}
```

### Step 4: `status()` — Check payout or payment status

```typescript
async status(id: string): Promise<StatusResult> {
  // Try payouts first, fall back to payments
  let raw: { id?: string; status?: string; amount?: number; currency?: string; created_at?: string };

  try {
    raw = await this.request('GET', `/payouts/${encodeURIComponent(id)}`) as typeof raw;
  } catch {
    raw = await this.request('GET', `/payments/${encodeURIComponent(id)}`) as typeof raw;
  }

  return {
    id,
    status: raw.status ?? 'UNKNOWN',
    provider: this.name,
    amount: raw.amount ? Math.round(raw.amount * 100) : 0,
    currency: (raw.currency ?? 'BRL').toUpperCase(),
    timestamp: raw.created_at ?? new Date().toISOString(),
  };
}
```

### Step 5: `refund()` — Refund a payment

```typescript
async refund(id: string): Promise<RefundResult> {
  const raw = await this.request('POST', `/payments/${encodeURIComponent(id)}/refunds`, {}) as {
    id?: string;
    status?: string;
    amount?: number;
  };

  return {
    id: raw.id ?? id,
    status: raw.status ?? 'CREATED',
    provider: this.name,
    refunded_amount: raw.amount ? Math.round(raw.amount * 100) : 0,
    timestamp: new Date().toISOString(),
  };
}
```

### Step 6: `balance()` — Check account balance

```typescript
async balance(): Promise<BalanceResult> {
  const raw = await this.request('GET', '/balance') as {
    balance?: number;
    currency?: string;
    available?: number;
  };

  const available = raw.available ?? raw.balance;
  if (available === undefined) {
    throw new JuntoError(
      'Could not read Ebanx balance',
      'EBANX_BALANCE_ERROR',
      'ebanx'
    );
  }

  return {
    provider: this.name,
    currency: (raw.currency ?? 'BRL').toUpperCase(),
    available: Math.round(available * 100), // decimal → cents
  };
}
```

### Step 7: `info()`

```typescript
info(): ProviderInfo {
  return {
    name: this.name,
    currencies: this.supportedCurrencies,
    rails: this.supportedRails,
    settlement: this.settlementTime,
    status: 'active',
  };
}
```

### Step 8: Wire up in `index.ts`

```typescript
import { EbanxProvider } from './providers/ebanx.js';

if (process.env.EBANX_API_KEY) {
  providers.set('ebanx', new EbanxProvider({
    apiKey: process.env.EBANX_API_KEY,
    environment: (process.env.EBANX_ENVIRONMENT as 'sandbox' | 'production') ?? 'sandbox',
    timeoutMs: parseInt(process.env.EBANX_TIMEOUT_MS ?? '30000', 10),
  }));
}
```

### Step 9: Update CLI setup

Add Ebanx to the `junto setup` flow and config.

---

## 4. Amount Conversion

| System | Format | Example for R$50.00 |
|---|---|---|
| junto (internal) | Integer cents | `5000` |
| Woovi API | Integer cents | `5000` |
| **Ebanx API** | **Decimal number** | `50.00` |
| Stripe API | Integer cents | `5000` |
| Belvo API | Decimal string | `"50.00"` |

```typescript
// junto cents → Ebanx decimal
function centsToDecimal(cents: number): number {
  return parseFloat((cents / 100).toFixed(2));
}

// Ebanx decimal → junto cents
function decimalToCents(decimal: number): number {
  return Math.round(decimal * 100);
}
```

---

## 5. Routing Logic

With Ebanx alongside Woovi:

| Scenario | Selected provider | Why |
|---|---|---|
| `junto charge 10.00 "Coffee"` | Woovi | First match for BRL, simpler QR code flow |
| `junto pay 25.00 maria@email.com` | Ebanx | Woovi can't do outbound Pix |
| `currency: "MXN"` | Ebanx | Only provider supporting Mexico |
| `provider: "ebanx"` | Ebanx (forced) | Explicit |

**Key routing change needed:** The router should prefer Ebanx for `pay()` when Woovi's outbound Pix is not available. This could be:
- Always route `pay()` to Ebanx for BRL (since Woovi handles charges)
- Add a `supportedOperations` field to the provider interface (`charge`, `pay`, `refund`)
- Or let the user force it with `--provider ebanx`

---

## 6. Supported Countries

| Country | Pix | Boleto | Cards | Bank Transfer |
|---|---|---|---|---|
| Brazil | Yes | Yes | Yes | Yes |
| Mexico | — | — | Yes | Yes (SPEI) |
| Colombia | — | — | Yes | Yes (PSE) |
| Argentina | — | — | Yes | — |
| Chile | — | — | Yes | Yes |
| Peru | — | — | Yes | — |
| Ecuador | — | — | Yes | — |

---

## 7. Testing Strategy

### Unit tests (`test/ebanx.test.ts`)

Mock `global.fetch` — same pattern as Woovi tests.

**Test cases:**
1. `pay()` — payout created, Pix key type mapped, amount converted
2. `pay()` — all destination types: EMAIL, CPF, PHONE, CNPJ, RANDOM
3. `charge()` — payment request created, URL returned
4. `status()` — tries payouts first, falls back to payments
5. `status()` — amount converted from decimal to cents
6. `refund()` — refund created
7. `balance()` — decimal converted to cents
8. Error handling — HTTP 401, 403, 429, timeout
9. `info()` — correct metadata
10. Amount conversion — cents ↔ decimal precision

### Live test (`test/live-ebanx.ts`)

```bash
EBANX_API_KEY=xxx npx tsx test/live-ebanx.ts pay 100 test@email.com EMAIL
EBANX_API_KEY=xxx npx tsx test/live-ebanx.ts charge 5000 "Test"
EBANX_API_KEY=xxx npx tsx test/live-ebanx.ts balance
```

Use sandbox environment for testing.

---

## 8. Env Variables

```env
EBANX_API_KEY=                  # Ebanx API key (Bearer token)
# EBANX_ENVIRONMENT=sandbox    # sandbox | production (default: sandbox)
# EBANX_TIMEOUT_MS=30000       # API timeout in ms (default: 30s)
```

---

## 9. Edge Cases & Gotchas

1. **Decimal amounts:** Ebanx uses decimal, junto uses cents. Always use `.toFixed(2)` to avoid floating-point errors.
2. **Pix key validation:** Ebanx validates Pix key format server-side. Invalid keys return `INVALID_DESTINATION`.
3. **Payout limits:** Ebanx may have per-transaction and daily limits on payouts. These stack with junto's own guardrails.
4. **Sandbox behavior:** Sandbox may not fully simulate Pix payouts. Test with small amounts in production.
5. **Status polling:** No webhook support in v0.1. Poll `status()` for payout confirmation.
6. **Rate limits:** 100-1000 req/min depending on account tier. Implement retry with backoff.

---

## Sources

- Ebanx Developer Docs: https://developers.ebanx.com
- Ebanx API Reference: https://docs.ebanx.com
- Ebanx Pix Documentation: https://developers.ebanx.com/pix
