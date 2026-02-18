// src/providers/woovi.ts
// Woovi/OpenPix provider adapter — Pix payments in Brazil
// Docs: https://developers.woovi.com

import { z } from "zod";
import {
  PaymentProvider,
  PayRequest,
  PayResult,
  ChargeRequest,
  ChargeResult,
  StatusResult,
  RefundResult,
  BalanceResult,
  ProviderInfo,
  ProviderTimeout,
  JuntoError,
} from "../types.js";

const WOOVI_API = "https://api.woovi.com/api/v1";
const DEFAULT_TIMEOUT_MS = 15_000; // 15 seconds

// --- Zod schemas for Woovi API responses ---

const WooviPaymentResponse = z.object({
  payment: z.object({
    status: z.string().optional(),
  }).passthrough(),
});

const WooviChargeResponse = z.object({
  charge: z.object({
    status: z.string().optional(),
    paymentLinkUrl: z.string().optional(),
    qrCodeImage: z.string().optional(),
    brCode: z.string().optional(),
    value: z.number().optional(),
    updatedAt: z.string().optional(),
  }).passthrough(),
  brCode: z.string().optional(),
});

const WooviRefundResponse = z.object({
  refund: z.object({
    status: z.string().optional(),
    value: z.number().optional(),
  }).passthrough(),
});

export class WooviProvider implements PaymentProvider {
  name = "woovi";
  supportedCurrencies = ["BRL"];
  supportedRails = ["pix"];
  settlementTime = "instant";

  private appId: string;
  private timeoutMs: number;

  constructor(appId: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.appId = appId;
    this.timeoutMs = timeoutMs;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${WOOVI_API}${path}`, {
        method,
        headers: {
          Authorization: this.appId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new JuntoError(
          `Woovi API error (${res.status}): ${errBody}`,
          `WOOVI_HTTP_${res.status}`,
          "woovi"
        );
      }

      return res.json();
    } catch (err) {
      if (err instanceof JuntoError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ProviderTimeout("woovi");
      }
      throw new JuntoError(
        `Woovi request failed: ${err instanceof Error ? err.message : String(err)}`,
        "WOOVI_REQUEST_FAILED",
        "woovi"
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapDestinationType(
    type?: string
  ): "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM" {
    const map: Record<string, "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM"> = {
      EMAIL: "EMAIL",
      PHONE: "PHONE",
      CPF: "CPF",
      CNPJ: "CNPJ",
      RANDOM: "RANDOM",
      email: "EMAIL",
      phone: "PHONE",
      cpf: "CPF",
      cnpj: "CNPJ",
    };
    return map[type ?? ""] ?? "RANDOM";
  }

  async pay(req: PayRequest): Promise<PayResult> {
    const correlationID =
      req.correlation_id ?? `junto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const raw = await this.request("POST", "/payment", {
      value: req.amount,
      destinationAlias: req.destination,
      destinationAliasType: this.mapDestinationType(req.destination_type),
      correlationID,
      comment: req.note ?? "Payment via Junto",
    });

    const data = WooviPaymentResponse.parse(raw);

    return {
      id: correlationID,
      status: (data.payment.status as PayResult["status"]) ?? "CREATED",
      provider: this.name,
      amount: req.amount,
      currency: "BRL",
      destination: req.destination,
      timestamp: new Date().toISOString(),
      metadata: { woovi_response: data.payment },
    };
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const correlationID =
      req.correlation_id ?? `junto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const body: Record<string, unknown> = {
      value: req.amount,
      correlationID,
      comment: req.description ?? "Charge via Junto",
    };

    if (req.expires_in) {
      body.expiresIn = req.expires_in;
    }

    if (req.customer_name || req.customer_email) {
      body.customer = {
        name: req.customer_name,
        email: req.customer_email,
      };
    }

    const raw = await this.request("POST", "/charge", body);
    const data = WooviChargeResponse.parse(raw);

    return {
      id: correlationID,
      status: data.charge.status ?? "ACTIVE",
      provider: this.name,
      amount: req.amount,
      currency: "BRL",
      payment_link: data.charge.paymentLinkUrl,
      qr_code: data.charge.qrCodeImage,
      br_code: data.brCode ?? data.charge.brCode,
      timestamp: new Date().toISOString(),
    };
  }

  async status(id: string): Promise<StatusResult> {
    const raw = await this.request(
      "GET",
      `/charge/${encodeURIComponent(id)}`
    );

    const data = WooviChargeResponse.parse(raw);

    return {
      id,
      status: data.charge.status ?? "UNKNOWN",
      provider: this.name,
      amount: data.charge.value ?? 0,
      currency: "BRL",
      timestamp: data.charge.updatedAt ?? new Date().toISOString(),
    };
  }

  async refund(id: string): Promise<RefundResult> {
    const raw = await this.request("POST", "/refund", {
      correlationID: id,
    });

    const data = WooviRefundResponse.parse(raw);

    return {
      id,
      status: data.refund.status ?? "CREATED",
      provider: this.name,
      refunded_amount: data.refund.value ?? 0,
      timestamp: new Date().toISOString(),
    };
  }

  async balance(): Promise<BalanceResult> {
    // Woovi's public API doesn't expose a balance endpoint.
    // This would require the merchant dashboard API or webhook-based tracking.
    throw new JuntoError(
      "Balance check not available for Woovi. Check app.woovi.com",
      "BALANCE_NOT_SUPPORTED",
      "woovi"
    );
  }

  info(): ProviderInfo {
    return {
      name: this.name,
      currencies: this.supportedCurrencies,
      rails: this.supportedRails,
      settlement: this.settlementTime,
      status: "active",
    };
  }
}
