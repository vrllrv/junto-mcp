# Junto CLI

> Send and receive money from your terminal.
> Envie e receba dinheiro pelo terminal.

Junto runs in two modes:
- **CLI mode** — human-friendly commands with colored output and confirmation prompts
- **MCP mode** — stdio server for AI clients (Claude, Cursor, etc.)

Mode is auto-detected. If you type a command like `junto pay`, it runs in CLI mode. If stdin is piped (by an AI client), it runs in MCP mode.

---

## Language / Idioma

Junto auto-detects your system language. To set manually:

```bash
# PowerShell
$env:JUNTO_LANG="pt-BR"; junto ajuda

# Bash
JUNTO_LANG=pt-BR junto ajuda
```

Supported: `en` (English), `pt-BR` (Portugues Brasileiro)

---

## Install / Instalar

```bash
npm install -g junto-mcp
```

This gives you the `junto` command globally.
Isso disponibiliza o comando `junto` globalmente.

---

## Setup / Configuracao

```bash
junto setup
```

Prompts for your API key (input is masked with `****`). The key is saved to `~/.junto/config.json` so you don't need environment variables for every command.

Solicita sua chave de API (entrada mascarada com `****`). A chave e salva em `~/.junto/config.json`.

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

## Commands / Comandos

All commands work in both English and Portuguese:

| English | Portugues | Description / Descricao |
|---|---|---|
| `junto pay` | `junto pagar` / `junto enviar` | Send money / Enviar dinheiro |
| `junto charge` | `junto cobrar` / `junto cobranca` | Create charge / Criar cobranca |
| `junto status` | `junto status` | Check status / Verificar status |
| `junto refund` | `junto reembolso` / `junto estorno` | Refund / Reembolsar |
| `junto balance` | `junto saldo` | Check balance / Verificar saldo |
| `junto providers` | `junto provedores` | List providers / Listar provedores |
| `junto limits` | `junto limites` | Show limits / Mostrar limites |
| `junto help` | `junto ajuda` | Show help / Mostrar ajuda |

---

### `junto pay` / `junto pagar` — Send money / Enviar dinheiro

```bash
junto pay <amount> <destination> [options]
junto pagar <valor> <destino> [options]
```

Amounts are in reais (not cents). Destination type is auto-detected.
Valores em reais (nao centavos). Tipo do destino e detectado automaticamente.

```bash
junto pay 25.00 maria@email.com
junto pagar 10 12345678900 --type CPF
junto enviar 150.00 +5511999887766 --note "Aluguel"
```

Options / Opcoes:
- `--type EMAIL|CPF|PHONE|CNPJ|RANDOM` — override destination type / forcar tipo do destino
- `--note "memo"` — attach a payment memo / adicionar nota

The CLI will show a summary and ask for confirmation before sending:

```
  Resumo do Pagamento

  Valor:        R$ 25.00
  Para:         maria@email.com (EMAIL)
  Provedor:     woovi

  Enviar este pagamento? [y/N] y

  Enviado!

  Valor:        R$ 25.00
  Para:         maria@email.com
  Provedor:     woovi
  Status:       COMPLETED
  ID:           junto-1773573908677-4klmf7
  Hora:         2026-03-15T11:25:09.568Z

  Ver status: junto status junto-1773573908677-4klmf7
```

### `junto charge` / `junto cobrar` — Create charge / Criar cobranca

```bash
junto charge <amount> [description]
junto cobrar <valor> [descricao]
```

```bash
junto charge 10.00 "Coffee"
junto cobrar 10.00 "Cafe"
```

Returns a Pix QR code, payment link, and copy-paste code:

```
  Cobranca criada!

  Valor:        R$ 10.00
  Descricao:    Cafe
  Status:       ACTIVE
  ID:           junto-1773573908677-x9y2z3

  Link de pagamento:
  https://woovi.com/pay/f3c2b8c9-8122-43db-bbb2-9b4c01c00bf2

  Pix copia e cola:
  00020101021226810014br.gov.bcb.pix2559qr.woovi.com/...

  Ver status: junto status junto-1773573908677-x9y2z3
```

