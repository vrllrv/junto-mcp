# Stripe Provider — Implementation Guide

> **Status:** Not yet implemented. Woovi/Pix is live and tested. Stripe is next for global coverage.
>
> Target file: `src/providers/stripe.ts`
> Dependency: `npm install stripe` (v17+, types bundled)
> Env var: `STRIPE_SECRET_KEY`

---

## Overview

Stripe is the global provider for junto-mcp. It adds card payments, ACH (US), SEPA (EU), BACS (UK), and 135+ currencies. Unlike Woovi (Pix-only, Brazil-only, instant), Stripe covers international rails with T+2 settlement.

### What it unlocks

| Capability | Woovi (current) | + Stripe |
|---|---|---|
| Currencies | BRL only | 135+ (USD, EUR, GBP, JPY, etc.) |
| Rails | Pix | Cards, ACH, SEPA, BACS, Apple Pay, Google Pay, Boleto, Klarna |
| Markets | Brazil | Global |
| Settlement | Instant | T+2 (cards), T+4 (ACH), instant payouts available |
| Balance check | Not supported | Supported via `GET /v1/balance` |

---

## 1. Authentication

Stripe uses Bearer token auth with secret API keys.

```
Authorization: Bearer sk_live_xxx
```

The `stripe` npm SDK handles this automatically. Two key types:
- `sk_test_...` — sandbox (25 req/s)
- `sk_live_...` — production (100 req/s)

**Wire-up:** Read `STRIPE_SECRET_KEY` from env, pass to constructor.

---

## 2. Method Mapping

| junto method | Stripe primitive | Endpoint | SDK call |
|---|---|---|---|
| `pay()` (to bank) | Payout | `POST /v1/payouts` | `stripe.payouts.create()` |
| `pay()` (to connected account) | Transfer | `POST /v1/transfers` | `stripe.transfers.create()` |
| `charge()` | Checkout Session | `POST /v1/checkout/sessions` | `stripe.checkout.sessions.create()` |
| `status()` | Varies by ID prefix | `GET /v1/{resource}/{id}` | `stripe.{resource}.retrieve()` |
| `refund()` | Refund | `POST /v1/refunds` | `stripe.refunds.create()` |
| `balance()` | Balance | `GET /v1/balance` | `stripe.balance.retrieve()` |
| `info()` | — | — | Static metadata |

---

## 3. Implementation Steps

### Step 1: Install dependency

```bash
npm install stripe
```

No `@types/stripe` needed — types are bundled in the `stripe` package.

### Step 2: Create `src/providers/stripe.ts`

```typescript
import Stripe from 'stripe';
import {
  PaymentProvider, PayRequest, PayResult,
  ChargeRequest, ChargeResult, StatusResult,
  RefundResult, BalanceResult, ProviderInfo,
  JuntoError, ProviderTimeout,
} from '../types.js';
```

### Step 3: Constructor

```typescript
export class StripeProvider implements PaymentProvider {
  name = 'stripe';
  supportedCurrencies = ['USD','EUR','GBP','BRL','AUD','CAD','CHF','JPY'];
  supportedRails = ['card','ach','sepa','bacs','checkout'];
  settlementTime = 'T+2 business days (cards)';

  private client: Stripe;
  private successUrl: string;
  private cancelUrl: string;

  constructor(secretKey: string, options?: {
    successUrl?: string;
    cancelUrl?: string;
    timeoutMs?: number;
  }) {
    this.client = new Stripe(secretKey, {
      maxNetworkRetries: 3,
      timeout: options?.timeoutMs ?? 30_000,
    });
    this.successUrl = options?.successUrl ?? 'https://junto.app/success';
    this.cancelUrl  = options?.cancelUrl  ?? 'https://junto.app/cancel';
  }
}
```

### Step 4: `pay()` — Send money out

Two modes based on destination format:
- `acct_xxx` → Transfer to connected Stripe account
- Anything else → Payout to platform's own bank account

