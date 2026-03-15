# Junto

> O protocolo de pagamentos para pessoas e agentes.

Envie e receba dinheiro por qualquer assistente de IA. Qualquer meio de pagamento. Limites de seguranca integrados.

---

## Instalar

```bash
npm install -g junto-mcp
```

Pronto. O comando `junto` esta disponivel globalmente.

---

## Configurar

```bash
junto setup
```

Cole sua chave de API quando solicitado (a entrada e mascarada com `****`).
A chave e salva em `~/.junto/config.json` — nao precisa configurar de novo.

```
  ● Junto Setup
  ────────────────────────────────────────────────

  Configure sua chave de API Woovi/OpenPix

  WOOVI_APP_ID: **********************
  ✓ Salvo em ~/.junto/config.json
```

---

## Usar

### Criar cobranca Pix (QR code)

```bash
junto cobrar 10.00 "Cafe"
```

```
  ✓ Cobranca criada!
  ────────────────────────────────────────────────

  Valor:        R$ 10.00
  Descricao:    Cafe
  Status:       ACTIVE

  → Link de pagamento:
    https://woovi.com/pay/...

  → Pix copia e cola:
    00020101021226810014br.gov.bcb.pix...
```

### Enviar dinheiro via Pix

```bash
junto pagar 25.00 maria@email.com
junto pagar 10 12345678900 --type CPF
junto enviar 150.00 +5511999887766 --note "Aluguel"
```

O tipo do destino (email, CPF, telefone, CNPJ) e detectado automaticamente.
Pagamentos acima de R$50 pedem confirmacao antes de enviar.

### Verificar status

```bash
junto status <id>
```

### Reembolsar

```bash
junto reembolso <id>
```

### Ver saldo

```bash
junto saldo
```

### Ver limites de gasto

```bash
junto limites
```

```
  ● Limites de Gasto
  ────────────────────────────────────────────────

  Limite diario:        R$ 500.00
  Gasto hoje:           R$ 0.00
  Restante:             R$ 500.00

  ░░░░░░░░░░░░░░░░░░░░░░░░ 0%

  Max por transacao:    R$ 200.00
  Confirmar acima de:   R$ 50.00
```

### Ver provedores

```bash
junto provedores
```

### Ajuda

```bash
junto ajuda
```

---

## Limites de Seguranca

Todos os pagamentos passam por limites automaticos:

| Configuracao | Padrao | Variavel de ambiente |
|---|---|---|
| Limite diario | R$ 500.00 | `JUNTO_DAILY_LIMIT` (em centavos) |
| Max por transacao | R$ 200.00 | `JUNTO_PER_TX_MAX` (em centavos) |
| Confirmar acima de | R$ 50.00 | `JUNTO_CONFIRM_ABOVE` (em centavos) |

- Acima do max por transacao: **bloqueado**
- Acima do limite de confirmacao: **pede aprovacao**
- Limite diario: **controla o total do dia**

---

## Modo MCP (para agentes IA)

O Junto tambem roda como servidor MCP para assistentes de IA (Claude Desktop, Cursor, etc.):

```bash
junto --mcp
```

Configuracao no cliente MCP:

```json
{
  "mcpServers": {
    "junto": {
      "command": "junto",
      "args": ["--mcp"],
      "env": {
        "WOOVI_APP_ID": "sua-chave"
      }
    }
  }
}
```

---

## Arquivos

| Caminho | Descricao |
|---|---|
| `~/.junto/config.json` | Chaves de API salvas |
| `~/.junto/audit-YYYY-MM-DD.jsonl` | Log de auditoria de transacoes |

---

## Referencia Rapida

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

---

## Provedores

| Provedor | Regiao | Meios | Status |
|---|---|---|---|
| **Woovi/OpenPix** | Brasil | Pix | Funcionando |
| **Ebanx** | Brasil + LATAM | Pix, Boleto, Cartoes | Em breve |
| **Belvo** | Brasil | Open Finance | Em breve |
| **Stripe** | Global | Cartoes, ACH, SEPA | Em breve |

---

MIT
