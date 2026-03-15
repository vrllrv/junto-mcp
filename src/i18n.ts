// src/i18n.ts
// Internationalization — auto-detects system locale.
// Supports: en (English), pt-BR (Brazilian Portuguese)
//
// Override with: JUNTO_LANG=pt-BR or JUNTO_LANG=en

export type Locale = "en" | "pt-BR";

export interface Messages {
  // General
  tagline: string;
  noProviders: string;
  runSetup: string;
  saved: string;
  skipped: string;
  cancelled: string;
  tryIt: string;
  configStored: string;
  auditLog: string;

  // Setup
  setupTitle: string;
  setupPrompt: string;
  setupHint: string;
  alreadyConfigured: string;

  // Pay
  payUsage: string;
  payExamples: string[];
  paymentSummary: string;
  amount: string;
  to: string;
  note: string;
  provider: string;
  sendConfirm: string;
  sending: string;
  sent: string;
  status: string;
  id: string;
  time: string;
  checkStatus: string;
  blocked: string;
  failed: string;

  // Charge
  chargeUsage: string;
  chargeExamples: string[];
  creatingCharge: string;
  chargeCreated: string;
  description: string;
  paymentLink: string;
  pixCopyPaste: string;

  // Status
  statusUsage: string;
  checking: string;
  updated: string;

  // Refund
  refundUsage: string;
  refundConfirm: string;
  processingRefund: string;
  refundSubmitted: string;
  refunded: string;

  // Balance
  balanceTitle: string;

  // Providers
  providersTitle: string;
  noneConfigured: string;
  addFirstProvider: string;
  currencies: string;
  rails: string;
  settlement: string;

  // Limits
  limitsTitle: string;
  dailyLimit: string;
  spentToday: string;
  remaining: string;
  perTxMax: string;
  confirmAbove: string;

  // Help
  commands: string;
  options: string;
  helpSetup: string;
  helpPay: string;
  helpCharge: string;
  helpStatus: string;
  helpRefund: string;
  helpBalance: string;
  helpProviders: string;
  helpLimits: string;
  helpMcp: string;
  helpHelp: string;
  helpVersion: string;

  // Command names (for help screen)
  cmdSetup: string;
  cmdPay: string;
  cmdCharge: string;
  cmdStatus: string;
  cmdRefund: string;
  cmdBalance: string;
  cmdProviders: string;
  cmdLimits: string;
  cmdHelp: string;
  cmdPayUsageShort: string;
  cmdChargeUsageShort: string;

  // Errors
  invalidAmount: string;
  amountExamples: string;
}

const en: Messages = {
  tagline: "The payment protocol for people and agents.",
  noProviders: "No providers configured.",
  runSetup: "Run {cmd} to add your API key.",
  saved: "Saved to ~/.junto/config.json",
  skipped: "Skipped.",
  cancelled: "Cancelled.",
  tryIt: "Try it:",
  configStored: "Config stored in ~/.junto/config.json",
  auditLog: "Audit log in ~/.junto/audit-YYYY-MM-DD.jsonl",

  setupTitle: "Junto Setup",
  setupPrompt: "Configure your Woovi/OpenPix API key",
  setupHint: "Get yours at https://app.woovi.com → API/Plugins → New API",
  alreadyConfigured: "(already configured)",

  payUsage: "<amount> <destination> [--note \"memo\"] [--type EMAIL|CPF|PHONE|CNPJ]",
  payExamples: [
    "junto pay 25.00 maria@email.com",
    "junto pay 10 12345678900 --type CPF",
    "junto pay 150.00 +5511999887766 --note \"Rent\"",
  ],
  paymentSummary: "Payment Summary",
  amount: "Amount",
  to: "To",
  note: "Note",
  provider: "Provider",
  sendConfirm: "Send this payment?",
  sending: "Sending...",
  sent: "Sent!",
  status: "Status",
  id: "ID",
  time: "Time",
  checkStatus: "Check status",
  blocked: "Blocked",
  failed: "Failed",

  chargeUsage: "<amount> [description]",
  chargeExamples: [
    "junto charge 10.00 \"Coffee\"",
    "junto charge 250",
  ],
  creatingCharge: "Creating charge...",
  chargeCreated: "Charge created!",
  description: "Description",
  paymentLink: "Payment link:",
  pixCopyPaste: "Pix copy-paste:",

  statusUsage: "<id>",
  checking: "Checking...",
  updated: "Updated",

  refundUsage: "<id>",
  refundConfirm: "Refund",
  processingRefund: "Processing refund...",
  refundSubmitted: "Refund submitted!",
  refunded: "Refunded",

  balanceTitle: "Balance",

  providersTitle: "Providers",
  noneConfigured: "None configured.",
  addFirstProvider: "Run {cmd} to add your first provider.",
  currencies: "Currencies",
  rails: "Rails",
  settlement: "Settlement",

  limitsTitle: "Spending Limits",
  dailyLimit: "Daily limit",
  spentToday: "Spent today",
  remaining: "Remaining",
  perTxMax: "Per-tx max",
  confirmAbove: "Confirm above",

  commands: "Commands:",
  options: "Options:",
  helpSetup: "Configure API keys",
  helpPay: "Send money via Pix",
  helpCharge: "Create a payment request / QR code",
  helpStatus: "Check payment status",
  helpRefund: "Refund a payment",
  helpBalance: "Check available funds",
  helpProviders: "List configured providers",
  helpLimits: "Show spending limits",
  helpMcp: "Run as MCP server (for AI clients)",
  helpHelp: "Show this help",
  helpVersion: "Show version",

  cmdSetup: "junto setup",
  cmdPay: "junto pay",
  cmdCharge: "junto charge",
  cmdStatus: "junto status",
  cmdRefund: "junto refund",
  cmdBalance: "junto balance",
  cmdProviders: "junto providers",
  cmdLimits: "junto limits",
  cmdHelp: "junto help",
  cmdPayUsageShort: "<amount> <destination>",
  cmdChargeUsageShort: "<amount> [description]",

  invalidAmount: "Invalid amount",
  amountExamples: "Examples: 25.00, 10, R$50.00",
};