```typescript
async pay(req: PayRequest): Promise<PayResult> {
  const isConnectedAccount = req.destination.startsWith('acct_');

  if (isConnectedAccount) {
    const transfer = await this.client.transfers.create({
      amount: req.amount,
      currency: req.currency.toLowerCase(),
      destination: req.destination,
      description: req.note,
    });
    return {
      id: transfer.id,
      status: transfer.reversed ? 'FAILED' : 'COMPLETED',
      provider: this.name,
      amount: transfer.amount,
      currency: transfer.currency.toUpperCase(),
      destination: req.destination,
      timestamp: new Date(transfer.created * 1000).toISOString(),
    };
  }

  // Payout to own bank
  const payout = await this.client.payouts.create({
    amount: req.amount,
    currency: req.currency.toLowerCase(),
    description: req.note ?? 'Payment via Junto',
    method: 'standard',
  });
  return {
    id: payout.id,
    status: mapPayoutStatus(payout.status),
    provider: this.name,
    amount: payout.amount,
    currency: payout.currency.toUpperCase(),
    destination: String(payout.destination ?? req.destination),
    timestamp: new Date(payout.created * 1000).toISOString(),
    metadata: { arrival_date: payout.arrival_date },
  };
}
```

**Payout status mapping:**

| Stripe `payout.status` | junto `PayResult.status` |
|---|---|
| `paid` | `COMPLETED` |
| `in_transit` | `APPROVED` |
| `pending` | `CREATED` |
| `failed` / `canceled` | `FAILED` |

### Step 5: `charge()` — Create Checkout Session

```typescript
async charge(req: ChargeRequest): Promise<ChargeResult> {
  const correlationID = req.correlation_id
    ?? `junto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: req.currency.toLowerCase(),
        product_data: { name: req.description ?? 'Payment via Junto' },
        unit_amount: req.amount,
      },
      quantity: 1,
    }],
    success_url: this.successUrl,
    cancel_url: this.cancelUrl,
    metadata: { correlation_id: correlationID },
  };

  if (req.customer_email) params.customer_email = req.customer_email;
  if (req.expires_in) {
    params.expires_at = Math.floor(Date.now() / 1000) + req.expires_in;
  }

  const session = await this.client.checkout.sessions.create(params);

  return {
    id: session.id,
    status: session.status ?? 'open',
    provider: this.name,
    amount: req.amount,
    currency: req.currency,
    payment_link: session.url ?? undefined,
    timestamp: new Date().toISOString(),
  };
}
```

**Checkout Session status values:** `open` | `complete` | `expired`

### Step 6: `status()` — Smart ID-prefix routing

Stripe IDs are self-identifying by prefix. Route to the correct API:

```typescript
async status(id: string): Promise<StatusResult> {
  if (id.startsWith('pi_')) {
    const intent = await this.client.paymentIntents.retrieve(id);
    return {
      id,
      status: mapIntentStatus(intent.status),
      provider: this.name,
      amount: intent.amount,
      currency: intent.currency.toUpperCase(),
      timestamp: new Date(intent.created * 1000).toISOString(),
    };
  }
  if (id.startsWith('cs_')) {
    const session = await this.client.checkout.sessions.retrieve(id);
    return {
      id,
      status: session.status ?? 'unknown',
      provider: this.name,
      amount: session.amount_total ?? 0,
      currency: (session.currency ?? 'usd').toUpperCase(),
      timestamp: new Date().toISOString(),
    };
  }
  if (id.startsWith('po_')) {
    const payout = await this.client.payouts.retrieve(id);
    return {
      id,
      status: mapPayoutStatus(payout.status),
      provider: this.name,
      amount: payout.amount,
      currency: payout.currency.toUpperCase(),
      timestamp: new Date(payout.created * 1000).toISOString(),
    };
  }
  throw new JuntoError(`Unknown Stripe ID prefix: ${id}`, 'STRIPE_UNKNOWN_ID', 'stripe');
}
```

**PaymentIntent status mapping:**

| Stripe `intent.status` | junto status |
|---|---|
| `succeeded` | `COMPLETED` |
| `processing` / `requires_capture` | `APPROVED` |
| `canceled` | `FAILED` |
| `requires_payment_method` / `requires_confirmation` / `requires_action` | `CREATED` |

### Step 7: `refund()` — Full refund of a PaymentIntent

```typescript
async refund(id: string): Promise<RefundResult> {
  // Resolve payment_intent from checkout session if needed
  let paymentIntentId = id;
  if (id.startsWith('cs_')) {
    const session = await this.client.checkout.sessions.retrieve(id);
    paymentIntentId = String(session.payment_intent);
  }

  const refund = await this.client.refunds.create({
    payment_intent: paymentIntentId,
    reason: 'requested_by_customer',
  });

  return {
    id: refund.id,
    status: refund.status ?? 'pending',
    provider: this.name,
    refunded_amount: refund.amount,
    timestamp: new Date(refund.created * 1000).toISOString(),
  };
}
```

**Refund status values:** `pending` | `requires_action` | `succeeded` | `failed` | `canceled`

### Step 8: `balance()` — Account balance

```typescript
async balance(): Promise<BalanceResult> {
  const bal = await this.client.balance.retrieve();
  const entry = bal.available[0];
  if (!entry) {
    throw new JuntoError('No balance entries', 'STRIPE_NO_BALANCE', 'stripe');
  }
  return {
    provider: this.name,
    currency: entry.currency.toUpperCase(),
    available: entry.amount,
  };
}
```

### Step 9: Error handling

Wrap all methods in try/catch. The Stripe SDK throws typed errors:

```typescript
import Stripe from 'stripe';