### `junto status` — Check payment status / Verificar status

```bash
junto status <id>
```

```
  Status

  ID:           junto-1773573908677-4klmf7
  Status:       COMPLETED
  Valor:        R$ 25.00
  Provedor:     woovi
  Atualizado:   2026-03-15T11:25:09.054Z
```

Status is color-coded: green for completed, yellow for active/pending, red for failed.
Status com cores: verde para concluido, amarelo para ativo/pendente, vermelho para falha.

### `junto refund` / `junto reembolso` — Refund / Reembolsar

```bash
junto refund <id>
junto reembolso <id>
junto estorno <id>
```

Asks for confirmation before processing. / Pede confirmacao antes de processar.

### `junto balance` / `junto saldo` — Check balance / Verificar saldo

```bash
junto balance
junto saldo
```

```
  Saldo

  woovi:  R$ 150.00
```

Requires the `ACCOUNT_GET_LIST` scope on your Woovi API key.
Requer o escopo `ACCOUNT_GET_LIST` na sua chave Woovi.

### `junto providers` / `junto provedores` — List providers / Listar provedores

```bash
junto providers
junto provedores
```

```
  Provedores

  ● woovi
    Moedas:      BRL
    Meios:       pix
    Liquidacao:  instant
```

### `junto limits` / `junto limites` — Show limits / Mostrar limites

```bash
junto limits
junto limites
```

```
  Limites de Gasto

  Limite diario:        R$ 500.00
  Gasto hoje:           R$ 25.00
  Restante:             R$ 475.00
  Max por transacao:    R$ 200.00
  Confirmar acima de:   R$ 50.00
```

---

## Guardrails / Limites de Seguranca

All guardrails apply in CLI mode, same as MCP mode:
Todos os limites se aplicam no modo CLI, igual ao modo MCP:

| Setting / Configuracao | Default / Padrao | Configure via |
|---|---|---|
| Daily limit / Limite diario | R$ 500.00 | `JUNTO_DAILY_LIMIT` (in cents / em centavos) |
| Per-tx max / Max por transacao | R$ 200.00 | `JUNTO_PER_TX_MAX` (in cents / em centavos) |
| Confirm above / Confirmar acima de | R$ 50.00 | `JUNTO_CONFIRM_ABOVE` (in cents / em centavos) |

- Payments above the per-tx max are **blocked** / Pagamentos acima do max sao **bloqueados**
- Payments above the confirm threshold show a **confirmation prompt** / Pagamentos acima do limite mostram **confirmacao**
- Daily limit tracks total spend for the day / Limite diario acompanha o gasto total do dia

---

## MCP Server Mode / Modo Servidor MCP

For AI clients (Claude Desktop, Cursor, etc.):
Para clientes IA (Claude Desktop, Cursor, etc.):

```bash
junto --mcp
```

Or configure in your MCP client / Ou configure no seu cliente MCP:

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

## Files / Arquivos

| Path / Caminho | Description / Descricao |
|---|---|
| `~/.junto/config.json` | Saved API keys / Chaves de API salvas |
| `~/.junto/audit-YYYY-MM-DD.jsonl` | Transaction audit log / Log de auditoria |

---

## Quick Reference / Referencia Rapida

### English
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

### Portugues
```
junto setup                            Configurar chaves de API
junto pagar <valor> <destino>          Enviar dinheiro via Pix
junto cobrar <valor> [descricao]       Criar cobranca / QR code Pix
junto status <id>                      Verificar status do pagamento
junto reembolso <id>                   Reembolsar um pagamento
junto saldo                            Verificar saldo disponivel
junto provedores                       Listar provedores configurados
junto limites                          Mostrar limites de gasto
junto --mcp                            Rodar como servidor MCP
junto --version                        Mostrar versao
junto ajuda                            Mostrar ajuda
```
