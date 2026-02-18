// src/guardrails.ts
// Agent spend limits, human-in-the-loop, and audit logging

import { GuardrailConfig, PayRequest, AuditEntry } from "./types.js";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// --- Defaults ---
// Conservative out of the box. Override via JUNTO_* env vars.
//   Daily max:      R$500.00 (50000 cents)
//   Per-tx max:     R$200.00 (20000 cents)
//   Confirm above:  R$50.00  (5000 cents)

export const DEFAULT_CONFIG: GuardrailConfig = {
  daily_max: 50_000,
  per_tx_max: 20_000,
  confirm_above: 5_000,
  allowed_providers: [],
  allowed_destination_types: [],
};

export class Guardrails {
  private config: GuardrailConfig;
  private dailySpend: Map<string, number> = new Map(); // date -> cents spent
  private logDir: string;

  constructor(config?: Partial<GuardrailConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logDir = join(
      process.env.JUNTO_LOG_DIR ?? join(homedir(), ".junto")
    );
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private today(): string {
    return new Date().toISOString().split("T")[0];
  }

  private getTodaySpend(): number {
    return this.dailySpend.get(this.today()) ?? 0;
  }

  checkPay(req: PayRequest): {
    allowed: boolean;
    needs_confirmation: boolean;
    reason?: string;
  } {
    // Check per-transaction limit
    if (req.amount > this.config.per_tx_max) {
      return {
        allowed: false,
        needs_confirmation: false,
        reason: `Amount (${req.amount} cents) exceeds per-transaction limit (${this.config.per_tx_max} cents / ${(this.config.per_tx_max / 100).toFixed(2)})`,
      };
    }

    // Check daily limit
    const projected = this.getTodaySpend() + req.amount;
    if (projected > this.config.daily_max) {
      const remaining = Math.max(0, this.config.daily_max - this.getTodaySpend());
      return {
        allowed: false,
        needs_confirmation: false,
        reason: `Would exceed daily limit. Spent today: ${this.getTodaySpend()} cents, requested: ${req.amount} cents, remaining: ${remaining} cents`,
      };
    }

    // Check provider allowlist
    if (
      this.config.allowed_providers.length > 0 &&
      req.provider &&
      !this.config.allowed_providers.includes(req.provider)
    ) {
      return {
        allowed: false,
        needs_confirmation: false,
        reason: `Provider '${req.provider}' not in allowed list: [${this.config.allowed_providers.join(", ")}]`,
      };
    }

    // Check destination type allowlist
    if (
      this.config.allowed_destination_types.length > 0 &&
      req.destination_type &&
      !this.config.allowed_destination_types.includes(req.destination_type)
    ) {
      return {
        allowed: false,
        needs_confirmation: false,
        reason: `Destination type '${req.destination_type}' not in allowed list: [${this.config.allowed_destination_types.join(", ")}]`,
      };
    }

    // Check if human confirmation needed
    if (req.amount > this.config.confirm_above) {
      return {
        allowed: true,
        needs_confirmation: true,
        reason: `Amount (${req.amount} cents / ${(req.amount / 100).toFixed(2)}) exceeds confirmation threshold (${this.config.confirm_above} cents / ${(this.config.confirm_above / 100).toFixed(2)})`,
      };
    }

    return { allowed: true, needs_confirmation: false };
  }

  recordSpend(amount: number): void {
    const key = this.today();
    this.dailySpend.set(key, (this.dailySpend.get(key) ?? 0) + amount);
  }

  audit(entry: AuditEntry): void {
    const line = JSON.stringify(entry) + "\n";
    const logFile = join(this.logDir, `audit-${this.today()}.jsonl`);
    try {
      appendFileSync(logFile, line);
    } catch {
      console.error("[junto] Failed to write audit log:", logFile);
    }
  }

  getStatus(): {
    daily_spend: number;
    daily_limit: number;
    daily_remaining: number;
    per_tx_max: number;
    confirm_above: number;
    currency_note: string;
  } {
    const spent = this.getTodaySpend();
    return {
      daily_spend: spent,
      daily_limit: this.config.daily_max,
      daily_remaining: Math.max(0, this.config.daily_max - spent),
      per_tx_max: this.config.per_tx_max,
      confirm_above: this.config.confirm_above,
      currency_note: "All values in cents (smallest currency unit)",
    };
  }
}
