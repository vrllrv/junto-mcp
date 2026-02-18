#!/usr/bin/env npx tsx
// test/live-pix.ts
// Live Pix test — uses real Woovi API to send/charge/check Pix
//
// Usage:
//   WOOVI_APP_ID=your-key npx tsx test/live-pix.ts charge 100 "Test charge"
//   WOOVI_APP_ID=your-key npx tsx test/live-pix.ts status <correlation-id>
//   WOOVI_APP_ID=your-key npx tsx test/live-pix.ts pay 100 test@email.com EMAIL
//   WOOVI_APP_ID=your-key npx tsx test/live-pix.ts pay 100 12345678900 CPF
//   WOOVI_APP_ID=your-key npx tsx test/live-pix.ts refund <correlation-id>
//
// Or set WOOVI_APP_ID in a .env file and source it first.
//
// SAFETY: Guardrails are active. Default limits apply:
//   Per-tx max:    R$200.00 (20000 cents)
//   Daily max:     R$500.00 (50000 cents)
//   Confirm above: R$50.00  (5000 cents)

import { WooviProvider } from "../src/providers/woovi.js";
import { Guardrails } from "../src/guardrails.js";

const appId = process.env.WOOVI_APP_ID;
if (!appId) {
  console.error("Error: WOOVI_APP_ID is required.\n");
  console.error("  WOOVI_APP_ID=your-key npx tsx test/live-pix.ts charge 100 \"Test\"");
  process.exit(1);
}

const provider = new WooviProvider(appId);
const guardrails = new Guardrails();

const [command, ...args] = process.argv.slice(2);

function cents(s: string): number {
  const n = parseInt(s, 10);
  if (isNaN(n) || n <= 0) {
    console.error(`Invalid amount: "${s}" — must be a positive integer (cents)`);
    process.exit(1);
  }
  return n;
}

function printJson(label: string, data: unknown) {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

async function run() {
  switch (command) {
    // -------------------------------------------------------
    // CHARGE — create a Pix QR code / payment link
    // -------------------------------------------------------
    case "charge": {
      const amount = cents(args[0] ?? "");
      const description = args[1] ?? "Live test charge via Junto";

      console.log(`Creating charge for ${amount} cents (R$${(amount / 100).toFixed(2)})...`);

      const result = await provider.charge({
        amount,
        currency: "BRL",
        description,
      });

      printJson("Charge created", result);

      if (result.payment_link) {
        console.log(`\nPayment link: ${result.payment_link}`);
      }
      if (result.br_code) {
        console.log(`\nPix copy-paste code:\n  ${result.br_code}`);
      }
      console.log(`\nCheck status with:\n  npx tsx test/live-pix.ts status ${result.id}`);
      break;
    }

    // -------------------------------------------------------
    // STATUS — check a charge/payment by correlation ID
    // -------------------------------------------------------
    case "status": {
      const id = args[0];
      if (!id) {
        console.error("Usage: live-pix.ts status <correlation-id>");
        process.exit(1);
      }

      console.log(`Checking status of ${id}...`);
      const result = await provider.status(id);
      printJson("Status", result);
      break;
    }

    // -------------------------------------------------------
    // PAY — send Pix to a destination (key, CPF, email, phone)
    // -------------------------------------------------------
    case "pay": {
      const amount = cents(args[0] ?? "");
      const destination = args[1];
      const destinationType = args[2] ?? "RANDOM";

      if (!destination) {
        console.error("Usage: live-pix.ts pay <amount-cents> <pix-key> [CPF|EMAIL|PHONE|CNPJ|RANDOM]");
        process.exit(1);
      }

      // Run through guardrails first
      const check = guardrails.checkPay({
        amount,
        currency: "BRL",
        destination,
        destination_type: destinationType,
      });

      if (!check.allowed) {
        console.error(`\nBlocked by guardrails: ${check.reason}`);
        process.exit(1);
      }

      if (check.needs_confirmation) {
        console.log(`\nConfirmation needed: ${check.reason}`);
        console.log(`Amount: R$${(amount / 100).toFixed(2)} -> ${destination} (${destinationType})`);
        console.log("\nRe-run with JUNTO_CONFIRM_ABOVE set higher to bypass, or reduce the amount.");
        process.exit(0);
      }

      console.log(`Sending ${amount} cents (R$${(amount / 100).toFixed(2)}) to ${destination} (${destinationType})...`);

      const result = await provider.pay({
        amount,
        currency: "BRL",
        destination,
        destination_type: destinationType,
      });

      guardrails.recordSpend(amount);
      printJson("Payment result", result);
      console.log(`\nCheck status with:\n  npx tsx test/live-pix.ts status ${result.id}`);
      break;
    }

    // -------------------------------------------------------
    // REFUND — reverse a payment by correlation ID
    // -------------------------------------------------------
    case "refund": {
      const id = args[0];
      if (!id) {
        console.error("Usage: live-pix.ts refund <correlation-id>");
        process.exit(1);
      }

      console.log(`Refunding ${id}...`);
      const result = await provider.refund(id);
      printJson("Refund result", result);
      break;
    }

    // -------------------------------------------------------
    // HELP
    // -------------------------------------------------------
    default: {
      console.log(`
Junto Live Pix Test
===================

Commands:
  charge <amount-cents> [description]       Create a Pix charge (QR code)
  status <correlation-id>                   Check payment/charge status
  pay <amount-cents> <pix-key> [type]       Send Pix (type: CPF, EMAIL, PHONE, CNPJ, RANDOM)
  refund <correlation-id>                   Refund a payment

Examples:
  npx tsx test/live-pix.ts charge 100 "Coffee"
  npx tsx test/live-pix.ts pay 100 test@email.com EMAIL
  npx tsx test/live-pix.ts pay 500 12345678900 CPF
  npx tsx test/live-pix.ts status junto-1234567890-abc123
  npx tsx test/live-pix.ts refund junto-1234567890-abc123

Environment:
  WOOVI_APP_ID=xxx          (required) Your Woovi/OpenPix API key
  JUNTO_PER_TX_MAX=20000    Max per transaction in cents (default: R$200)
  JUNTO_DAILY_LIMIT=50000   Max daily spend in cents (default: R$500)
  JUNTO_CONFIRM_ABOVE=5000  Confirm above this amount (default: R$50)
`);
      break;
    }
  }
}

run().catch((err) => {
  console.error("\nError:", err.message ?? err);
  if (err.code) console.error("Code:", err.code);
  if (err.provider) console.error("Provider:", err.provider);
  process.exit(1);
});
