// src/types.ts
// Core types for the Junto universal payments layer

// --- Transaction Types ---
// "payment" = moving money between people/accounts
// "compute" = allocating budget to LLM providers (junto-compute, future)
export type TransactionType = "payment" | "compute";

// --- Error Types ---

export class JuntoError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: string
  ) {
    super(message);
    this.name = "JuntoError";
  }
}

export class InsufficientBalance extends JuntoError {
  constructor(provider: string) {
    super("Insufficient balance", "INSUFFICIENT_BALANCE", provider);
    this.name = "InsufficientBalance";
  }
}

export class InvalidDestination extends JuntoError {
  constructor(destination: string, provider?: string) {
    super(`Invalid destination: ${destination}`, "INVALID_DESTINATION", provider);
    this.name = "InvalidDestination";
  }
}

export class ProviderTimeout extends JuntoError {
  constructor(provider: string) {
    super(`Provider timed out: ${provider}`, "PROVIDER_TIMEOUT", provider);
    this.name = "ProviderTimeout";
  }
}

export class ProviderUnavailable extends JuntoError {
  constructor(provider: string) {
    super(`Provider unavailable: ${provider}`, "PROVIDER_UNAVAILABLE", provider);
    this.name = "ProviderUnavailable";
  }
}

export class LimitExceeded extends JuntoError {
  constructor(reason: string) {
    super(reason, "LIMIT_EXCEEDED");
    this.name = "LimitExceeded";
  }
}

// --- Request / Result Interfaces ---

export interface PayRequest {
  amount: number; // in smallest unit (cents)
  currency: string; // ISO 4217
  destination: string; // pix key, email, IBAN, etc.
  destination_type?: string; // EMAIL, PHONE, CPF, CNPJ, RANDOM, IBAN
  note?: string;
  provider?: string; // force a specific provider
  correlation_id?: string;
}

export interface PayResult {
  id: string;
  status: "CREATED" | "APPROVED" | "COMPLETED" | "FAILED";
  provider: string;
  amount: number;
  currency: string;
  destination: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeRequest {
  amount: number;
  currency: string;
  description?: string;
  customer_email?: string;
  customer_name?: string;
  expires_in?: number; // seconds
  correlation_id?: string;
}

export interface ChargeResult {
  id: string;
  status: string;
  provider: string;
  amount: number;
  currency: string;
  payment_link?: string;
  qr_code?: string;
  br_code?: string;
  timestamp: string;
}

export interface StatusResult {
  id: string;
  status: string;
  provider: string;
  amount: number;
  currency: string;
  timestamp: string;
}

export interface RefundResult {
  id: string;
  status: string;
  provider: string;
  refunded_amount: number;
  timestamp: string;
}

export interface BalanceResult {
  provider: string;
  currency: string;
  available: number;
}

export interface ProviderInfo {
  name: string;
  currencies: string[];
  rails: string[];
  settlement: string;
  status: "active" | "configured" | "unavailable";
}

// --- Provider Interface ---

export interface PaymentProvider {
  name: string;
  supportedCurrencies: string[];
  supportedRails: string[];
  settlementTime: string;

  pay(req: PayRequest): Promise<PayResult>;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  status(id: string): Promise<StatusResult>;
  refund(id: string): Promise<RefundResult>;
  balance(): Promise<BalanceResult>;
  info(): ProviderInfo;
}

// --- Guardrail Config ---

export interface GuardrailConfig {
  daily_max: number; // max spend per day in cents
  per_tx_max: number; // max per transaction in cents
  confirm_above: number; // ask human above this amount
  allowed_providers: string[];
  allowed_destination_types: string[];
}

// --- Audit Entry ---

export interface AuditEntry {
  timestamp: string;
  type: TransactionType;
  action: string;
  tool: string;
  amount?: number;
  currency?: string;
  provider?: string;
  destination?: string;
  status: "allowed" | "blocked" | "pending_confirmation" | "executed" | "failed";
  reason?: string;
}