private wrapError(err: unknown, context: string): never {
  if (err instanceof Stripe.errors.StripeRateLimitError)
    throw new JuntoError('Stripe rate limit', 'STRIPE_RATE_LIMIT', 'stripe');
  if (err instanceof Stripe.errors.StripeAuthenticationError)
    throw new JuntoError('Invalid STRIPE_SECRET_KEY', 'STRIPE_AUTH', 'stripe');
  if (err instanceof Stripe.errors.StripeCardError)
    throw new JuntoError(`Card error: ${err.message}`, 'STRIPE_CARD_ERROR', 'stripe');
  if (err instanceof Stripe.errors.StripeInvalidRequestError)
    throw new JuntoError(`Bad request: ${err.message}`, 'STRIPE_INVALID', 'stripe');
  if (err instanceof Stripe.errors.StripeAPIError)
    throw new JuntoError(`Server error: ${err.message}`, 'STRIPE_SERVER_ERROR', 'stripe');
  throw new JuntoError(
    `Stripe ${context} failed: ${err instanceof Error ? err.message : String(err)}`,
    'STRIPE_ERROR', 'stripe'
  );
}
```

### Step 10: Wire up in `index.ts`

Replace the placeholder comment:

```typescript
import { StripeProvider } from './providers/stripe.js';