const ptBR: Messages = {
  tagline: "O protocolo de pagamentos para pessoas e agentes.",
  noProviders: "Nenhum provedor configurado.",
  runSetup: "Execute {cmd} para adicionar sua chave de API.",
  saved: "Salvo em ~/.junto/config.json",
  skipped: "Pulado.",
  cancelled: "Cancelado.",
  tryIt: "Teste:",
  configStored: "Configuracao em ~/.junto/config.json",
  auditLog: "Log de auditoria em ~/.junto/audit-YYYY-MM-DD.jsonl",

  setupTitle: "Junto Setup",
  setupPrompt: "Configure sua chave de API Woovi/OpenPix",
  setupHint: "Obtenha em https://app.woovi.com → API/Plugins → Nova API",
  alreadyConfigured: "(ja configurado)",

  payUsage: "<valor> <destino> [--note \"memo\"] [--type EMAIL|CPF|PHONE|CNPJ]",
  payExamples: [
    "junto pay 25.00 maria@email.com",
    "junto pay 10 12345678900 --type CPF",
    "junto pay 150.00 +5511999887766 --note \"Aluguel\"",
  ],
  paymentSummary: "Resumo do Pagamento",
  amount: "Valor",
  to: "Para",
  note: "Nota",
  provider: "Provedor",
  sendConfirm: "Enviar este pagamento?",
  sending: "Enviando...",
  sent: "Enviado!",
  status: "Status",
  id: "ID",
  time: "Hora",
  checkStatus: "Ver status",
  blocked: "Bloqueado",
  failed: "Falhou",

  chargeUsage: "<valor> [descricao]",
  chargeExamples: [
    "junto charge 10.00 \"Cafe\"",
    "junto charge 250",
  ],
  creatingCharge: "Criando cobranca...",
  chargeCreated: "Cobranca criada!",
  description: "Descricao",
  paymentLink: "Link de pagamento:",
  pixCopyPaste: "Pix copia e cola:",

  statusUsage: "<id>",
  checking: "Verificando...",
  updated: "Atualizado",

  refundUsage: "<id>",
  refundConfirm: "Reembolsar",
  processingRefund: "Processando reembolso...",
  refundSubmitted: "Reembolso enviado!",
  refunded: "Reembolsado",

  balanceTitle: "Saldo",

  providersTitle: "Provedores",
  noneConfigured: "Nenhum configurado.",
  addFirstProvider: "Execute {cmd} para adicionar seu primeiro provedor.",
  currencies: "Moedas",
  rails: "Meios",
  settlement: "Liquidacao",

  limitsTitle: "Limites de Gasto",
  dailyLimit: "Limite diario",
  spentToday: "Gasto hoje",
  remaining: "Restante",
  perTxMax: "Max por transacao",
  confirmAbove: "Confirmar acima de",

  commands: "Comandos:",
  options: "Opcoes:",
  helpSetup: "Configurar chaves de API",
  helpPay: "Enviar dinheiro via Pix",
  helpCharge: "Criar cobranca / QR code Pix",
  helpStatus: "Verificar status do pagamento",
  helpRefund: "Reembolsar um pagamento",
  helpBalance: "Verificar saldo disponivel",
  helpProviders: "Listar provedores configurados",
  helpLimits: "Mostrar limites de gasto",
  helpMcp: "Rodar como servidor MCP (para agentes IA)",
  helpHelp: "Mostrar esta ajuda",
  helpVersion: "Mostrar versao",

  cmdSetup: "junto setup",
  cmdPay: "junto pagar",
  cmdCharge: "junto cobrar",
  cmdStatus: "junto status",
  cmdRefund: "junto reembolso",
  cmdBalance: "junto saldo",
  cmdProviders: "junto provedores",
  cmdLimits: "junto limites",
  cmdHelp: "junto ajuda",
  cmdPayUsageShort: "<valor> <destino>",
  cmdChargeUsageShort: "<valor> [descricao]",

  invalidAmount: "Valor invalido",
  amountExamples: "Exemplos: 25.00, 10, R$50.00",
};

const locales: Record<string, Messages> = {
  en,
  "en-US": en,
  "en-GB": en,
  "pt-BR": ptBR,
  pt: ptBR,
  "pt-br": ptBR,
};

function detectLocale(): Locale {
  // 1. Explicit override
  const override = process.env.JUNTO_LANG;
  if (override && locales[override]) return override as Locale;

  // 2. System locale detection
  const lang =
    process.env.LANG ??
    process.env.LC_ALL ??
    process.env.LC_MESSAGES ??
    process.env.LANGUAGE ??
    "";

  // Windows: check PowerShell culture
  const winLang = process.env.POWERSHELL_CULTURE ?? "";

  const systemLang = (lang + " " + winLang).toLowerCase();

  if (systemLang.includes("pt") || systemLang.includes("bra")) {
    return "pt-BR";
  }

  return "en";
}

export const locale = detectLocale();
export const t: Messages = locales[locale] ?? en;
