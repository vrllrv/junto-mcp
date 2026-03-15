# Belvo Provider — Implementation Guide

> **Status:** Not yet implemented. Woovi/Pix is live and tested. Belvo is next for Open Finance coverage.
>
> Target file: `src/providers/belvo.ts`
> Dependency: None — use native `fetch` (no SDK)
> Env vars: `BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`

---

## Overview

Belvo is the Open Finance provider for junto-mcp. It enables Pix via Open Finance Payment Initiation (OFPI) in Brazil — meaning users can pay from **any bank account** directly, without needing the merchant to have a Woovi/OpenPix account. It also opens the door to Mexico (SPEI) and Colombia (PSE).

### What it unlocks

| Capability | Woovi (current) | + Belvo |
|---|---|---|
| Pix initiation | Via Woovi merchant account | Via any bank (Open Finance) |
| User bank choice | Fixed to merchant's acquirer | User picks their bank at checkout |
| Balance reads | Not supported | Read user's bank balance via Open Finance |
| Countries | Brazil only | Brazil + Mexico + Colombia |
| Refunds | Supported | Not supported (limitation) |
| Settlement | Instant | Instant (Pix OFPI is real-time) |

### Key difference from Woovi

Woovi is a payment gateway — you create charges and users pay via QR code. Belvo is Open Finance infrastructure — you initiate payments directly from the user's bank account with their consent. This is more powerful but requires a redirect flow (user must authorize at their bank).

---

## 1. Authentication

Belvo uses **HTTP Basic Auth** on every request.

```
Authorization: Basic BASE64(secretId:secretPassword)
```

Two separate credential sets exist:
- **Aggregation API keys** — for reading bank data (balances, transactions)
- **Payments API keys** — for payment initiation

Both are generated in the Belvo Dashboard under Developers > API Keys.

**Environments:**

| Environment | Base URL |
|---|---|
| Sandbox | `https://sandbox.belvo.com` |
| Production | `https://api.belvo.com` |

Aggregation lives under `/api/`, Payments Brazil under `/payments/br/`.

**Required header on ALL payments calls:**

```
X-Belvo-API-Resource-Version: Payments-BR.V2
```

---

## 2. Architecture: Why Belvo is Different

Belvo's payment flow is **asynchronous and redirect-based**. Unlike Woovi (create charge → get QR code → done), Belvo requires:

1. Pre-register a **Customer** (the payer)
2. Pre-register the **merchant's bank account** (one-time setup)
3. Create a **Payment Intent** → get a `redirect_url`
4. User opens `redirect_url` → authenticates at their bank → authorizes the Pix
5. User redirects back to your `callback_url`
6. Belvo sends a webhook: `PAYMENT_INTENTS STATUS_UPDATE` → `SUCCEEDED`

This means:
- `pay()` returns `status: "CREATED"` with a `redirect_url` in metadata
- Final confirmation comes asynchronously via webhook (v0.2.0 feature)
- For v0.1.0, the agent can poll `status()` after the user confirms

---

## 3. Prerequisites (One-Time Setup)

Before the adapter can create payments, these must exist in Belvo:

### 3.1 Merchant bank account

```
POST /payments/br/bank-accounts/
{
  "type": "business",
  "holder_name": "Your Company Ltda",
  "holder_document": "12345678000190",
  "document_type": "CNPJ",
  "bank_code": "341",
  "account_number": "12345-6",
  "branch_number": "1234"
}
```

Returns a UUID — store as `BELVO_BENEFICIARY_ACCOUNT_ID` env var.

### 3.2 Payer institution list

```
GET /payments/br/institutions/
```

Returns all supported banks. The adapter needs to either:
- Accept `payer_institution` in the request (agent provides it)
- Auto-detect from user's Pix key (not currently possible via API)

---

## 4. Method Mapping