if (process.env.STRIPE_SECRET_KEY) {
  providers.set('stripe', new StripeProvider(
    process.env.STRIPE_SECRET_KEY,
    {
      successUrl: process.env.STRIPE_SUCCESS_URL,
      cancelUrl:  process.env.STRIPE_CANCEL_URL,
      timeoutMs:  parseInt(process.env.STRIPE_TIMEOUT_MS ?? '30000', 10),
    }
  ));
}
```

### Step 11: Update `.env.example`

```env
STRIPE_SECRET_KEY=             # Stripe — Cards, ACH, SEPA (Global)
# STRIPE_SUCCESS_URL=          # Checkout success redirect (default: https://junto.app/success)
# STRIPE_CANCEL_URL=           # Checkout cancel redirect (default: https://junto.app/cancel)
# STRIPE_TIMEOUT_MS=30000      # API timeout in ms (default: 30s)
```

---

## 4. Testing Strategy

### Unit tests (`test/stripe.test.ts`)

Mock the Stripe SDK client — don't call real APIs:

```typescript
// Mock stripe.payouts.create, stripe.checkout.sessions.create, etc.
// Verify: correct params passed, response mapped correctly, errors wrapped
```

**Test cases:**
1. `pay()` — payout created, status mapped
2. `pay()` — transfer to connected account
3. `charge()` — checkout session created, URL returned
4. `status()` — routes by ID prefix (pi_, cs_, po_)
5. `status()` — unknown prefix throws
6. `refund()` — refund created from pi_ ID
7. `refund()` — resolves pi_ from cs_ session
8. `balance()` — returns first available entry
9. `balance()` — empty available throws
10. Error wrapping — each Stripe error type maps to correct JuntoError code
11. `info()` — correct metadata

### Live test (`test/live-stripe.ts`)

Same pattern as `test/live-pix.ts`:

```bash
STRIPE_SECRET_KEY=sk_test_xxx npx tsx test/live-stripe.ts charge 5000 "Test charge"
STRIPE_SECRET_KEY=sk_test_xxx npx tsx test/live-stripe.ts status cs_xxx
STRIPE_SECRET_KEY=sk_test_xxx npx tsx test/live-stripe.ts balance
```

Use `sk_test_` keys — no real money moves in test mode.

---

## 5. Edge Cases & Gotchas

1. **Zero-decimal currencies** (JPY, KRW, etc.): `amount: 150` means 150 JPY, not 1.50. junto's "amount in smallest unit" convention handles this correctly — just pass through as-is.

2. **Minimum charge amounts**: USD $0.50, EUR 0.50, GBP 0.30, BRL 0.50. Stripe rejects below these.

3. **Checkout Session expiry**: Minimum 30 minutes, maximum 24 hours. If `expires_in` is outside this range, Stripe will reject.

4. **Idempotency**: The Stripe SDK supports `idempotencyKey` on all create calls. Use `correlation_id` as the idempotency key to prevent duplicate charges.

5. **Rate limits**: 100 req/s production, 25 req/s test. SDK auto-retries on 429 with `maxNetworkRetries: 3`.

6. **Refund window**: Stripe allows refunds up to 180 days after payment. After that, use a payout instead.

---

## 6. Routing Logic

After Stripe is added, the `pickProvider()` router in `index.ts` works automatically:

| Request | Selected provider |
|---|---|
| `currency: "BRL"` | Woovi (Pix, instant, lower fees) |
| `currency: "USD"` | Stripe (only option) |
| `currency: "EUR"` | Stripe (only option) |
| `provider: "stripe"` | Stripe (forced) |
| `provider: "woovi"` | Woovi (forced) |

The first-match router already handles this because Woovi only supports BRL and Stripe supports BRL + everything else. For BRL, Woovi will match first (it's registered before Stripe in the providers map) — this is the desired behavior since Pix is instant and cheaper.

---

## Sources

- [Stripe API Authentication](https://docs.stripe.com/api/authentication)
- [Payouts API](https://docs.stripe.com/api/payouts)
- [Transfers API](https://docs.stripe.com/api/transfers)
- [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create)
- [PaymentIntents](https://docs.stripe.com/api/payment_intents)
- [Refunds API](https://docs.stripe.com/api/refunds)
- [Balance API](https://docs.stripe.com/api/balance/balance_retrieve)
- [Supported Currencies](https://docs.stripe.com/currencies)
- [Rate Limits](https://docs.stripe.com/rate-limits)
- [Error Handling](https://docs.stripe.com/api/errors)
- [stripe npm](https://www.npmjs.com/package/stripe)