| junto method | Belvo API call | Notes |
|---|---|---|
| `pay(req)` | `POST /payments/br/payment-intents/` | Returns `redirect_url`; async |
| `charge(req)` | `POST /payments/br/payment-links/` | Returns hosted payment URL |
| `status(id)` | `GET /payments/br/payment-intents/{id}/` | Poll for final status |
| `refund(id)` | N/A | Throw `JuntoError("REFUND_NOT_SUPPORTED")` |
| `balance()` | `GET /api/accounts/?link={linkId}` | Requires aggregation link |
| `info()` | — | Static metadata |

---

## 5. Implementation Steps

### Step 1: Constructor and base request method

No npm SDK needed — use native `fetch` (same pattern as `woovi.ts`).

```typescript
import {
  PaymentProvider, PayRequest, PayResult,
  ChargeRequest, ChargeResult, StatusResult,
  RefundResult, BalanceResult, ProviderInfo,
  JuntoError, ProviderTimeout,
} from '../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class BelvoProvider implements PaymentProvider {
  name = 'belvo';
  supportedCurrencies = ['BRL'];
  supportedRails = ['pix', 'open_finance'];
  settlementTime = 'instant';

  private secretId: string;
  private secretPassword: string;
  private paymentsBase: string;
  private aggregationBase: string;
  private beneficiaryAccountId: string;
  private callbackUrl: string;
  private aggregationLinkId?: string;
  private timeoutMs: number;

  constructor(config: {
    secretId: string;
    secretPassword: string;
    environment?: 'sandbox' | 'production';
    beneficiaryAccountId: string;
    callbackUrl?: string;
    aggregationLinkId?: string;
    timeoutMs?: number;
  }) {
    this.secretId = config.secretId;
    this.secretPassword = config.secretPassword;
    this.beneficiaryAccountId = config.beneficiaryAccountId;
    this.callbackUrl = config.callbackUrl ?? 'https://junto.app/payment/complete';
    this.aggregationLinkId = config.aggregationLinkId;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const base = config.environment === 'sandbox'
      ? 'https://sandbox.belvo.com'
      : 'https://api.belvo.com';
    this.paymentsBase = `${base}/payments/br`;
    this.aggregationBase = `${base}/api`;
  }

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.secretId}:${this.secretPassword}`).toString('base64')}`;
  }

  private async request(
    method: string,
    url: string,
    body?: unknown,
    isPayments = true
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Payments API requires version header
    if (isPayments) {
      headers['X-Belvo-API-Resource-Version'] = 'Payments-BR.V2';
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new JuntoError(
          `Belvo API error (${res.status}): ${errBody}`,
          `BELVO_HTTP_${res.status}`,
          'belvo'
        );
      }

      return res.json();
    } catch (err) {
      if (err instanceof JuntoError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderTimeout('belvo');
      }
      throw new JuntoError(
        `Belvo request failed: ${err instanceof Error ? err.message : String(err)}`,
        'BELVO_REQUEST_FAILED',
        'belvo'
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

### Step 2: `pay()` — Create Payment Intent

**Critical difference:** Belvo amounts are decimal strings (`"100.00"`), not integer cents.

```typescript
async pay(req: PayRequest): Promise<PayResult> {
  const correlationID = req.correlation_id
    ?? `junto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Convert cents to decimal string
  const amountStr = (req.amount / 100).toFixed(2);

  // Step 1: Auto-create customer (simple mode)
  const customer = await this.request(
    'POST',
    `${this.paymentsBase}/customers/`,
    {
      customer_type: 'INDIVIDUAL',
      name: req.note ?? 'Junto Customer',
      country: 'BR',
    }
  ) as { id: string };

  // Step 2: Create Payment Intent
  const intent = await this.request(
    'POST',
    `${this.paymentsBase}/payment-intents/`,
    {
      amount: amountStr,
      description: req.note ?? 'Payment via Junto',
      allowed_payment_method_types: ['open_finance'],
      external_id: correlationID,
      confirm: true,
      payment_method_details: {
        open_finance: {
          beneficiary_bank_account: this.beneficiaryAccountId,
          callback_url: this.callbackUrl,
          // payer_institution can be passed via destination if known
        },
      },
      customer: customer.id,
    }
  ) as {
    id: string;
    status: string;
    payment_method_information?: {
      open_finance?: { redirect_url?: string };
    };
  };

  return {
    id: correlationID,
    status: mapBelvoStatus(intent.status),
    provider: this.name,
    amount: req.amount,
    currency: 'BRL',
    destination: req.destination,
    timestamp: new Date().toISOString(),
    metadata: {
      belvo_intent_id: intent.id,
      redirect_url: intent.payment_method_information?.open_finance?.redirect_url,
    },
  };
}
```

**Status mapping:**

| Belvo `status` | junto `PayResult.status` |
|---|---|
| `CREATED` | `CREATED` |
| `AUTHORIZED` | `APPROVED` |
| `SUCCEEDED` | `COMPLETED` |
| `FAILED` | `FAILED` |

**The agent must tell the user to open `metadata.redirect_url`** to authorize the payment at their bank. This is a fundamental UX difference from Woovi.

### Step 3: `charge()` — Create Payment Link

Belvo has a hosted payment link product — simpler than raw Payment Intents because Belvo handles the full UI.

```typescript
async charge(req: ChargeRequest): Promise<ChargeResult> {
  const correlationID = req.correlation_id
    ?? `junto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const amountStr = (req.amount / 100).toFixed(2);

  const link = await this.request(
    'POST',
    `${this.paymentsBase}/payment-links/`,
    {
      amount: amountStr,
      currency: 'BRL',
      description: req.description ?? 'Charge via Junto',
      beneficiary_bank_account: this.beneficiaryAccountId,
      callback_urls: {
        success: this.callbackUrl,
        cancel: this.callbackUrl,
      },
      ...(req.expires_in ? { expires_in: req.expires_in } : {}),
    }
  ) as {
    id: string;
    payment_url: string;
    status: string;
  };

  return {
    id: correlationID,
    status: link.status ?? 'ACTIVE',
    provider: this.name,
    amount: req.amount,
    currency: 'BRL',
    payment_link: link.payment_url,
    timestamp: new Date().toISOString(),
  };
}
```

### Step 4: `status()` — Check Payment Intent

```typescript
async status(id: string): Promise<StatusResult> {
  // id could be a Belvo UUID or a junto correlation ID
  // If it's a junto correlation ID, we'd need a local mapping (v0.2.0)
  // For now, assume it's the Belvo payment intent UUID

  const intent = await this.request(
    'GET',
    `${this.paymentsBase}/payment-intents/${encodeURIComponent(id)}/`
  ) as {
    id: string;
    status: string;
    amount: string;
    currency: string;
    created_at: string;
  };

  return {
    id,
    status: intent.status ?? 'UNKNOWN',
    provider: this.name,
    amount: Math.round(parseFloat(intent.amount) * 100), // decimal -> cents
    currency: (intent.currency ?? 'BRL').toUpperCase(),
    timestamp: intent.created_at ?? new Date().toISOString(),
  };
}
```

### Step 5: `refund()` — Not supported

```typescript
async refund(id: string): Promise<RefundResult> {
  throw new JuntoError(
    'Refunds not available via Belvo Open Finance. Initiate a reverse Pix manually.',
    'REFUND_NOT_SUPPORTED',
    'belvo'
  );
}
```

This is a limitation of the Brazilian Open Finance / OFPI model. Refunds must be done as new outbound Pix transfers from the merchant's bank, not through Belvo's API.

### Step 6: `balance()` — Via Aggregation API

Requires a pre-configured aggregation Link (different from payments).

```typescript
async balance(): Promise<BalanceResult> {
  if (!this.aggregationLinkId) {
    throw new JuntoError(
      'Balance check requires BELVO_AGGREGATION_LINK_ID',
      'BALANCE_NOT_CONFIGURED',
      'belvo'
    );
  }

  const accounts = await this.request(
    'GET',
    `${this.aggregationBase}/accounts/?link=${this.aggregationLinkId}`,
    undefined,
    false // aggregation API, no payments version header
  ) as Array<{
    currency: string;
    balance: { available: number; current: number };
  }>;

  if (!accounts.length) {
    throw new JuntoError('No accounts found', 'BELVO_NO_ACCOUNTS', 'belvo');
  }

  // Sum available balance across all BRL accounts
  const totalAvailable = accounts
    .filter(a => a.currency === 'BRL')
    .reduce((sum, a) => sum + (a.balance.available ?? 0), 0);

  return {
    provider: this.name,
    currency: 'BRL',
    available: Math.round(totalAvailable * 100), // Belvo returns reais, convert to cents
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

Replace the placeholder comment:

```typescript
import { BelvoProvider } from './providers/belvo.js';

if (process.env.BELVO_SECRET_ID && process.env.BELVO_SECRET_PASSWORD) {
  providers.set('belvo', new BelvoProvider({
    secretId: process.env.BELVO_SECRET_ID,
    secretPassword: process.env.BELVO_SECRET_PASSWORD,
    environment: (process.env.BELVO_ENVIRONMENT as 'sandbox' | 'production') ?? 'sandbox',
    beneficiaryAccountId: process.env.BELVO_BENEFICIARY_ACCOUNT_ID ?? '',
    callbackUrl: process.env.BELVO_CALLBACK_URL,
    aggregationLinkId: process.env.BELVO_AGGREGATION_LINK_ID,
    timeoutMs: parseInt(process.env.BELVO_TIMEOUT_MS ?? '30000', 10),
  }));
}
```

### Step 9: Update `.env.example`

```env
# Belvo — Open Finance Payments (Brazil, Mexico, Colombia)
BELVO_SECRET_ID=                      # Belvo Payments API secret ID
BELVO_SECRET_PASSWORD=                # Belvo Payments API secret password
# BELVO_ENVIRONMENT=sandbox           # sandbox | production (default: sandbox)
# BELVO_BENEFICIARY_ACCOUNT_ID=       # Your merchant bank account UUID (from Belvo dashboard)
# BELVO_CALLBACK_URL=                 # Redirect URL after payment authorization
# BELVO_AGGREGATION_LINK_ID=          # For balance() — aggregation link UUID
# BELVO_TIMEOUT_MS=30000              # API timeout in ms (default: 30s)
```

---

## 6. Amount Conversion

**This is the most critical implementation detail.**

| System | Format | Example for R$50.00 |
|---|---|---|
| junto (internal) | Integer cents | `5000` |
| Woovi API | Integer cents | `5000` |
| Stripe API | Integer cents | `5000` |
| Belvo API | Decimal string | `"50.00"` |

Conversion functions:

```typescript
// junto cents → Belvo decimal string
function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Belvo decimal string → junto cents
function decimalToCents(decimal: string): number {
  return Math.round(parseFloat(decimal) * 100);
}
```

---

## 7. Testing Strategy

### Unit tests (`test/belvo.test.ts`)

Mock `global.fetch` — same pattern as `test/woovi.test.ts`:

**Test cases:**
1. `pay()` — customer created, payment intent created, redirect_url in metadata
2. `pay()` — amount converted from cents to decimal correctly
3. `charge()` — payment link created, URL returned
4. `status()` — intent retrieved, amount converted back to cents
5. `status()` — maps all Belvo statuses correctly
6. `refund()` — throws `REFUND_NOT_SUPPORTED`
7. `balance()` — aggregation accounts summed, converted to cents
8. `balance()` — throws when no aggregation link configured
9. Error handling — HTTP 401 (bad credentials), 400 (validation), timeout
10. `info()` — correct metadata
11. Auth header — correctly Base64-encodes credentials
12. Version header — present on payments calls, absent on aggregation calls

### Live test (`test/live-belvo.ts`)

```bash
BELVO_SECRET_ID=xxx BELVO_SECRET_PASSWORD=yyy npx tsx test/live-belvo.ts charge 5000 "Test"
BELVO_SECRET_ID=xxx BELVO_SECRET_PASSWORD=yyy npx tsx test/live-belvo.ts status <intent-uuid>
```

Use sandbox environment for testing — Belvo's sandbox simulates the full OFPI flow.

---

## 8. Edge Cases & Gotchas

1. **Redirect-based flow**: Unlike Woovi, the user MUST visit a URL and authorize at their bank. The agent needs to present the `redirect_url` and wait for the user to complete authorization. This is a UX consideration for the MCP client.

2. **Customer creation**: Every `pay()` call creates a new Customer object. For production, cache customer IDs by payer identifier to avoid duplicates. This is a v0.2.0 optimization.

3. **Beneficiary account**: The `BELVO_BENEFICIARY_ACCOUNT_ID` must be pre-registered in the Belvo dashboard. Without it, payment intents will fail.

4. **No refund API**: Belvo OFPI doesn't support programmatic refunds. The adapter throws an error. If refunds are needed, route through Woovi instead.

5. **Aggregation vs. Payments**: These are separate products with separate API keys. `balance()` uses the aggregation API; everything else uses the payments API. A user might configure payments without aggregation.

6. **Webhook dependency**: For production reliability, implement webhook listeners (v0.2.0) to receive `PAYMENT_INTENTS STATUS_UPDATE` events instead of polling `status()`.

7. **Decimal precision**: Belvo uses 2 decimal places for BRL. Always use `.toFixed(2)` when converting cents to avoid floating-point issues.

8. **Payer institution**: The `pay()` flow ideally needs the payer's bank institution UUID. For v0.1.0, omit it and let Belvo's hosted UI show a bank selector. For v0.2.0, add an `institutions` tool to list available banks.

---

## 9. Routing Logic

With Belvo added alongside Woovi:

| Scenario | Selected provider | Why |
|---|---|---|
| `currency: "BRL"` | Woovi (first match) | Simpler flow, no redirect needed |
| `currency: "BRL", provider: "belvo"` | Belvo (forced) | User explicitly wants Open Finance |
| `currency: "BRL", rail: "open_finance"` | Belvo | Rail match |

**When to prefer Belvo over Woovi:**
- User wants to pay from a specific bank account
- Merchant doesn't have a Woovi account but has Belvo
- User wants balance reads from their bank (aggregation)
- Future: when Woovi is down, fail over to Belvo

---

## 10. Limitations (v0.1.0)

| Limitation | Workaround | Target |
|---|---|---|
| No refunds | Route refunds through Woovi | v0.2.0 |
| No webhooks | Poll `status()` | v0.2.0 |
| Customer created per payment | Cache customer IDs | v0.2.0 |
| No payer institution auto-detect | Let Belvo UI handle bank selection | v0.2.0 |
| Aggregation link manual setup | Document in README | v0.1.0 |

---

## Sources

- [Belvo API Authentication](https://developers.belvo.com/reference/authentication-1)
- [Pix via Open Finance Overview](https://developers.belvo.com/products/payments_brazil/payments-brazil-pix-via-open-finance-overview)
- [Pix via Open Finance API Guide](https://developers.belvo.com/products/payments_brazil/payments-brazil-pix-via-open-finance-api-guide)
- [Payment Intents API](https://developers.belvo.com/apis/belvoopenapispec)
- [Payment Links (Brazil)](https://developers.belvo.com/reference/createpaymentlinkbrazil)
- [Payments Webhooks](https://developers.belvo.com/developer_resources/resources-webhooks-payments-brazil)
- [Error Codes](https://developers.belvo.com/developer_resources/resources-belvo-api-errors)
- [Banking Aggregation (Brazil)](https://developers.belvo.com/products/aggregation_brazil/aggregation-brazil-introduction)
- [belvo npm (archived)](https://www.npmjs.com/package/belvo)
